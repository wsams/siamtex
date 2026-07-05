<?php

declare(strict_types=1);

namespace SiamTeX;

final class Config
{
    public static function baseDir(): string
    {
        return dirname(__DIR__);
    }

    public static function dataDir(): string
    {
        $dir = self::baseDir() . '/data';
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        return $dir;
    }

    public static function projectsDir(): string
    {
        $dir = self::dataDir() . '/projects';
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        return $dir;
    }

    public static function tmpDir(): string
    {
        $dir = self::dataDir() . '/tmp';
        if (!is_dir($dir)) {
            mkdir($dir, 0770, true);
        }
        return $dir;
    }

    public static function dbPath(): string
    {
        return self::dataDir() . '/siamtex.sqlite';
    }

    public static function templatesDir(): string
    {
        return self::baseDir() . '/templates';
    }

    public static function debug(): bool
    {
        $v = strtolower((string) (getenv('SIAMTEX_DEBUG') ?: ''));
        return in_array($v, ['1', 'true', 'yes', 'on'], true);
    }

    public static function authRequired(): bool
    {
        // Default: require auth only when GitHub OAuth is configured.
        if (self::githubClientId() === '' || self::githubClientSecret() === '') {
            return false;
        }
        $raw = getenv('SIAMTEX_AUTH_REQUIRED');
        if ($raw === false) {
            return true;
        }
        $v = strtolower(trim((string) $raw));
        if (in_array($v, ['0', 'false', 'no', 'off'], true)) {
            return false;
        }
        return true;
    }

    public static function oauthBaseUrl(): string
    {
        $env = trim((string) (getenv('SIAMTEX_OAUTH_BASE_URL') ?: ''));
        if ($env !== '') {
            return rtrim($env, '/');
        }
        $scheme = self::isHttpsRequest() ? 'https' : 'http';
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
        $script = (string) ($_SERVER['SCRIPT_NAME'] ?? '/siamtex/index.php');
        $base = rtrim(str_replace('\\', '/', dirname($script)), '/');
        if (str_ends_with($base, '/api')) {
            $base = substr($base, 0, -4);
        }
        return $scheme . '://' . $host . $base;
    }

    public static function githubClientId(): string
    {
        return trim((string) (getenv('SIAMTEX_GITHUB_CLIENT_ID') ?: ''));
    }

    public static function githubClientSecret(): string
    {
        return trim((string) (getenv('SIAMTEX_GITHUB_CLIENT_SECRET') ?: ''));
    }

    public static function sessionCookieName(): string
    {
        $env = trim((string) (getenv('SIAMTEX_SESSION_COOKIE_NAME') ?: ''));
        return $env !== '' ? $env : 'siamtex_session';
    }

    public static function sessionSecret(): string
    {
        $env = trim((string) (getenv('SIAMTEX_SESSION_SECRET') ?: ''));
        if ($env !== '') {
            return $env;
        }
        $file = self::dataDir() . '/session_secret.txt';
        if (is_file($file)) {
            $v = trim((string) @file_get_contents($file));
            if ($v !== '') {
                return $v;
            }
        }
        $new = bin2hex(random_bytes(32));
        file_put_contents($file, $new . "\n");
        chmod($file, 0640);
        return $new;
    }

    public static function masterKey(): string
    {
        $env = trim((string) (getenv('SIAMTEX_MASTER_KEY') ?: ''));
        if ($env !== '') {
            $raw = self::decodeKey($env);
            if ($raw !== null) {
                return $raw;
            }
        }
        $file = self::dataDir() . '/master.key';
        if (is_file($file)) {
            $v = trim((string) file_get_contents($file));
            $raw = self::decodeKey($v);
            if ($raw !== null) {
                return $raw;
            }
        }
        $raw = random_bytes(32);
        file_put_contents($file, base64_encode($raw) . "\n");
        chmod($file, 0640);
        return $raw;
    }

    private static function decodeKey(string $v): ?string
    {
        if (preg_match('/^[0-9a-fA-F]{64}$/', $v)) {
            return hex2bin($v) ?: null;
        }
        $bin = base64_decode($v, true);
        if ($bin !== false && strlen($bin) === 32) {
            return $bin;
        }
        return null;
    }

    public static function sessionLifetimeDays(): int
    {
        $env = (int) (getenv('SIAMTEX_SESSION_LIFETIME_DAYS') ?: '30');
        return $env > 0 ? $env : 30;
    }

    public static function isHttpsRequest(): bool
    {
        if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') {
            return true;
        }
        return ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https';
    }

    public static function dockerImage(): string
    {
        return trim((string) (getenv('SIAMTEX_DOCKER_IMAGE') ?: 'siamtex-tex-worker:local'));
    }

    public static function dockerBinary(): string
    {
        return trim((string) (getenv('SIAMTEX_DOCKER_BIN') ?: '/usr/bin/docker'));
    }

    public static function compileMemory(): string
    {
        return trim((string) (getenv('SIAMTEX_COMPILE_MEMORY') ?: '512m'));
    }

    public static function compileTimeoutSeconds(): int
    {
        $n = (int) (getenv('SIAMTEX_COMPILE_TIMEOUT') ?: '60');
        return $n > 5 ? $n : 60;
    }

    public static function maxUploadBytes(): int
    {
        return (int) (getenv('SIAMTEX_MAX_UPLOAD_BYTES') ?: (5 * 1024 * 1024));
    }

    public static function artifactRetentionDays(): int
    {
        return (int) (getenv('SIAMTEX_ARTIFACT_RETENTION_DAYS') ?: '7');
    }

    public static function softDeleteDays(): int
    {
        return (int) (getenv('SIAMTEX_SOFT_DELETE_DAYS') ?: '30');
    }
}
