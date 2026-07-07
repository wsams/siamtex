<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\AiPermissions;

try {
    $user = stx_require_user();
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    $perms = stx_ai_permissions();
    if (!$perms->allows((int) $user['id'], AiPermissions::CHAT)
        && !$perms->allows((int) $user['id'], AiPermissions::ASSIST)
        && !$perms->allows((int) $user['id'], AiPermissions::SETTINGS)) {
        stx_json(['error' => 'AI is not enabled for your account.'], 403);
    }

    $projectId = trim((string) ($_GET['projectId'] ?? ''));
    $ai = stx_ai();
    $uid = (int) $user['id'];
    $config = $projectId !== ''
        ? $ai->configForProject($uid, $projectId)
        : $ai->userDefaultConfig($uid);
    $models = $ai->listModels($uid, $projectId !== '' ? $projectId : null);

    stx_json([
        'models' => $models,
        'current' => $config->model,
        'default' => $ai->userDefaultConfig($uid)->model,
        'provider' => $config->provider,
        'baseUrl' => $config->baseUrl,
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
