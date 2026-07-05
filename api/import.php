<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    stx_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    if (empty($_FILES['file'])) {
        stx_json(['error' => 'Missing file upload'], 400);
    }
    $file = $_FILES['file'];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        stx_json(['error' => 'Upload failed'], 400);
    }
    if (($file['size'] ?? 0) > \SiamTeX\Config::maxUploadBytes() * 4) {
        stx_json(['error' => 'Archive too large'], 400);
    }
    $name = trim((string) ($_POST['name'] ?? pathinfo((string) $file['name'], PATHINFO_FILENAME)));
    if ($name === '') {
        $name = 'Imported project';
    }
    $project = stx_projects()->importZip($user, $name, (string) $file['tmp_name']);
    stx_json(['project' => $project], 201);
} catch (Throwable $e) {
    stx_http_error($e);
}
