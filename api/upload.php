<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

/**
 * Normalize $_FILES entry/entries into a list of upload arrays.
 *
 * @return list<array{name:string,type:string,tmp_name:string,error:int,size:int}>
 */
function stx_normalize_uploads(): array
{
    $out = [];

    // Multi: files[] 
    if (!empty($_FILES['files']) && is_array($_FILES['files']['name'] ?? null)) {
        $n = count($_FILES['files']['name']);
        for ($i = 0; $i < $n; $i++) {
            $out[] = [
                'name' => (string) ($_FILES['files']['name'][$i] ?? ''),
                'type' => (string) ($_FILES['files']['type'][$i] ?? ''),
                'tmp_name' => (string) ($_FILES['files']['tmp_name'][$i] ?? ''),
                'error' => (int) ($_FILES['files']['error'][$i] ?? UPLOAD_ERR_NO_FILE),
                'size' => (int) ($_FILES['files']['size'][$i] ?? 0),
            ];
        }
        return $out;
    }

    // Single: file (legacy)
    if (!empty($_FILES['file']) && is_string($_FILES['file']['name'] ?? null)) {
        $out[] = [
            'name' => (string) $_FILES['file']['name'],
            'type' => (string) ($_FILES['file']['type'] ?? ''),
            'tmp_name' => (string) ($_FILES['file']['tmp_name'] ?? ''),
            'error' => (int) ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE),
            'size' => (int) ($_FILES['file']['size'] ?? 0),
        ];
    }

    return $out;
}

try {
    $user = stx_require_user();
    stx_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }

    $id = (string) ($_POST['id'] ?? $_GET['id'] ?? '');
    if ($id === '') {
        stx_json(['error' => 'Missing project id'], 400);
    }

    $uploads = stx_normalize_uploads();
    if ($uploads === []) {
        $filesDbg = [];
        foreach (array_keys($_FILES) as $key) {
            $f = $_FILES[$key];
            $filesDbg[$key] = is_array($f['error'] ?? null)
                ? array_map('intval', (array) $f['error'])
                : (int) ($f['error'] ?? -1);
        }
        stx_log_upload('reject empty uploads project=' . $id
            . ' content_length=' . ($_SERVER['CONTENT_LENGTH'] ?? '?')
            . ' files=' . json_encode($filesDbg));
        stx_json(['error' => 'Choose one or more files to upload'], 400);
    }

    // Optional directory prefix for multi-upload, e.g. "fonts/" or "images/"
    $prefix = trim((string) ($_POST['prefix'] ?? ''), '/');
    // Legacy single-file path override
    $singlePath = isset($_POST['path']) ? trim((string) $_POST['path']) : '';

    $saved = [];
    $errors = [];

    foreach ($uploads as $i => $upload) {
        if (($upload['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            continue;
        }
        try {
            $path = null;
            if (count($uploads) === 1 && $singlePath !== '') {
                $path = $singlePath;
            } elseif ($prefix !== '') {
                $base = basename((string) ($upload['name'] ?? 'file'));
                $path = $prefix . '/' . $base;
            }
            $saved[] = stx_projects()->writeUploadedFile($user, $id, $upload, $path);
        } catch (Throwable $e) {
            $name = (string) ($upload['name'] ?? ('file#' . $i));
            $errors[] = ['name' => $name, 'error' => $e->getMessage()];
        }
    }

    if ($saved === []) {
        $message = $errors[0]['error'] ?? 'No files were received. The file may exceed server upload limits.';
        stx_log_upload('fail project=' . $id
            . ' message=' . $message
            . ' errors=' . json_encode($errors)
            . ' uploads=' . json_encode(array_map(static fn ($u) => [
                'name' => $u['name'] ?? '',
                'error' => $u['error'] ?? null,
                'size' => $u['size'] ?? null,
            ], $uploads)));
        stx_json([
            'error' => $message,
            'errors' => $errors,
        ], 400);
    }

    stx_log_upload('ok project=' . $id . ' saved=' . count($saved)
        . ' paths=' . json_encode(array_column($saved, 'path')));
    stx_json([
        'files' => $saved,
        // Back-compat for single-file clients
        'file' => $saved[0] ?? null,
        'errors' => $errors,
    ], 201);
} catch (Throwable $e) {
    stx_http_error($e);
}
