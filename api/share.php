<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    stx_require_csrf();
    $body = stx_read_json();
    $id = (string) ($body['id'] ?? $_GET['id'] ?? '');
    if ($id === '') {
        stx_json(['error' => 'Missing id'], 400);
    }
    $method = $_SERVER['REQUEST_METHOD'];
    if ($method === 'POST') {
        $role = (string) ($body['role'] ?? 'view');
        $project = stx_projects()->enableShare($user, $id, $role);
        $url = \SiamTeX\Config::oauthBaseUrl() . '/?project=' . urlencode($id) . '&token=' . urlencode((string) $project['shareToken']);
        stx_json(['project' => $project, 'shareUrl' => $url]);
    }
    if ($method === 'DELETE') {
        $project = stx_projects()->disableShare($user, $id);
        stx_json(['project' => $project]);
    }
    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
