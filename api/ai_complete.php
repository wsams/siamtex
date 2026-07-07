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
    $ai = stx_ai();
    $projectId = (string) ($body['projectId'] ?? '');
    $mode = (string) ($body['mode'] ?? 'file');
    $instruction = (string) ($body['instruction'] ?? '');

    if ($projectId === '') {
        stx_json(['error' => 'projectId is required'], 400);
    }

    if ($mode === 'project') {
        $extra = (string) ($body['context'] ?? '');
        $result = $ai->editProject($user, $projectId, $instruction, $extra);
        stx_json(['mode' => 'project', 'result' => $result]);
    }

    if ($mode === 'fix_problems') {
        $entry = trim((string) ($body['entry'] ?? ''));
        $result = $ai->fixProblems($user, $projectId, $entry !== '' ? $entry : null);
        stx_json(['mode' => 'fix_problems', 'result' => $result]);
    }

    $path = (string) ($body['path'] ?? '');
    if ($path === '') {
        stx_json(['error' => 'path is required for file mode'], 400);
    }
    $result = $ai->editFile($user, $projectId, $path, $instruction);
    stx_json(['mode' => 'file', 'result' => $result]);
} catch (Throwable $e) {
    stx_http_error($e);
}
