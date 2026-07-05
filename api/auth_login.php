<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\Auth;
use SiamTeX\Config;

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    header('Content-Type: text/plain');
    echo "Method not allowed\n";
    exit;
}

$provider = strtolower((string) ($_GET['provider'] ?? ''));
$return = (string) ($_GET['return'] ?? '');
if (!in_array($provider, Auth::SUPPORTED_PROVIDERS, true)) {
    http_response_code(400);
    header('Content-Type: text/plain');
    echo "Unknown provider.\n";
    exit;
}

$base = Config::oauthBaseUrl();
$baseHost = parse_url($base, PHP_URL_HOST);
$returnHost = $return !== '' ? parse_url($return, PHP_URL_HOST) : null;
if ($return === '' || ($returnHost !== null && $returnHost !== $baseHost)) {
    $return = $base . '/';
}

try {
    $oauth = Auth::provider($provider);
    $authUrl = $oauth->getAuthorizationUrl(['scope' => ['read:user', 'user:email']]);
    Auth::setOAuthStateCookie($oauth->getState(), $provider, $return);
    header('Location: ' . $authUrl, true, 302);
    exit;
} catch (Throwable $e) {
    error_log('siamtex-auth-login: ' . $e->__toString());
    http_response_code(500);
    header('Content-Type: text/plain');
    echo Config::debug() ? $e->getMessage() : "Sign-in unavailable.\n";
    exit;
}
