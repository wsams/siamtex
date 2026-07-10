<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Config;
use SiamTeX\DocxExtractor;

/**
 * Extract text + figures from uploaded .docx file(s) without executing macros.
 *
 * POST multipart:
 *   - id: project id (required; must have edit access)
 *   - file / files[]: .docx upload(s)
 *   - saveMedia: "1" (default) to write extracted images into the project under figures/
 *
 * Returns extracted plain text for preview / AI conversion.
 * When saveMedia is on, image binaries are stored as project files (downloadable / compile-time assets).
 */
try {
    $user = stx_require_user();
    stx_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }

    $projectId = trim((string) ($_POST['id'] ?? ''));
    if ($projectId === '') {
        stx_json(['error' => 'project id is required'], 400);
    }
    // Authz: must be able to edit the project (import proposes writes).
    stx_projects()->requireRole($user, $projectId, ['owner', 'edit']);

    $saveMedia = !isset($_POST['saveMedia']) || !in_array(
        strtolower(trim((string) $_POST['saveMedia'])),
        ['0', 'false', 'no', 'off'],
        true,
    );

    $uploads = [];
    if (!empty($_FILES['files']) && is_array($_FILES['files']['name'] ?? null)) {
        $n = count($_FILES['files']['name']);
        for ($i = 0; $i < $n; $i++) {
            $uploads[] = [
                'name' => (string) ($_FILES['files']['name'][$i] ?? ''),
                'type' => (string) ($_FILES['files']['type'][$i] ?? ''),
                'tmp_name' => (string) ($_FILES['files']['tmp_name'][$i] ?? ''),
                'error' => (int) ($_FILES['files']['error'][$i] ?? UPLOAD_ERR_NO_FILE),
                'size' => (int) ($_FILES['files']['size'][$i] ?? 0),
            ];
        }
    } elseif (!empty($_FILES['file'])) {
        $uploads[] = [
            'name' => (string) ($_FILES['file']['name'] ?? ''),
            'type' => (string) ($_FILES['file']['type'] ?? ''),
            'tmp_name' => (string) ($_FILES['file']['tmp_name'] ?? ''),
            'error' => (int) ($_FILES['file']['error'] ?? UPLOAD_ERR_NO_FILE),
            'size' => (int) ($_FILES['file']['size'] ?? 0),
        ];
    }

    $uploads = array_values(array_filter(
        $uploads,
        static fn (array $u): bool => ((int) ($u['error'] ?? UPLOAD_ERR_NO_FILE)) !== UPLOAD_ERR_NO_FILE
            || ((int) ($u['size'] ?? 0)) > 0
            || ((string) ($u['tmp_name'] ?? '')) !== '',
    ));

    if ($uploads === []) {
        stx_json(['error' => 'Choose one or more .docx files to import'], 400);
    }

    $maxFiles = Config::maxDocxImportFiles();
    if (count($uploads) > $maxFiles) {
        stx_json(['error' => "Too many files (max {$maxFiles} per import)"], 400);
    }

    $documents = [];
    $errors = [];
    $savedMedia = [];
    $projects = stx_projects();

    foreach ($uploads as $i => $upload) {
        try {
            $extracted = DocxExtractor::extractFromUpload($upload);
            $mediaMeta = [];
            if ($saveMedia) {
                foreach ($extracted['media'] as $item) {
                    $path = (string) ($item['path'] ?? '');
                    $content = (string) ($item['content'] ?? '');
                    if ($path === '' || $content === '') {
                        continue;
                    }
                    $meta = $projects->writeFile(
                        $user,
                        $projectId,
                        $path,
                        $content,
                        'import',
                        'DOCX figure: ' . basename($path),
                        false,
                    );
                    $savedMedia[] = $meta;
                    $mediaMeta[] = [
                        'path' => $meta['path'],
                        'bytes' => $meta['size'],
                        'binary' => true,
                        'contentType' => (string) ($item['contentType'] ?? 'application/octet-stream'),
                        'source' => (string) ($item['source'] ?? ''),
                    ];
                }
            } else {
                foreach ($extracted['media'] as $item) {
                    $mediaMeta[] = [
                        'path' => (string) ($item['path'] ?? ''),
                        'bytes' => (int) ($item['bytes'] ?? 0),
                        'binary' => true,
                        'contentType' => (string) ($item['contentType'] ?? 'application/octet-stream'),
                        'source' => (string) ($item['source'] ?? ''),
                        'saved' => false,
                    ];
                }
            }
            // Never send raw binary back to the browser in JSON.
            unset($extracted['media']);
            $extracted['media'] = $mediaMeta;
            $extracted['figures'] = array_values(array_map(
                static fn (array $m): string => (string) $m['path'],
                $mediaMeta,
            ));
            $extracted['mediaSaved'] = $saveMedia;
            $documents[] = $extracted;
        } catch (Throwable $e) {
            $name = (string) ($upload['name'] ?? ('file#' . $i));
            $errors[] = ['filename' => basename($name), 'error' => $e->getMessage()];
        }
    }

    if ($documents === []) {
        $message = $errors[0]['error'] ?? 'Could not extract text from the upload.';
        stx_json(['error' => $message, 'errors' => $errors], 400);
    }

    stx_json([
        'documents' => $documents,
        'savedMedia' => $savedMedia,
        'errors' => $errors,
        'limits' => [
            'maxBytes' => Config::maxDocxImportBytes(),
            'maxChars' => Config::maxDocxExtractChars(),
            'maxFiles' => $maxFiles,
            'maxMediaFiles' => Config::maxDocxMediaFiles(),
            'maxMediaBytes' => Config::maxDocxMediaBytes(),
            'maxMediaTotalBytes' => Config::maxDocxMediaTotalBytes(),
        ],
        'aiAvailable' => stx_ai_permissions()->allows((int) $user['id'], \SiamTeX\AiPermissions::ASSIST)
            || stx_ai_permissions()->allows((int) $user['id'], \SiamTeX\AiPermissions::CHAT),
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
