<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use InvalidArgumentException;

final class UrlGuard
{
    private const BLOCKED_HOSTS = [
        'localhost',
        '127.0.0.1',
        '0.0.0.0',
        '::1',
        'metadata.google.internal',
    ];

    public static function assertAllowedBaseUrl(string $baseUrl): void
    {
        $parts = parse_url($baseUrl);
        if ($parts === false) {
            throw new InvalidArgumentException('Invalid AI base URL.');
        }
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true)) {
            throw new InvalidArgumentException('AI base URL must use http or https.');
        }
        $host = strtolower((string) ($parts['host'] ?? ''));
        if ($host === '') {
            throw new InvalidArgumentException('AI base URL must include a host.');
        }
        if (in_array($host, self::BLOCKED_HOSTS, true)) {
            throw new InvalidArgumentException('That AI host is not allowed.');
        }
        if (str_ends_with($host, '.localhost') || str_ends_with($host, '.local')) {
            throw new InvalidArgumentException('That AI host is not allowed.');
        }

        $ips = [];
        if (filter_var($host, FILTER_VALIDATE_IP)) {
            $ips[] = $host;
        } else {
            $resolved = @gethostbyname($host);
            if ($resolved !== $host && filter_var($resolved, FILTER_VALIDATE_IP)) {
                $ips[] = $resolved;
            }
        }
        foreach ($ips as $ip) {
            if (self::isBlockedIp($ip)) {
                throw new InvalidArgumentException('AI host resolves to a blocked address.');
            }
        }
    }

    private static function isBlockedIp(string $ip): bool
    {
        if ($ip === '169.254.169.254') {
            return true;
        }
        // Tailscale CGNAT 100.64.0.0/10 — allowed for home Ollama over tailnet.
        if (self::ipInCidr($ip, '100.64.0.0', 10)) {
            return false;
        }
        if (self::ipInCidr($ip, '127.0.0.0', 8)) {
            return true;
        }
        if (self::ipInCidr($ip, '10.0.0.0', 8)) {
            return true;
        }
        if (self::ipInCidr($ip, '172.16.0.0', 12)) {
            return true;
        }
        if (self::ipInCidr($ip, '192.168.0.0', 16)) {
            return true;
        }
        if (self::ipInCidr($ip, '169.254.0.0', 16)) {
            return true;
        }
        return false;
    }

    private static function ipInCidr(string $ip, string $network, int $bits): bool
    {
        $ipLong = ip2long($ip);
        $netLong = ip2long($network);
        if ($ipLong === false || $netLong === false) {
            return false;
        }
        $mask = -1 << (32 - $bits);
        return ($ipLong & $mask) === ($netLong & $mask);
    }
}
