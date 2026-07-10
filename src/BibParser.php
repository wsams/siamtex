<?php

declare(strict_types=1);

namespace SiamTeX;

/**
 * Lightweight BibTeX parse / serialize for the smart bibliography UI (F-61).
 * Handles common @type{key, field = {value}, ...} entries; not a full BibTeX grammar.
 */
final class BibParser
{
    /**
     * @return list<array{type:string,key:string,fields:array<string,string>}>
     */
    public static function parse(string $bib): array
    {
        $entries = [];
        $len = strlen($bib);
        $i = 0;
        while ($i < $len) {
            $at = strpos($bib, '@', $i);
            if ($at === false) {
                break;
            }
            if (!preg_match('/@([A-Za-z]+)\s*\{/', $bib, $m, 0, $at)) {
                $i = $at + 1;
                continue;
            }
            $type = strtolower($m[1]);
            $braceOpen = $at + strlen($m[0]) - 1; // position of '{'
            if ($type === 'string' || $type === 'preamble' || $type === 'comment') {
                $close = self::matchingBrace($bib, $braceOpen);
                $i = $close === null ? $at + 1 : $close + 1;
                continue;
            }
            $bodyStart = $braceOpen + 1;
            $close = self::matchingBrace($bib, $braceOpen);
            if ($close === null) {
                break;
            }
            $body = substr($bib, $bodyStart, $close - $bodyStart);
            $comma = strpos($body, ',');
            if ($comma === false) {
                $key = trim($body);
                $fieldsRaw = '';
            } else {
                $key = trim(substr($body, 0, $comma));
                $fieldsRaw = substr($body, $comma + 1);
            }
            $key = preg_replace('/\s+/', '', $key) ?? $key;
            if ($key === '') {
                $i = $close + 1;
                continue;
            }
            $entries[] = [
                'type' => $type,
                'key' => $key,
                'fields' => self::parseFields($fieldsRaw),
            ];
            $i = $close + 1;
        }
        return $entries;
    }

    /** @return list<string> */
    public static function keys(string $bib): array
    {
        $keys = [];
        foreach (self::parse($bib) as $e) {
            $keys[] = $e['key'];
        }
        return $keys;
    }

    /**
     * @param array{type:string,key:string,fields:array<string,string>} $entry
     */
    public static function serializeEntry(array $entry): string
    {
        $type = strtolower(trim((string) ($entry['type'] ?? 'article')));
        $key = trim((string) ($entry['key'] ?? ''));
        if ($key === '' || !preg_match('/^[A-Za-z][A-Za-z0-9_:+\/\-]*$/', $key)) {
            throw new \InvalidArgumentException('Invalid citation key.');
        }
        if (!preg_match('/^[a-z]+$/', $type)) {
            throw new \InvalidArgumentException('Invalid entry type.');
        }
        $fields = $entry['fields'] ?? [];
        if (!is_array($fields)) {
            $fields = [];
        }
        $lines = ['@' . $type . '{' . $key . ','];
        $order = ['author', 'title', 'journal', 'booktitle', 'publisher', 'year', 'volume', 'number', 'pages', 'doi', 'url', 'note'];
        $seen = [];
        foreach ($order as $name) {
            if (!array_key_exists($name, $fields)) {
                continue;
            }
            $val = trim((string) $fields[$name]);
            if ($val === '') {
                continue;
            }
            $lines[] = '  ' . $name . '  = {' . self::escapeBraces($val) . '},';
            $seen[$name] = true;
        }
        foreach ($fields as $name => $val) {
            $name = strtolower(trim((string) $name));
            if ($name === '' || isset($seen[$name])) {
                continue;
            }
            if (!preg_match('/^[a-z][a-z0-9\-]*$/', $name)) {
                continue;
            }
            $val = trim((string) $val);
            if ($val === '') {
                continue;
            }
            $lines[] = '  ' . $name . '  = {' . self::escapeBraces($val) . '},';
        }
        // Drop trailing comma on last field line for prettier output
        $last = count($lines) - 1;
        if ($last >= 1) {
            $lines[$last] = rtrim($lines[$last], ',');
        }
        $lines[] = '}';
        return implode("\n", $lines);
    }

