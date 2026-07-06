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

    /** Remove markdown / prompt delimiter artifacts models sometimes echo back. */
    public static function sanitizeLatex(string $text): string
    {
        $t = trim($text);
        if ($t === '') {
            return $t;
        }

        if (preg_match('/^---\s*\R/', $t)) {
            if (preg_match('/^---\s*\R([\s\S]*?)\R---\s*$/', $t, $m)) {
                $t = trim($m[1]);
            } else {
                $t = (string) preg_replace('/^---\s*\R+/', '', $t);
                $t = (string) preg_replace('/\R---\s*$/', '', $t);
            }
        }

        if (preg_match('/^<file\b[^>]*>\s*\R/i', $t)
            && preg_match('/^<file\b[^>]*>\s*\R([\s\S]*?)\R<\/file>\s*$/i', $t, $m)) {
            $t = trim($m[1]);
        }

        $t = (string) preg_replace('/^###\s+[^\n]+\n---\s*\R+/m', '', $t);

        return trim($t);
    }

    /**
     * @param array<string, string> $sourceFiles Original project files (enables "replacements" fix mode)
     * @return array{summary:string, files:array<string, string>, notes:list<string>}
     */
    public static function parseMultiFileJson(string $raw, ?string $finishReason = null, array $sourceFiles = []): array
    {
        $text = self::stripFences($raw);
        $data = self::decodeJsonObject($text);
        $salvaged = false;
        if ($data === null) {
            $data = self::salvageMultiFilePayload($text);
            if ($data === null) {
                $hint = strlen($text) > 200
                    ? ' Model returned: ' . substr(preg_replace('/\s+/', ' ', $text) ?? $text, 0, 160) . '…'
                    : '';
                $truncated = $finishReason === 'length' || self::looksTruncatedJson($text);
                $msg = $truncated
                    ? 'AI response was cut off (token limit) before valid JSON finished. Try fixing one file at a time, shorten the source, or increase SIAMTEX_AI_MAX_TOKENS.'
                    : 'AI response was not valid JSON. Try again, or use a smaller project if the model ran out of context.';
                throw new RuntimeException($msg . $hint);
            }
            $salvaged = true;
        }
        $data = self::normalizePayload($data);
        $files = self::collectFiles($data);
        $files = array_merge($files, self::applyReplacements($data, $sourceFiles));
        if ($files === []) {
            throw new RuntimeException('AI returned no file updates. The model may have refused or used an unexpected JSON shape.');
        }
        $notes = self::collectNotes($data);
        if ($salvaged || $finishReason === 'length') {
            $notes[] = 'Response may have been truncated — review the diff carefully before accepting.';
        }
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

    /**
     * @return array{summary:string, name:string, mainFile:string, engine:string, files:array<string, string>, notes:list<string>}
     */
    public static function parseNewProjectJson(string $raw, ?string $finishReason = null): array
    {
        $text = self::stripFences($raw);
        $data = self::decodeJsonObject($text);
        if ($data === null) {
            $data = self::salvageMultiFilePayload($text);
        }
        if ($data === null) {
            throw new RuntimeException(
                'AI response was not valid JSON. Try a shorter prompt or a different model.'
            );
        }
        $parsed = self::parseMultiFileJson($raw, $finishReason);
        $name = trim((string) ($data['name'] ?? $data['title'] ?? 'AI Project'));
        if ($name === '') {
            $name = 'AI Project';
        }
        $mainFile = trim((string) ($data['mainFile'] ?? $data['main_file'] ?? 'main.tex'));
        if ($mainFile === '' || str_contains($mainFile, '..')) {
            $mainFile = 'main.tex';
        }
        if (!isset($parsed['files'][$mainFile])) {
            $keys = array_keys($parsed['files']);
            if ($keys !== []) {
                $mainFile = (string) $keys[0];
            }
        }
        $engine = trim((string) ($data['engine'] ?? 'pdflatex'));
        if (!in_array($engine, ['pdflatex', 'xelatex', 'lualatex'], true)) {
            $engine = 'pdflatex';
        }
        return [
            'summary' => $parsed['summary'],
            'name' => $name,
            'mainFile' => $mainFile,
            'engine' => $engine,
            'files' => $parsed['files'],
            'notes' => $parsed['notes'],
        ];
    }

    public static function parseSingleFile(string $raw): string
    {
        $text = self::stripFences($raw);
        $data = self::decodeJsonObject($text);
        if (is_array($data)) {
            foreach (['content', 'file', 'text', 'latex'] as $key) {
                if (isset($data[$key]) && is_string($data[$key]) && $data[$key] !== '') {
                    return self::sanitizeLatex($data[$key]);
                }
            }
            if (isset($data['files']) && is_array($data['files'])) {
                foreach ($data['files'] as $content) {
                    if (is_string($content) && $content !== '') {
                        return self::sanitizeLatex($content);
                    }
                }
            }
        }
        return self::sanitizeLatex($text);
    }

    /** @param array<string, mixed> $data */
    private static function collectFiles(array $data): array
    {
        $files = [];
        foreach ((array) ($data['files'] ?? []) as $path => $content) {
            if (!is_string($path) || !is_string($content) || $path === '' || str_contains($path, '..')) {
                continue;
            }
            $files[$path] = self::sanitizeLatex($content);
        }
        return $files;
    }

    /**
     * @param array<string, mixed> $data
     * @param array<string, string> $sourceFiles
     * @return array<string, string>
     */
    private static function applyReplacements(array $data, array $sourceFiles): array
    {
        if ($sourceFiles === []) {
            return [];
        }
        $out = [];
        foreach ((array) ($data['replacements'] ?? []) as $path => $ops) {
            if (!is_string($path) || $path === '' || str_contains($path, '..') || !isset($sourceFiles[$path]) || !is_array($ops)) {
                continue;
            }
            $content = $sourceFiles[$path];
            $changed = false;
            foreach ($ops as $op) {
                if (!is_array($op)) {
                    continue;
                }
                $old = $op['old'] ?? $op['find'] ?? null;
                $new = $op['new'] ?? $op['replace'] ?? $op['replacement'] ?? null;
                if (!is_string($old) || !is_string($new) || $old === '') {
                    continue;
                }
                if (!str_contains($content, $old)) {
                    continue;
                }
                $content = str_replace($old, $new, $content);
                $changed = true;
            }
            if ($changed) {
                $out[$path] = self::sanitizeLatex($content);
            }
        }
        return $out;
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
        $balanced = self::extractBalancedJsonObject(trim($text));
        if ($balanced !== null) {
            $candidates[] = $balanced;
        }
        if (preg_match('/\{[\s\S]*\}/', $text, $m)) {
            $candidates[] = $m[0];
        }
        $candidates = array_values(array_unique(array_filter($candidates)));

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

    private static function looksTruncatedJson(string $text): bool
    {
        $t = trim($text);
        if ($t === '' || !str_starts_with($t, '{')) {
            return false;
        }
        if (self::extractBalancedJsonObject($t) !== null) {
            return false;
        }
        return str_contains($t, '"files"');
    }

    private static function extractBalancedJsonObject(string $text): ?string
    {
        $start = strpos($text, '{');
        if ($start === false) {
            return null;
        }
        $depth = 0;
        $inString = false;
        $escape = false;
        $len = strlen($text);
        for ($i = $start; $i < $len; $i++) {
            $c = $text[$i];
            if ($inString) {
                if ($escape) {
                    $escape = false;
                    continue;
                }
                if ($c === '\\') {
                    $escape = true;
                    continue;
                }
                if ($c === '"') {
                    $inString = false;
                }
                continue;
            }
            if ($c === '"') {
                $inString = true;
                continue;
            }
            if ($c === '{') {
                $depth++;
            } elseif ($c === '}') {
                $depth--;
                if ($depth === 0) {
                    return substr($text, $start, $i - $start + 1);
                }
            }
        }
        return null;
    }

    /**
     * Best-effort recovery when models return truncated or slightly malformed JSON.
     *
     * @return array<string, mixed>|null
     */
    private static function salvageMultiFilePayload(string $text): ?array
    {
        if (str_contains($text, '"replacements"')) {
            $summary = 'Suggested updates';
            if (preg_match('/"summary"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/s', $text, $m)) {
                $summary = stripcslashes($m[1]);
            }
            $replacements = [];
            if (preg_match_all(
                '/"((?:[^"\\\\]|\\\\.)*\.(?:tex|bib|sty|cls))"\s*:\s*\[\s*\{\s*"old"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"\s*,\s*"new"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"\s*\}/s',
                $text,
                $matches,
                PREG_SET_ORDER,
            )) {
                foreach ($matches as $m) {
                    $path = stripcslashes($m[1]);
                    if ($path === '' || str_contains($path, '..')) {
                        continue;
                    }
                    $replacements[$path][] = [
                        'old' => stripcslashes($m[2]),
                        'new' => stripcslashes($m[3]),
                    ];
                }
            }
            if ($replacements !== []) {
                return [
                    'summary' => $summary,
                    'replacements' => $replacements,
                    'files' => [],
                    'notes' => [],
                ];
            }
        }

        if (!str_contains($text, '"files"')) {
            return null;
        }

        $summary = 'Suggested updates';
        if (preg_match('/"summary"\s*:\s*"((?:[^"\\\\]|\\\\.)*)"/s', $text, $m)) {
            $summary = stripcslashes($m[1]);
        }

        $files = [];
        $filesPos = strpos($text, '"files"');
        if ($filesPos === false) {
            return null;
        }
        $brace = strpos($text, '{', $filesPos);
        if ($brace === false) {
            return null;
        }

        $pos = $brace + 1;
        $len = strlen($text);
        while ($pos < $len) {
            $pos = self::skipJsonWs($text, $pos);
            if ($pos >= $len || $text[$pos] === '}') {
                break;
            }

            $key = self::readJsonString($text, $pos);
            if ($key === null) {
                break;
            }
            $pos = self::skipJsonWs($text, $pos);
            if ($pos >= $len || $text[$pos] !== ':') {
                break;
            }
            $pos++;
            $pos = self::skipJsonWs($text, $pos);

            $value = self::readJsonString($text, $pos);
            if ($value === null) {
                break;
            }
            if ($key !== '' && !str_contains($key, '..') && preg_match('/\.(tex|bib|sty|cls)$/i', $key)) {
                $files[$key] = $value;
            }

            $pos = self::skipJsonWs($text, $pos);
            if ($pos < $len && $text[$pos] === ',') {
                $pos++;
                continue;
            }
            break;
        }

        if ($files === []) {
            return null;
        }

        return [
            'summary' => $summary,
            'files' => $files,
            'notes' => [],
        ];
    }

    private static function skipJsonWs(string $text, int $pos): int
    {
        $len = strlen($text);
        while ($pos < $len && ctype_space($text[$pos])) {
            $pos++;
        }
        return $pos;
    }

    private static function readJsonString(string $text, int &$pos, bool $allowUnterminated = false): ?string
    {
        $pos = self::skipJsonWs($text, $pos);
        $len = strlen($text);
        if ($pos >= $len || $text[$pos] !== '"') {
            return null;
        }
        $pos++;
        $buf = '';
        while ($pos < $len) {
            $c = $text[$pos++];
            if ($c === '"') {
                return $buf;
            }
            if ($c === '\\' && $pos < $len) {
                $n = $text[$pos++];
                $buf .= match ($n) {
                    '"', '\\', '/' => $n,
                    'n' => "\n",
                    'r' => "\r",
                    't' => "\t",
                    default => $n,
                };
                continue;
            }
            $buf .= $c;
        }
        if ($allowUnterminated && strlen($buf) >= 40) {
            return $buf;
        }
        return null;
    }
}
