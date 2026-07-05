<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\Auth;
use SiamTeX\Config;
use SiamTeX\Store;

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: text/plain');
    echo "Method not allowed\n";
    exit;
}

$provider = strtolower((string) ($_GET['provider'] ?? ''));
$code = (string) ($_GET['code'] ?? '');
$state = (string) ($_GET['state'] ?? '');
$error = (string) ($_GET['error'] ?? '');

function siamtex_auth_fail(string $message, int $code = 400): void
{
    Auth::clearOAuthStateCookie();
    http_response_code($code);
    header('Content-Type: text/html; charset=utf-8');
    $safe = htmlspecialchars($message, ENT_QUOTES);
    $home = htmlspecialchars(Config::oauthBaseUrl(), ENT_QUOTES);
    echo "<!doctype html><meta charset=\"utf-8\"><title>Sign-in failed</title>"
        . "<body style=\"font-family:system-ui;padding:2rem;line-height:1.5;\">"
        . "<h1>Sign-in failed</h1><p>{$safe}</p>"
        . "<p><a href=\"{$home}/\">Return to SiamTeX</a></p></body>";
    exit;
}

if ($error !== '') {
    siamtex_auth_fail('Provider returned: ' . $error);
}

$stateCookie = Auth::readOAuthStateCookie();
if ($stateCookie === null) {
    siamtex_auth_fail('Sign-in state expired. Please try again.');
}
if (!hash_equals($stateCookie['state'], $state)) {
    siamtex_auth_fail('Invalid sign-in state.');
}
if ($stateCookie['provider'] !== $provider) {
    siamtex_auth_fail('Provider mismatch.');
}

try {
    $oauth = Auth::provider($provider);
    $token = $oauth->getAccessToken('authorization_code', ['code' => $code]);
    $profile = Auth::fetchProfile($provider, $oauth, $token);
    $store = new Store();
    $user = $store->upsertOAuthUser($provider, $profile['providerUserId'], [
        'name' => $profile['name'] ?? $profile['login'] ?? null,
        'email' => $profile['email'] ?? null,
        'emailVerified' => (bool) ($profile['emailVerified'] ?? false),
        'avatarUrl' => $profile['avatarUrl'] ?? null,
        'login' => $profile['login'] ?? null,
    ]);
    Auth::setSessionCookie((int) $user['id']);
    Auth::clearOAuthStateCookie();
    $return = $stateCookie['returnUrl'] !== '' ? $stateCookie['returnUrl'] : Config::oauthBaseUrl() . '/';
    header('Location: ' . $return, true, 302);
    exit;
} catch (Throwable $e) {
    error_log('siamtex-auth-callback: ' . $e->__toString());
    siamtex_auth_fail(Config::debug() ? $e->getMessage() : 'Could not complete sign-in.', 500);
}
