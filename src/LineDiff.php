<?php

declare(strict_types=1);

namespace SiamTeX;

/** Line-oriented unified diff for revision previews. */
final class LineDiff
{
    /**
     * @return list<array{type:string,line:int|null,text:string}>
     */
    public static function hunks(string $from, string $to): array
    {
        $a = self::splitLines($from);
        $b = self::splitLines($to);
        $ops = self::diffOps($a, $b);
        $out = [];
        foreach ($ops as $op) {
            if ($op['type'] === 'eq') {
                foreach ($op['lines'] as $line) {
                    $out[] = ['type' => 'context', 'line' => null, 'text' => $line];
                }
                continue;
            }
            if ($op['type'] === 'del') {
                foreach ($op['lines'] as $i => $line) {
                    $out[] = ['type' => 'delete', 'line' => $op['fromStart'] + $i, 'text' => $line];
                }
                continue;
            }
            foreach ($op['lines'] as $i => $line) {
                $out[] = ['type' => 'insert', 'line' => $op['toStart'] + $i, 'text' => $line];
            }
        }
        return $out;
    }

    public static function unified(string $from, string $to, string $fromLabel = 'before', string $toLabel = 'after'): string
    {
        $a = self::splitLines($from);
        $b = self::splitLines($to);
        $ops = self::diffOps($a, $b);
        $lines = ['--- ' . $fromLabel, '+++ ' . $toLabel];
        foreach ($ops as $op) {
            if ($op['type'] === 'eq') {
                foreach ($op['lines'] as $line) {
                    $lines[] = ' ' . $line;
                }
                continue;
            }
            if ($op['type'] === 'del') {
                foreach ($op['lines'] as $line) {
                    $lines[] = '-' . $line;
                }
                continue;
            }
            foreach ($op['lines'] as $line) {
                $lines[] = '+' . $line;
            }
        }
        return implode("\n", $lines);
    }

    /** @return list<string> */
    private static function splitLines(string $text): array
    {
        if ($text === '') {
            return [];
        }
        $parts = preg_split("/\r\n|\n|\r/", $text);
        return $parts === false ? [] : $parts;
    }

    /**
     * @param list<string> $a
     * @param list<string> $b
     * @return list<array{type:string,lines:list<string>,fromStart?:int,toStart?:int}>
     */
    private static function diffOps(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        $lcs = self::lcsTable($a, $b);
        $ops = [];
        $i = $n;
        $j = $m;
        $stack = [];
        while ($i > 0 || $j > 0) {
            if ($i > 0 && $j > 0 && $a[$i - 1] === $b[$j - 1]) {
                $stack[] = ['type' => 'eq', 'line' => $a[$i - 1]];
                $i--;
                $j--;
                continue;
            }
            if ($j > 0 && ($i === 0 || $lcs[$i][$j - 1] >= $lcs[$i - 1][$j])) {
                $stack[] = ['type' => 'add', 'line' => $b[$j - 1], 'to' => $j - 1];
                $j--;
                continue;
            }
            $stack[] = ['type' => 'del', 'line' => $a[$i - 1], 'from' => $i - 1];
            $i--;
        }
        $stack = array_reverse($stack);

        $ai = 0;
        $bi = 0;
        foreach ($stack as $item) {
            if ($item['type'] === 'eq') {
                $ops = self::flushRun($ops, 'eq', [$item['line']], $ai, $bi);
                $ai++;
                $bi++;
                continue;
            }
            if ($item['type'] === 'del') {
                $ops = self::appendToRun($ops, 'del', $item['line'], (int) $item['from'], $bi);
                $ai++;
                continue;
            }
            $ops = self::appendToRun($ops, 'add', $item['line'], $ai, (int) $item['to']);
            $bi++;
        }
        return $ops;
    }

    /**
     * @param list<string> $a
     * @param list<string> $b
     * @return list<list<int>>
     */
    private static function lcsTable(array $a, array $b): array
    {
        $n = count($a);
        $m = count($b);
        $dp = array_fill(0, $n + 1, array_fill(0, $m + 1, 0));
        for ($i = $n - 1; $i >= 0; $i--) {
            for ($j = $m - 1; $j >= 0; $j--) {
                if ($a[$i] === $b[$j]) {
                    $dp[$i][$j] = 1 + $dp[$i + 1][$j + 1];
                } else {
                    $dp[$i][$j] = max($dp[$i + 1][$j], $dp[$i][$j + 1]);
                }
            }
        }
        return $dp;
    }

    /**
     * @param list<array{type:string,lines:list<string>,fromStart?:int,toStart?:int}> $ops
     * @param list<string> $lines
     * @return list<array{type:string,lines:list<string>,fromStart?:int,toStart?:int}>
     */
    private static function flushRun(array $ops, string $type, array $lines, int $fromStart, int $toStart): array
    {
        if ($lines === []) {
            return $ops;
        }
        $ops[] = [
            'type' => $type,
            'lines' => $lines,
            'fromStart' => $fromStart,
            'toStart' => $toStart,
        ];
        return $ops;
    }

    /**
     * @param list<array{type:string,lines:list<string>,fromStart?:int,toStart?:int}> $ops
     * @return list<array{type:string,lines:list<string>,fromStart?:int,toStart?:int}>
     */
    private static function appendToRun(array $ops, string $type, string $line, int $fromStart, int $toStart): array
    {
        $last = $ops !== [] ? $ops[count($ops) - 1] : null;
        if ($last !== null && $last['type'] === $type) {
            $last['lines'][] = $line;
            $ops[count($ops) - 1] = $last;
            return $ops;
        }
        return self::flushRun($ops, $type, [$line], $fromStart, $toStart);
    }
}
