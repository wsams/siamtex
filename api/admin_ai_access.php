<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Ai\AiConfig;
use SiamTeX\AiPermissions;

try {
    $user = stx_require_user();
    $perms = stx_ai_permissions();
    $perms->requireAdmin($user);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        stx_json([
            'users' => $perms->listUsersForAdmin(),
            'features' => [
                ['id' => AiPermissions::CHAT, 'label' => 'AI Chat'],
                ['id' => AiPermissions::CREATE_PROJECT, 'label' => 'Create project with AI'],
                ['id' => AiPermissions::ASSIST, 'label' => 'AI assist (edit files)'],
                ['id' => AiPermissions::FIX_ERRORS, 'label' => 'AI fix compile errors'],
                ['id' => AiPermissions::SETTINGS, 'label' => 'AI settings / BYOK'],
            ],
            'adminLogins' => \SiamTeX\Config::adminGithubLogins(),
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
        stx_require_csrf();
        $body = stx_read_json();
        $targetId = (int) ($body['userId'] ?? 0);
        if ($targetId <= 0) {
            stx_json(['error' => 'userId is required'], 400);
        }
        $patch = is_array($body['permissions'] ?? null) ? $body['permissions'] : [];
        $updated = $perms->updateUserPermissions($targetId, $patch, (int) $user['id']);
        stx_json(['permissions' => $updated]);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
