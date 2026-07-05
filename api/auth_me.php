<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Config;

try {
    $user = stx_current_user();
    if ($user === null && !Config::authRequired()) {
        // Auto local session for solo installs without OAuth.
        $user = stx_require_user();
    }
    stx_json([
        'user' => stx_public_user($user),
        'authRequired' => Config::authRequired(),
        'providers' => stx_enabled_providers(),
        'oauthConfigured' => Config::githubClientId() !== '' && Config::githubClientSecret() !== '',
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
