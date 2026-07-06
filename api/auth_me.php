<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Config;
use SiamTeX\Ai\AiConfig;

try {
    $user = stx_current_user();
    if ($user === null && !Config::authRequired()) {
        // Auto local session for solo installs without OAuth.
        $user = stx_require_user();
    }
    $aiConfig = null;
    $aiEnabled = Config::aiEnabled();
    if ($user !== null) {
        $cfg = stx_ai()->configForUser((int) $user['id']);
        $aiEnabled = $cfg->enabled;
        $aiConfig = $cfg->publicView();
    } elseif ($aiEnabled) {
        $aiConfig = AiConfig::fromEnv()->publicView();
    }
    $aiUsage = $user !== null ? stx_ai()->usageSummaryForUser((int) $user['id']) : null;
    stx_json([
        'user' => stx_public_user($user),
        'authRequired' => Config::authRequired(),
        'providers' => stx_enabled_providers(),
        'oauthConfigured' => Config::githubClientId() !== '' && Config::githubClientSecret() !== '',
        'aiEnabled' => $aiEnabled,
        'aiConfig' => $aiConfig,
        'aiUsage' => $aiUsage,
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
