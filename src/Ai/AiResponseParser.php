<?php

declare(strict_types=1);

namespace SiamTeX\Ai;

use JsonException;
use RuntimeException;

final class AiResponseParser
{
    public static function stripFences(string $text): string
    {
        $t = trim($text);
        if (preg_match('/^```(?:latex|tex|json)?\s*\n([\s\S]*?)\n```\s*$/s', $t, $m)) {
            return trim($m[1]);
        }
        if (preg_match('/^```(?:latex|tex|json)?\s*\n([\s\S]+)/s', $t, $m)) {
            return trim($m[1]);
        }
        return $t;
    }

    /**
     * @return array{summary:string, files:array<string, string>, notes:list<string>}
     */
    public static function parseMultiFileJson(string $raw): array
    {
        $text = self::stripFences($raw);
        $data = self::decodeJsonObject($text);
        if ($data === null) {
            $hint = strlen($text) > 200
                ? ' Model returned: ' . substr(preg_replace('/\s+/', ' ', $text) ?? $text, 0, 160) . '…'
                : '';
            throw new RuntimeException(
                'AI response was not valid JSON. Try again, or use a smaller project if the model ran out of context.'
                . $hint
            );
        }
        $data = self::normalizePayload($data);
        $files = [];
        foreach ((array) ($data['files'] ?? []) as $path => $content) {
            if (!is_string($path) || !is_string($content) || $path === '' || str_contains($path, '..')) {
                continue;
            }
            $files[$path] = $content;
        }
        if ($files === []) {
            throw new RuntimeException('AI returned no file updates. The model may have refused or used an unexpected JSON shape.');
        }
        $notes = self::collectNotes($data);
        $summary = trim((string) ($data['summary'] ?? $data['message'] ?? 'Suggested updates'));
        if ($summary === '') {
            $summary = 'Suggested updates';
        }
        return [
            'summary' => $summary,
            'files' => $files,
            'notes' => $notes,
        ];
    }

    public static function parseSingleFile(string $raw): string
    {
        $text = self::stripFences($raw);
        $data = self::decodeJsonObject($text);
        if (is_array($data)) {
            foreach (['content', 'file', 'text', 'latex'] as $key) {
                if (isset($data[$key]) && is_string($data[$key]) && $data[$key] !== '') {
                    return $data[$key];
                }
            }
            if (isset($data['files']) && is_array($data['files'])) {
                foreach ($data['files'] as $content) {
                    if (is_string($content) && $content !== '') {
                        return $content;
                    }
                }
            }
        }
        return $text;
    }

    /** @return array<string, mixed> */
    private static function normalizePayload(array $data): array
    {
        if (isset($data['files']) && is_array($data['files'])) {
            foreach ($data['files'] as $path => $content) {
                if (!is_string($content) || in_array($path, ['notes', 'summary', 'message', 'status'], true)) {
                    unset($data['files'][$path]);
                }
            }
        }
        return $data;
    }

    /** @param array<string, mixed> $data */
    private static function collectNotes(array $data): array
    {
        $notes = [];
        foreach ((array) ($data['notes'] ?? []) as $n) {
            if (is_string($n) && $n !== '') {
                $notes[] = $n;
            } elseif (is_array($n)) {
                $t = (string) ($n['text'] ?? $n['message'] ?? '');
                if ($t !== '') {
                    $notes[] = $t;
                }
            }
        }
        return $notes;
    }

    /** @return array<string, mixed>|null */
    private static function decodeJsonObject(string $text): ?array
    {
        $candidates = [trim($text)];
        if (preg_match('/\{[\s\S]*\}/', $text, $m)) {
            $candidates[] = $m[0];
        }
        foreach ($candidates as $candidate) {
            $candidate = trim($candidate);
            if ($candidate === '') {
                continue;
            }
            try {
                $data = json_decode($candidate, true, 512, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                continue;
            }
            if (is_array($data)) {
                return $data;
            }
        }
        return null;
    }
}
