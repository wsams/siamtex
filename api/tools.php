<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    stx_require_csrf();
    $body = stx_read_json();
    $tool = (string) ($body['tool'] ?? '');

    if ($tool === 'page_estimate') {
        $words = max(0, (int) ($body['words'] ?? 0));
        $wordsPerPage = max(100, (int) ($body['wordsPerPage'] ?? 300));
        $pages = $words > 0 ? $words / $wordsPerPage : 0;
        stx_json([
            'words' => $words,
            'wordsPerPage' => $wordsPerPage,
            'estimatedPages' => round($pages, 2),
            'note' => 'Rough estimate; figures, equations, and formatting change real length.',
        ]);
    }

    if ($tool === 'geometry') {
        $margin = (string) ($body['margin'] ?? '1in');
        $paper = (string) ($body['paper'] ?? 'letter');
        $snippet = "\\usepackage[{$paper}paper,margin={$margin}]{geometry}";
        stx_json([
            'snippet' => $snippet,
            'hint' => 'Add this to your preamble, or adjust margin (e.g. 0.75in, 2.5cm).',
        ]);
    }

    if ($tool === 'word_count') {
        $text = (string) ($body['text'] ?? '');
        // Strip common LaTeX commands for a rough count
        $plain = preg_replace('/\\\\(begin|end)\\{[^}]+\\}/', ' ', $text) ?? $text;
        $plain = preg_replace('/\\\\[a-zA-Z]+\\*?(\\[[^\\]]*\\])?(\\{[^}]*\\})?/', ' ', $plain) ?? $plain;
        $plain = preg_replace('/[{}%$]/', ' ', $plain) ?? $plain;
        $words = str_word_count($plain);
        stx_json(['words' => $words, 'chars' => strlen($text)]);
    }

    stx_json(['error' => 'Unknown tool'], 400);
} catch (Throwable $e) {
    stx_http_error($e);
}
