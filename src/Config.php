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
        return (int) (getenv('SIAMTEX_MAX_UPLOAD_BYTES') ?: (10 * 1024 * 1024));
    }

    /**
     * Max size for a single Word/DOCX import upload (default 50 MB).
     * Not capped by maxUploadBytes() — DOCX with figures is often larger than a single asset.
     */
    public static function maxDocxImportBytes(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_BYTES') ?: (50 * 1024 * 1024));
        if ($n < 1024 * 1024) {
            $n = 50 * 1024 * 1024;
        }
        return min($n, 200 * 1024 * 1024);
    }

    /**
     * Max characters of extracted DOCX text kept for preview / AI context (default 500k).
     */
    public static function maxDocxExtractChars(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_EXTRACT_CHARS') ?: '500000');
        return $n > 5000 ? $n : 500000;
    }

    /**
     * Max DOCX files per import request (default 5).
     */
    public static function maxDocxImportFiles(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_FILES') ?: '5');
        return $n > 0 ? min($n, 10) : 5;
    }

    /** Max images/figures extracted from one DOCX (default 40). */
    public static function maxDocxMediaFiles(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_MEDIA_FILES') ?: '40');
        return $n > 0 ? min($n, 100) : 40;
    }

    /** Max bytes per extracted image (default 15 MB). */
    public static function maxDocxMediaBytes(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_MEDIA_BYTES') ?: (15 * 1024 * 1024));
        return $n > 64 * 1024 ? min($n, 50 * 1024 * 1024) : 15 * 1024 * 1024;
    }

    /** Max total bytes of all extracted images from one DOCX (default 80 MB). */
    public static function maxDocxMediaTotalBytes(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_MEDIA_TOTAL_BYTES') ?: (80 * 1024 * 1024));
        return $n > 1024 * 1024 ? min($n, 200 * 1024 * 1024) : 80 * 1024 * 1024;
    }

    /** Max bytes for a single OOXML XML part (document.xml etc., default 32 MB). */
    public static function maxDocxXmlPartBytes(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_DOCX_XML_PART_BYTES') ?: (32 * 1024 * 1024));
        return $n > 1024 * 1024 ? min($n, 64 * 1024 * 1024) : 32 * 1024 * 1024;
    }

    public static function artifactRetentionDays(): int
    {
        return (int) (getenv('SIAMTEX_ARTIFACT_RETENTION_DAYS') ?: '7');
    }

    public static function softDeleteDays(): int
    {
        return (int) (getenv('SIAMTEX_SOFT_DELETE_DAYS') ?: '30');
    }

    public static function aiEnabled(): bool
    {
        $raw = getenv('SIAMTEX_AI_ENABLED');
        if ($raw !== false) {
            $v = strtolower(trim((string) $raw));
            if (in_array($v, ['0', 'false', 'no', 'off'], true)) {
                return false;
            }
            if (in_array($v, ['1', 'true', 'yes', 'on'], true)) {
                return true;
            }
        }
        return self::aiBaseUrl() !== '';
    }

    public static function aiProvider(): string
    {
        $v = trim((string) (getenv('SIAMTEX_AI_PROVIDER') ?: 'ollama'));
        return $v !== '' ? $v : 'ollama';
    }

    public static function aiBaseUrl(): string
    {
        return rtrim(trim((string) (getenv('SIAMTEX_AI_BASE_URL') ?: '')), '/');
    }

    public static function aiModel(): string
    {
        return trim((string) (getenv('SIAMTEX_AI_MODEL') ?: ''));
    }

    public static function aiApiKey(): string
    {
        return trim((string) (getenv('SIAMTEX_AI_API_KEY') ?: ''));
    }

    public static function aiMaxTokens(): int
    {
        $n = (int) (getenv('SIAMTEX_AI_MAX_TOKENS') ?: '16384');
        return $n > 256 ? $n : 16384;
    }

    public static function aiTimeoutSeconds(): int
    {
        $n = (int) (getenv('SIAMTEX_AI_TIMEOUT') ?: '120');
        return $n > 10 ? $n : 120;
    }

    public static function aiMaxCallsPerHour(): int
    {
        $n = (int) (getenv('SIAMTEX_AI_MAX_CALLS_PER_HOUR') ?: '20');
        return $n > 0 ? $n : 20;
    }

    public static function aiMaxContextChars(): int
    {
        $n = (int) (getenv('SIAMTEX_AI_MAX_CONTEXT_CHARS') ?: '200000');
        return $n > 5000 ? $n : 200000;
    }

    /**
     * GitHub logins (lowercase) that receive administrator + full AI access.
     *
     * @return list<string>
     */
    public static function adminGithubLogins(): array
    {
        $raw = getenv('SIAMTEX_ADMIN_GITHUB_LOGINS');
        if ($raw === false || $raw === '') {
            $raw = $_SERVER['SIAMTEX_ADMIN_GITHUB_LOGINS'] ?? '';
        }
        $raw = trim((string) $raw);
        if ($raw === '') {
            return [];
        }
        $parts = preg_split('/[\s,;]+/', $raw) ?: [];
        $out = [];
        foreach ($parts as $p) {
            $p = strtolower(trim($p));
            if ($p !== '') {
                $out[] = $p;
            }
        }
        return array_values(array_unique($out));
    }

    public static function maxFileRevisions(): int
    {
        $n = (int) (getenv('SIAMTEX_MAX_FILE_REVISIONS') ?: '150');
        return $n >= 20 ? $n : 150;
    }
}