    /**
     * Replace or append an entry by citation key.
     *
     * @param array{type:string,key:string,fields:array<string,string>} $entry
     */
    public static function upsert(string $bib, array $entry): string
    {
        $key = trim((string) ($entry['key'] ?? ''));
        if ($key === '') {
            throw new \InvalidArgumentException('Citation key is required.');
        }
        $serialized = self::serializeEntry($entry);
        $range = self::findEntryRange($bib, $key);
        if ($range === null) {
            $bib = rtrim($bib);
            return ($bib === '' ? '' : $bib . "\n\n") . $serialized . "\n";
        }
        [$start, $end] = $range;
        return substr($bib, 0, $start) . $serialized . substr($bib, $end);
    }

    public static function remove(string $bib, string $key): string
    {
        $range = self::findEntryRange($bib, $key);
        if ($range === null) {
            return $bib;
        }
        [$start, $end] = $range;
        $before = substr($bib, 0, $start);
        $after = substr($bib, $end);
        // Trim extra blank lines around the removal
        $before = rtrim($before);
        $after = ltrim($after);
        if ($before === '') {
            return $after === '' ? '' : $after . (str_ends_with($after, "\n") ? '' : "\n");
        }
        return $before . "\n\n" . ($after === '' ? '' : $after . (str_ends_with($after, "\n") ? '' : "\n"));
    }

    /** @return array{0:int,1:int}|null start inclusive, end exclusive */
    private static function findEntryRange(string $bib, string $key): ?array
    {
        $len = strlen($bib);
        $i = 0;
        while ($i < $len) {
            $at = strpos($bib, '@', $i);
            if ($at === false) {
                return null;
            }
            if (!preg_match('/@([A-Za-z]+)\s*\{\s*([^,\s}]+)\s*,?/', $bib, $m, 0, $at)) {
                $i = $at + 1;
                continue;
            }
            $type = strtolower($m[1]);
            $foundKey = $m[2];
            $braceOpen = strpos($bib, '{', $at);
            if ($braceOpen === false) {
                return null;
            }
            $close = self::matchingBrace($bib, $braceOpen);
            if ($close === null) {
                return null;
            }
            $end = $close + 1;
            // Include following newlines so replace/remove stays tidy
            while ($end < $len && ($bib[$end] === "\n" || $bib[$end] === "\r")) {
                $end++;
            }
            if ($type !== 'string' && $type !== 'preamble' && $type !== 'comment'
                && strcasecmp($foundKey, $key) === 0) {
                return [$at, $end];
            }
            $i = $close + 1;
        }
        return null;
    }

    private static function matchingBrace(string $s, int $openPos): ?int
    {
        $len = strlen($s);
        if ($openPos >= $len || $s[$openPos] !== '{') {
            return null;
        }
        $depth = 0;
        for ($i = $openPos; $i < $len; $i++) {
            $ch = $s[$i];
            if ($ch === '{') {
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    return $i;
                }
            }
        }
        return null;
    }

    /** @return array<string,string> */
    private static function parseFields(string $raw): array
    {
        $fields = [];
        $len = strlen($raw);
        $i = 0;
        while ($i < $len) {
            while ($i < $len && preg_match('/[\s,]/', $raw[$i])) {
                $i++;
            }
            if ($i >= $len) {
                break;
            }
            if (!preg_match('/^([A-Za-z][A-Za-z0-9\-]*)\s*=\s*/', substr($raw, $i), $m)) {
                break;
            }
            $name = strtolower($m[1]);
            $i += strlen($m[0]);
            if ($i >= $len) {
                break;
            }
            $val = '';
            if ($raw[$i] === '{') {
                $close = self::matchingBrace($raw, $i);
                if ($close === null) {
                    break;
                }
                $val = substr($raw, $i + 1, $close - $i - 1);
                $i = $close + 1;
            } elseif ($raw[$i] === '"') {
                $i++;
                $start = $i;
                while ($i < $len && $raw[$i] !== '"') {
                    if ($raw[$i] === '\\' && $i + 1 < $len) {
                        $i += 2;
                        continue;
                    }
                    $i++;
                }
                $val = substr($raw, $start, $i - $start);
                if ($i < $len) {
                    $i++;
                }
            } else {
                // bare number or identifier
                if (preg_match('/^([^,\s}]+)/', substr($raw, $i), $nm)) {
                    $val = $nm[1];
                    $i += strlen($nm[1]);
                } else {
                    break;
                }
            }
            $fields[$name] = trim($val);
        }
        return $fields;
    }

    private static function escapeBraces(string $val): string
    {
        // Preserve intentional TeX braces; only balance is not enforced here.
        return str_replace(["\r\n", "\r"], "\n", $val);
    }
}
