<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

try {
    $user = stx_require_user();
    $id = (string) ($_GET['id'] ?? '');
    $path = (string) ($_GET['path'] ?? '');
    if ($id === '') {
        stx_json(['error' => 'Missing id'], 400);
    }
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        stx_projects()->requireRole($user, $id, ['owner', 'edit', 'view']);
        if ($path === '') {
            stx_json(['error' => 'Missing path'], 400);
        }
        $action = (string) ($_GET['action'] ?? 'list');
        $history = stx_projects()->historyService();
        $project = stx_projects()->getProject($id);
        if ($project === null) {
            stx_json(['error' => 'Project not found.'], 404);
        }
        $key = stx_projects()->projectKey($project);

        if ($action === 'list') {
            stx_json([
                'path' => $path,
                'revisions' => $history->listRevisions($id, $path),
            ]);
        }

        if ($action === 'content') {
            $revisionId = (int) ($_GET['revisionId'] ?? 0);
            if ($revisionId <= 0) {
                stx_json(['error' => 'Missing revisionId'], 400);
            }
            stx_json([
                'revisionId' => $revisionId,
                'content' => $history->readRevisionContent($project, $key, $revisionId),
            ]);
        }

        if ($action === 'diff') {
            $from = (int) ($_GET['from'] ?? 0);
            $to = $_GET['to'] ?? 'current';
            if ($from <= 0) {
                stx_json(['error' => 'Missing from revision'], 400);
            }
            $live = null;
            if ($to === 'current' || $to === 'live') {
                try {
                    $live = stx_projects()->readFile($project, $path);
                } catch (Throwable) {
                    $live = '';
                }
            }
            stx_json($history->diff($project, $key, $path, $from, $to, $live));
        }

        stx_json(['error' => 'Unknown action'], 400);
    }

    stx_require_csrf();

    if ($method === 'POST') {
        stx_projects()->requireRole($user, $id, ['owner', 'edit']);
        $body = stx_read_json();
        $action = (string) ($body['action'] ?? 'restore');
        $path = (string) ($body['path'] ?? $path);
        if ($path === '') {
            stx_json(['error' => 'Missing path'], 400);
        }

        if ($action === 'restore') {
            $revisionId = (int) ($body['revisionId'] ?? 0);
            if ($revisionId <= 0) {
                stx_json(['error' => 'Missing revisionId'], 400);
            }
            $result = stx_projects()->restoreFileRevision($user, $id, $path, $revisionId);
            stx_json(['ok' => true, 'file' => $result]);
        }

        stx_json(['error' => 'Unknown action'], 400);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
