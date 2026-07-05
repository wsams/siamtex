<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;

/** AES-256-GCM envelope encryption for project files at rest. */
final class Crypto
{
    public static function generateProjectKey(): string
    {
        return random_bytes(32);
    }

    public static function wrapProjectKey(string $projectKey): string
    {
        return self::encrypt(Config::masterKey(), $projectKey);
    }

    public static function unwrapProjectKey(string $wrapped): string
    {
        $key = self::decrypt(Config::masterKey(), $wrapped);
        if (strlen($key) !== 32) {
            throw new RuntimeException('Invalid project key.');
        }
        return $key;
    }

    public static function encrypt(string $key, string $plaintext): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $cipher = openssl_encrypt($plaintext, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        if ($cipher === false) {
            throw new RuntimeException('Encryption failed.');
        }
        return base64_encode($iv . $tag . $cipher);
    }

    public static function decrypt(string $key, string $payload): string
    {
        $raw = base64_decode($payload, true);
        if ($raw === false || strlen($raw) < 28) {
            throw new RuntimeException('Invalid ciphertext.');
        }
        $iv = substr($raw, 0, 12);
        $tag = substr($raw, 12, 16);
        $cipher = substr($raw, 28);
        $plain = openssl_decrypt($cipher, 'aes-256-gcm', $key, OPENSSL_RAW_DATA, $iv, $tag);
        if ($plain === false) {
            throw new RuntimeException('Decryption failed.');
        }
        return $plain;
    }
}
