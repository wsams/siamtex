<?php

declare(strict_types=1);

namespace SiamTeX;

use League\OAuth2\Client\Provider\AbstractProvider;
use League\OAuth2\Client\Provider\Github;
use RuntimeException;

final class Auth
{
    public const PROVIDER_GITHUB = 'github';
    public const PROVIDER_LOCAL = 'local';
    public const SUPPORTED_PROVIDERS = [self::PROVIDER_GITHUB];

    public static function provider(string $name): AbstractProvider
    {
        $base = Config::oauthBaseUrl();
        $redirect = $base . '/api/auth_callback.php?provider=' . urlencode($name);
        if ($name === self::PROVIDER_GITHUB) {
            $id = Config::githubClientId();
            $secret = Config::githubClientSecret();
            if ($id === '' || $secret === '') {
                throw new RuntimeException('GitHub OAuth is not configured. Set SIAMTEX_GITHUB_CLIENT_ID and SIAMTEX_GITHUB_CLIENT_SECRET.');
            }
            return new Github([
                'clientId' => $id,
                'clientSecret' => $secret,
                'redirectUri' => $redirect,
            ]);
        }
        throw new RuntimeException('Unsupported provider: ' . $name);
    }

    /** @return array{providerUserId:string, login:?string, name:?string, email:?string, emailVerified:bool, avatarUrl:?string} */
    public static function fetchProfile(string $name, AbstractProvider $provider, $token): array
    {
        if ($name === self::PROVIDER_GITHUB) {
            /** @var Github $provider */
            $owner = $provider->getResourceOwner($token);
            $data = $owner->toArray();
            $email = $owner->getEmail() ?? ($data['email'] ?? null);
            $emailVerified = false;
            if ($email === null || $email === '') {
                try {
                    $request = $provider->getAuthenticatedRequest('GET', 'https://api.github.com/user/emails', $token);
                    $emails = $provider->getParsedResponse($request);
                    foreach ((array) $emails as $row) {
                        if (!empty($row['primary'])) {
                            $email = (string) ($row['email'] ?? '');
                            $emailVerified = !empty($row['verified']);
                            break;
                        }
                    }
                } catch (\Throwable $e) {
                }
            } else {
                $emailVerified = true;
            }
            return [
                'providerUserId' => (string) $owner->getId(),
                'login' => isset($data['login']) ? (string) $data['login'] : null,
                'name' => isset($data['name']) ? (string) $data['name'] : null,
                'email' => $email !== null && $email !== '' ? (string) $email : null,
                'emailVerified' => $emailVerified,
                'avatarUrl' => isset($data['avatar_url']) ? (string) $data['avatar_url'] : null,
            ];
        }
        throw new RuntimeException('Profile fetch not implemented for: ' . $name);
    }

    public static function setSessionCookie(int $userId): void
    {
        $token = self::buildToken(['u' => $userId, 't' => self::nowMs()]);
        self::writeCookie(Config::sessionCookieName(), $token, Config::sessionLifetimeDays() * 86400);
    }

    public static function clearSessionCookie(): void
    {
        self::writeCookie(Config::sessionCookieName(), '', -3600);
    }

    /** @return ?array{userId:int, issuedAt:int} */
    public static function readSession(): ?array
    {
        $raw = (string) ($_COOKIE[Config::sessionCookieName()] ?? '');
        if ($raw === '') {
            return null;
        }
        $payload = self::verifyToken($raw);
        if ($payload === null) {
            return null;
        }
        $userId = isset($payload['u']) ? (int) $payload['u'] : 0;
        $issued = isset($payload['t']) ? (int) $payload['t'] : 0;
        if ($userId <= 0 || $issued <= 0) {
            return null;
        }
        $maxAgeMs = Config::sessionLifetimeDays() * 86400 * 1000;
        if (self::nowMs() - $issued > $maxAgeMs) {
            return null;
        }
        return ['userId' => $userId, 'issuedAt' => $issued];
    }

    public static function currentUser(Store $store): ?array
    {
        $sess = self::readSession();
        if ($sess === null) {
            return null;
        }
        return $store->loadUser($sess['userId']);
    }

    public static function setOAuthStateCookie(string $state, string $provider, string $returnUrl): void
    {
        $token = self::buildToken([
            's' => $state,
            'p' => $provider,
            'r' => $returnUrl,
            't' => self::nowMs(),
        ]);
        self::writeCookie('siamtex_oauth_state', $token, 600);
    }

    /** @return ?array{state:string, provider:string, returnUrl:string, issuedAt:int} */
    public static function readOAuthStateCookie(): ?array
    {
        $raw = (string) ($_COOKIE['siamtex_oauth_state'] ?? '');
        if ($raw === '') {
            return null;
        }
        $payload = self::verifyToken($raw);
        if ($payload === null) {
            return null;
        }
        $issued = isset($payload['t']) ? (int) $payload['t'] : 0;
        if ($issued <= 0 || self::nowMs() - $issued > 15 * 60 * 1000) {
            return null;
        }
        return [
            'state' => (string) ($payload['s'] ?? ''),
            'provider' => (string) ($payload['p'] ?? ''),
            'returnUrl' => (string) ($payload['r'] ?? ''),
            'issuedAt' => $issued,
        ];
    }

    public static function clearOAuthStateCookie(): void
    {
        self::writeCookie('siamtex_oauth_state', '', -3600);
    }

    private static function buildToken(array $payload): string
    {
        $json = json_encode($payload, JSON_THROW_ON_ERROR);
        $b64 = self::base64UrlEncode($json);
        $sig = self::base64UrlEncode(hash_hmac('sha256', $b64, Config::sessionSecret(), true));
        return $b64 . '.' . $sig;
    }

    private static function verifyToken(string $raw): ?array
    {
        $parts = explode('.', $raw, 2);
        if (count($parts) !== 2) {
            return null;
        }
        [$b64, $sig] = $parts;
        $expected = self::base64UrlEncode(hash_hmac('sha256', $b64, Config::sessionSecret(), true));
        if (!hash_equals($expected, $sig)) {
            return null;
        }
        $json = self::base64UrlDecode($b64);
        if ($json === null) {
            return null;
        }
        try {
            $data = json_decode($json, true, 8, JSON_THROW_ON_ERROR);
        } catch (\Throwable $e) {
            return null;
        }
        return is_array($data) ? $data : null;
    }

    private static function writeCookie(string $name, string $value, int $maxAgeSeconds): void
    {
        $secure = Config::isHttpsRequest();
        $params = [
            'expires' => $maxAgeSeconds <= 0 ? 0 : time() + $maxAgeSeconds,
            'path' => '/siamtex',
            'domain' => '',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ];
        setcookie($name, $value, $params);
        if ($value === '') {
            unset($_COOKIE[$name]);
        } else {
            $_COOKIE[$name] = $value;
        }
    }

    private static function base64UrlEncode(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $s): ?string
    {
        $pad = strlen($s) % 4;
        if ($pad > 0) {
            $s .= str_repeat('=', 4 - $pad);
        }
        $out = base64_decode(strtr($s, '-_', '+/'), true);
        return $out === false ? null : $out;
    }

    private static function nowMs(): int
    {
        return (int) floor(microtime(true) * 1000);
    }
}
