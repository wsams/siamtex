<?php

declare(strict_types=1);

namespace SiamTeX;

/** Parse latex/latexmk logs into structured diagnostics. */
final class LogParser
{
    /**
     * @return list<array{severity:string,file:?string,line:?int,message:string}>
     */
    public static function parse(string $log): array
    {
        $diags = [];
        $lines = preg_split('/\R/', $log) ?: [];
        $fileStack = [];
        $currentFile = null;

        for ($i = 0, $n = count($lines); $i < $n; $i++) {
            $line = $lines[$i];

            // Track open files: "(./foo.tex" or "/path/foo.tex"
            if (preg_match_all('/\(([^() \t]+\.(?:tex|sty|cls|bib))/', $line, $m)) {
                foreach ($m[1] as $f) {
                    $fileStack[] = self::normalizeFile($f);
                    $currentFile = end($fileStack) ?: null;
                }
            }
            $close = substr_count($line, ')');
            $open = substr_count($line, '(');
            $netClose = $close - $open;
            for ($c = 0; $c < $netClose && $fileStack; $c++) {
                array_pop($fileStack);
                $currentFile = $fileStack ? end($fileStack) : null;
            }

            // Missing / undefined citations (natbib, biblatex, classic LaTeX, BibTeX)
            $citeDiag = self::parseCitationDiagnostic($line, $currentFile);
            if ($citeDiag !== null) {
                $diags[] = $citeDiag;
                continue;
            }

            if (preg_match('/^!\\s*(.+)$/', $line, $m)) {
                $msg = $m[1];
                $lineNo = null;
                for ($j = $i + 1; $j < min($i + 8, $n); $j++) {
                    if (preg_match('/^l\\.(\\d+)/', $lines[$j], $lm)) {
                        $lineNo = (int) $lm[1];
                        break;
                    }
                }
                $diags[] = [
                    'severity' => 'error',
                    'file' => $currentFile ?: null,
                    'line' => $lineNo,
                    'message' => $msg,
                ];
                continue;
            }

            if (preg_match('/^==>\\s+Fatal error occurred/i', $line)) {
                $diags[] = [
                    'severity' => 'error',
                    'file' => $currentFile ?: null,
                    'line' => null,
                    'message' => trim($line),
                ];
                continue;
            }

            if (preg_match('/^Latexmk:\\s+(.+error.+)$/i', $line, $m)) {
                $diags[] = [
                    'severity' => 'error',
                    'file' => $currentFile ?: null,
                    'line' => null,
                    'message' => 'Latexmk: ' . trim($m[1]),
                ];
                continue;
            }

            // Classic: "LaTeX Warning: ..."
            if (preg_match('/^LaTeX Warning:\\s*(.+)$/i', $line, $m)) {
                $msg = $m[1];
                $lineNo = null;
                if (preg_match('/on input line (\\d+)/i', $line, $lm)) {
                    $lineNo = (int) $lm[1];
                }
                $diags[] = [
                    'severity' => 'warning',
                    'file' => $currentFile ?: null,
                    'line' => $lineNo,
                    'message' => rtrim($msg, '.'),
                ];
                continue;
            }

            if (preg_match('/^(?:Package|Class)\\s+([^\\s]+)\\s+Warning:\\s*(.+)$/i', $line, $m)) {
                $msg = $m[1] . ': ' . $m[2];
                $lineNo = null;
                if (preg_match('/on input line (\\d+)/i', $line, $lm)) {
                    $lineNo = (int) $lm[1];
                }
                $diags[] = [
                    'severity' => 'warning',
                    'file' => $currentFile ?: null,
                    'line' => $lineNo,
                    'message' => rtrim($msg, '.'),
                ];
                continue;
            }

            if (preg_match('/^Overfull \\\\hbox.*at lines? (\\d+)/i', $line, $m)
                || preg_match('/^Underfull \\\\hbox.*at lines? (\\d+)/i', $line, $m)) {
                $diags[] = [
                    'severity' => 'warning',
                    'file' => $currentFile ?: null,
                    'line' => (int) $m[1],
                    'message' => trim($line),
                ];
            }
        }

        // Deduplicate identical messages
        $seen = [];
        $out = [];
        foreach ($diags as $d) {
            $k = ($d['severity'] ?? '') . '|' . ($d['file'] ?? '') . '|' . ($d['line'] ?? '') . '|' . ($d['message'] ?? '');
            if (isset($seen[$k])) {
                continue;
            }
            $seen[$k] = true;
            $out[] = $d;
        }
        return $out;
    }

    /**
     * @return array{severity:string,file:?string,line:?int,message:string,category?:string,citationKey?:string}|null
     */
    private static function parseCitationDiagnostic(string $line, ?string $currentFile): ?array
    {
        $lineNo = null;
        if (preg_match('/on input line (\\d+)/i', $line, $lm)) {
            $lineNo = (int) $lm[1];
        }

        // LaTeX / natbib: Citation `key' on page N undefined ...
        if (preg_match('/Citation\\s+[`\']([^`\']+)[`\'].*undefined/i', $line, $m)) {
            $key = $m[1];
            return [
                'severity' => 'warning',
                'file' => $currentFile ?: null,
                'line' => $lineNo,
                'message' => 'Missing citation: ' . $key,
                'category' => 'citation',
                'citationKey' => $key,
            ];
        }

        // BibTeX: Warning--I didn't find a database entry for "key"
        if (preg_match('/didn\'t find a database entry for\\s+[\"\']([^\"\']+)[\"\']/i', $line, $m)
            || preg_match('/I didn\'t find a database entry for\\s+[\"\']([^\"\']+)[\"\']/i', $line, $m)) {
            $key = $m[1];
            return [
                'severity' => 'warning',
                'file' => $currentFile ?: null,
                'line' => $lineNo,
                'message' => 'Missing citation: ' . $key,
                'category' => 'citation',
                'citationKey' => $key,
            ];
        }

        // biblatex: entry could not be found / Empty bibliography
        if (preg_match('/entry\\s+[\'`]([^\'`]+)[\'`].*could not be found/i', $line, $m)
            || preg_match('/The following entry could not be found:\\s*(\\S+)/i', $line, $m)) {
            $key = $m[1];
            return [
                'severity' => 'warning',
                'file' => $currentFile ?: null,
                'line' => $lineNo,
                'message' => 'Missing citation: ' . $key,
                'category' => 'citation',
                'citationKey' => $key,
            ];
        }

        return null;
    }

    private static function normalizeFile(string $f): string
    {
        $f = str_replace('\\', '/', $f);
        if (str_starts_with($f, './')) {
            $f = substr($f, 2);
        }
        if (str_contains($f, 'texmf') || str_contains($f, 'texlive')) {
            return '';
        }
        // Prefer project-relative basename paths
        if (str_contains($f, '/')) {
            // Keep last two segments if under /work
            if (preg_match('#(?:^|/)work/(.+)$#', $f, $m)) {
                return $m[1];
            }
        }
        return ltrim($f, '/');
    }
}
