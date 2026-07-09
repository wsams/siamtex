<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Config;
use SiamTeX\DocxExtractor;

/**
 * Extract text from uploaded .docx file(s) without executing macros.
 *
 * POST multipart:
 *   - id: project id (required; must have edit access)
 *   - file / files[]: .docx upload(s)
 *
 * Returns extracted plain text for preview / AI conversion. Does not write project files.
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
    foreach ($uploads as $i => $upload) {
        try {
            $documents[] = DocxExtractor::extractFromUpload($upload);
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
        'errors' => $errors,
        'limits' => [
            'maxBytes' => Config::maxDocxImportBytes(),
            'maxChars' => Config::maxDocxExtractChars(),
            'maxFiles' => $maxFiles,
        ],
        'aiAvailable' => stx_ai_permissions()->allows((int) $user['id'], \SiamTeX\AiPermissions::ASSIST)
            || stx_ai_permissions()->allows((int) $user['id'], \SiamTeX\AiPermissions::CHAT),
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
