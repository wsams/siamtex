<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Ai\AiConfig;

try {
    $user = stx_require_user();
    $ai = stx_ai();
    $config = $ai->configForUser((int) $user['id']);

    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        stx_json([
            'config' => $config->publicView(),
            'serverDefaults' => AiConfig::fromEnv()->publicView(),
        ]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
        stx_require_csrf();
        $body = stx_read_json();
        $config = $ai->saveUserSettings((int) $user['id'], $body);
        stx_json(['config' => $config->publicView()]);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
