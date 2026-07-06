<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Ai\AiConfig;

try {
    $user = stx_require_user();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    stx_require_csrf();
    $ai = stx_ai();
    $config = $ai->configForUser((int) $user['id']);
    $result = $ai->testConnection($config);
    stx_json($result);
} catch (Throwable $e) {
    stx_http_error($e);
}
