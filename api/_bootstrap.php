<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\Auth;
use SiamTeX\CompileService;
use SiamTeX\Config;
use SiamTeX\ProjectService;
use SiamTeX\Store;

function stx_store(): Store
{
    static $s = null;
    return $s ??= new Store();
}

function stx_projects(): ProjectService
{
    static $p = null;
    return $p ??= new ProjectService(stx_store());
}

function stx_compile(): CompileService
{
    static $c = null;
    return $c ??= new CompileService(stx_projects());
}

function stx_json(array $data, int $code = 200): void
{
    http_response_code($code);
    echo json_encode($data, JSON_THROW_ON_ERROR);
    exit;
}

function stx_read_json(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }
    return json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
}

function stx_current_user(): ?array
{
    static $cached = false;
    static $value = null;
    if ($cached) {
        return $value;
    }
    $cached = true;
    $value = Auth::currentUser(stx_store());
    return $value;
}

function stx_require_user(): array
{
    $u = stx_current_user();
    if ($u !== null) {
        return $u;
    }
    if (!Config::authRequired()) {
        $u = stx_store()->ensureLocalUser();
        Auth::setSessionCookie((int) $u['id']);
        return $u;
    }
    stx_json(['error' => 'Sign in required.'], 401);
}

function stx_enabled_providers(): array
{
    $providers = [];
    if (Config::githubClientId() !== '' && Config::githubClientSecret() !== '') {
        $providers[] = Auth::PROVIDER_GITHUB;
    }
    return $providers;
}

function stx_public_user(?array $u): ?array
{
    if ($u === null) {
        return null;
    }
    return [
        'id' => (int) $u['id'],
        'name' => $u['name'] ?: $u['provider_login'] ?: 'User',
        'login' => $u['provider_login'],
        'avatarUrl' => $u['avatar_url'],
        'provider' => $u['provider'],
    ];
}

function stx_http_error(Throwable $e): void
{
    if ($e instanceof JsonException) {
        stx_json(['error' => 'Invalid JSON body.'], 400);
    }
    if ($e instanceof RuntimeException || $e instanceof InvalidArgumentException) {
        stx_json(['error' => $e->getMessage()], 400);
    }
    error_log('siamtex-api: ' . $e->__toString());
    stx_json([
        'error' => Config::debug() ? $e->getMessage() : 'Server error.',
    ], 500);
}

function stx_csrf_ok(): bool
{
    $session = Auth::readSession();
    if ($session === null && !Config::authRequired()) {
        return true;
    }
    $hdr = (string) ($_SERVER['HTTP_X_SIAMTEX_CSRF'] ?? '');
    // Cookie-bound requests from our own origin; require custom header for mutating calls.
    return $hdr === '1';
}

function stx_require_csrf(): void
{
    if ($_SERVER['REQUEST_METHOD'] === 'GET' || $_SERVER['REQUEST_METHOD'] === 'HEAD') {
        return;
    }
    if (!stx_csrf_ok()) {
        stx_json(['error' => 'Missing CSRF header.'], 403);
    }
}
