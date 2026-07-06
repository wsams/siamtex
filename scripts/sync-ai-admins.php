#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Apply SIAMTEX_ADMIN_GITHUB_LOGINS to the database (CLI or after env changes).
 */

$envFile = '/etc/siamtex.env';
if (is_readable($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
            continue;
        }
        [$key, $value] = explode('=', $line, 2);
        putenv(trim($key) . '=' . trim($value));
    }
}

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\AiPermissions;
use SiamTeX\Config;
use SiamTeX\Store;

$store = new Store();
$perms = new AiPermissions($store);
$logins = Config::adminGithubLogins();
if ($logins === []) {
    fwrite(STDERR, "No SIAMTEX_ADMIN_GITHUB_LOGINS configured.\n");
    exit(1);
}

$placeholders = implode(',', array_fill(0, count($logins), '?'));
$st = $store->pdo()->prepare(
    "SELECT * FROM users WHERE provider = 'github' AND LOWER(provider_login) IN ({$placeholders})"
);
$st->execute($logins);
$users = $st->fetchAll();
if ($users === []) {
    fwrite(STDERR, "No matching GitHub users for: " . implode(', ', $logins) . "\n");
    exit(1);
}

foreach ($users as $user) {
    $perms->syncAdminFromLogin($user);
    $fresh = $store->loadUser((int) $user['id']);
    $login = $fresh['provider_login'] ?? '?';
    $admin = !empty($fresh['is_admin']) ? 'admin' : 'user';
    echo "Synced {$login} (id {$user['id']}) as {$admin}\n";
}

echo "Done.\n";
