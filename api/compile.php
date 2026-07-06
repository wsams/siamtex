<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    stx_require_csrf();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    $body = stx_read_json();
    $id = (string) ($body['id'] ?? $_GET['id'] ?? '');
    if ($id === '') {
        stx_json(['error' => 'Missing id'], 400);
    }
    // Optional save-all before compile
    if (!empty($body['files']) && is_array($body['files'])) {
        foreach ($body['files'] as $path => $content) {
            stx_projects()->writeFile($user, $id, (string) $path, (string) $content, 'compile');
        }
    }
    $project = stx_projects()->requireRole($user, $id, ['owner', 'edit']);
    $result = stx_compile()->compile($project);
    stx_json($result);
} catch (Throwable $e) {
    stx_http_error($e);
}
