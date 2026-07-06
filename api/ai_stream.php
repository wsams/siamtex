<?php

declare(strict_types=1);

define('STX_NO_JSON_HEADER', true);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Ai\AiUsage;

$streamStarted = false;

try {
    $user = stx_require_user();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        stx_json(['error' => 'Method not allowed'], 405);
    }
    stx_require_csrf();
    $body = stx_read_json();
    $ai = stx_ai();
    $projectId = (string) ($body['projectId'] ?? '');
    $mode = (string) ($body['mode'] ?? 'file');
    $instruction = (string) ($body['instruction'] ?? '');

    if ($mode !== 'create_project' && $projectId === '') {
        stx_json(['error' => 'projectId is required'], 400);
    }

    stx_sse_begin();
    $streamStarted = true;
    $abort = static fn (): bool => stx_client_aborted();

    $sendUsage = static function (AiUsage $usage): void {
        stx_sse_send('progress', ['usage' => $usage->toPublicArray()]);
    };
    $sendDelta = static function (string $text): void {
        if ($text !== '') {
            stx_sse_send('delta', ['text' => $text]);
        }
    };

    if ($mode === 'create_project') {
        $prompt = (string) ($body['prompt'] ?? $instruction);
        $nameHint = trim((string) ($body['name'] ?? ''));
        $engine = (string) ($body['engine'] ?? 'pdflatex');
        $result = $ai->createProjectStream(
            $user,
            $prompt,
            $nameHint,
            $engine,
            static fn (string $message) => stx_sse_send('status', ['message' => $message]),
            $sendUsage,
            $sendDelta,
            $abort,
        );
        stx_sse_send('done', [
            'mode' => 'create_project',
            'project' => $result['project'],
            'result' => [
                'summary' => $result['summary'],
                'files' => $result['files'],
                'notes' => $result['notes'],
            ],
            'usage' => $result['usage'],
            'usageTotals' => $result['usageTotals'],
        ]);
        exit;
    }

    if ($mode === 'project') {
        if ($instruction === '') {
            stx_sse_send('error', ['error' => 'instruction is required']);
            exit;
        }
        $extra = (string) ($body['context'] ?? '');
        $result = $ai->editProjectStream(
            $user,
            $projectId,
            $instruction,
            $extra,
            static fn (string $message) => stx_sse_send('status', ['message' => $message]),
            $sendUsage,
            $sendDelta,
            $abort,
        );
        stx_sse_send('done', [
            'mode' => 'project',
            'result' => [
                'summary' => $result['summary'],
                'files' => $result['files'],
                'notes' => $result['notes'],
            ],
            'usage' => $result['usage'],
            'usageTotals' => $result['usageTotals'],
        ]);
        exit;
    }

    if ($mode === 'fix_problems') {
        $result = $ai->fixProblemsStream(
            $user,
            $projectId,
            static fn (string $message) => stx_sse_send('status', ['message' => $message]),
            $sendUsage,
            $sendDelta,
            $abort,
        );
        stx_sse_send('done', [
            'mode' => 'fix_problems',
            'result' => [
                'summary' => $result['summary'],
                'files' => $result['files'],
                'notes' => $result['notes'],
            ],
            'usage' => $result['usage'],
            'usageTotals' => $result['usageTotals'],
        ]);
        exit;
    }

    $path = (string) ($body['path'] ?? '');
    if ($path === '') {
        stx_sse_send('error', ['error' => 'path is required for file mode']);
        exit;
    }
    if ($instruction === '') {
        stx_sse_send('error', ['error' => 'instruction is required']);
        exit;
    }

    stx_sse_send('status', ['message' => 'Sending context to the model…']);
    $result = $ai->editFileStream(
        $user,
        $projectId,
        $path,
        $instruction,
        static fn (string $text) => stx_sse_send('delta', ['text' => $text]),
        $sendUsage,
        $abort,
    );
    stx_sse_send('done', [
        'mode' => 'file',
        'result' => [
            'summary' => $result['summary'],
            'path' => $result['path'],
            'content' => $result['content'],
        ],
        'usage' => $result['usage'],
        'usageTotals' => $result['usageTotals'],
    ]);
} catch (Throwable $e) {
    if (empty($streamStarted)) {
        stx_http_error($e);
    }
    if (empty($streamStarted)) {
        stx_sse_begin();
    }
    stx_sse_fail($e);
}
