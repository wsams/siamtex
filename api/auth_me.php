<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Ai\AiConfig;
use SiamTeX\Config;

try {
    $user = stx_current_user();
    if ($user === null && !Config::authRequired()) {
        $user = stx_require_user();
    } elseif ($user !== null) {
        stx_ai_permissions()->syncAdminFromLogin($user);
        $user = stx_store()->loadUser((int) $user['id']) ?? $user;
    }

    $serverAi = Config::aiEnabled();
    $aiPermissions = null;
    $isAdmin = false;
    $aiConfig = null;
    $aiEnabled = false;
    $aiUsage = null;

    if ($user !== null) {
        $uid = (int) $user['id'];
        $isAdmin = !empty($user['is_admin']);
        $aiPermissions = stx_ai_permissions()->forUser($uid);
        $aiEnabled = $serverAi && !empty($aiPermissions['any']);
        $aiUsage = stx_ai()->usageSummaryForUser($uid);
        $tokenQuota = stx_ai_permissions()->tokenQuotaForUser($uid);
        if ($tokenQuota !== null) {
            $aiUsage['tokenQuota'] = $tokenQuota;
            $aiUsage['quotaRemaining'] = max(0, $tokenQuota - $aiUsage['totalTokens']);
        }

        if ($aiEnabled) {
            if (!empty($aiPermissions['settings'])) {
                $aiConfig = stx_ai()->configForUser($uid)->publicView();
            } else {
                $aiConfig = AiConfig::fromEnv()->publicView();
            }
        }
    } elseif ($serverAi) {
        $aiConfig = AiConfig::fromEnv()->publicView();
        $aiEnabled = true;
    }

    stx_json([
        'user' => stx_public_user($user),
        'authRequired' => Config::authRequired(),
        'providers' => stx_enabled_providers(),
        'oauthConfigured' => Config::githubClientId() !== '' && Config::githubClientSecret() !== '',
        'aiEnabled' => $aiEnabled,
        'aiPermissions' => $aiPermissions,
        'isAdmin' => $isAdmin,
        'aiConfig' => $aiConfig,
        'aiUsage' => $aiUsage,
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
