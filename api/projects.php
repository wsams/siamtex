<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $projects = stx_projects()->listProjects($user);
        $usageMap = stx_ai()->usageByProjectForUser((int) $user['id']);
        foreach ($projects as &$project) {
            $project['aiUsage'] = $usageMap[$project['id']] ?? [
                'promptTokens' => 0,
                'completionTokens' => 0,
                'totalTokens' => 0,
                'callCount' => 0,
            ];
        }
        unset($project);
        stx_json(['projects' => $projects]);
    }

    stx_require_csrf();

    if ($method === 'POST') {
        $body = stx_read_json();
        $name = trim((string) ($body['name'] ?? 'Untitled'));
        $template = (string) ($body['template'] ?? 'blank');
        $engine = (string) ($body['engine'] ?? 'pdflatex');
        $project = stx_projects()->create($user, $name !== '' ? $name : 'Untitled', $template, $engine);
        stx_json(['project' => $project], 201);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
