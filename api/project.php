<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    $id = (string) ($_GET['id'] ?? '');
    if ($id === '') {
        stx_json(['error' => 'Missing id'], 400);
    }
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $token = (string) ($_GET['token'] ?? '');
        if ($token !== '') {
            $p = stx_projects()->projectByShareToken($token);
            if (!$p || $p['id'] !== $id) {
                stx_json(['error' => 'Project not found'], 404);
            }
            $role = $p['share_role'] ?: 'view';
            stx_json([
                'project' => stx_projects()->publicProject($p + ['_role' => $role]),
                'files' => stx_projects()->listFiles($id),
                'build' => stx_projects()->latestBuild($id),
                'aiUsage' => stx_ai()->usageSummaryForProject($id),
            ]);
        }
        $p = stx_projects()->requireRole($user, $id, ['owner', 'edit', 'view']);
        stx_json([
            'project' => stx_projects()->publicProject($p),
            'files' => stx_projects()->listFiles($id),
            'build' => stx_projects()->latestBuild($id),
            'aiUsage' => stx_ai()->usageSummaryForProject($id),
        ]);
    }

    stx_require_csrf();

    if ($method === 'PATCH') {
        $body = stx_read_json();
        $project = stx_projects()->updateMeta($user, $id, $body);
        stx_json(['project' => $project]);
    }

    if ($method === 'DELETE') {
        stx_projects()->softDelete($user, $id);
        stx_json(['ok' => true]);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
