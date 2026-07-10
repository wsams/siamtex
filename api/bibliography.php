<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\BibParser;

try {
    $user = stx_require_user();
    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        $id = (string) ($_GET['id'] ?? '');
        if ($id === '') {
            stx_json(['error' => 'Missing id'], 400);
        }
        $token = (string) ($_GET['token'] ?? '');
        if ($token !== '') {
            $p = stx_projects()->projectByShareToken($token);
            if (!$p || $p['id'] !== $id) {
                stx_json(['error' => 'Access denied'], 403);
            }
        } else {
            $p = stx_projects()->requireRole($user, $id, ['owner', 'edit', 'view']);
        }
        $path = (string) ($_GET['path'] ?? '');
        stx_json(bibliographyIndex($p, $path !== '' ? $path : null));
    }

    if ($method === 'POST' || $method === 'PUT' || $method === 'DELETE') {
        stx_require_csrf();
        $body = stx_read_json();
        $id = (string) ($body['id'] ?? $_GET['id'] ?? '');
        if ($id === '') {
            stx_json(['error' => 'Missing id'], 400);
        }
        $p = stx_projects()->requireRole($user, $id, ['owner', 'edit']);

        if ($method === 'DELETE') {
            $path = (string) ($body['path'] ?? '');
            $key = (string) ($body['key'] ?? '');
            if ($path === '' || $key === '') {
                stx_json(['error' => 'path and key are required'], 400);
            }
            $path = assertBibPath($path);
            $raw = stx_projects()->readFile($p, $path);
            $updated = BibParser::remove($raw, $key);
            $meta = stx_projects()->writeFile($user, $id, $path, $updated, 'save');
            stx_json([
                'ok' => true,
                'file' => $meta,
                'content' => $updated,
                'entries' => BibParser::parse($updated),
            ]);
        }

        $path = (string) ($body['path'] ?? '');
        $entry = $body['entry'] ?? null;
        if ($path === '' || !is_array($entry)) {
            stx_json(['error' => 'path and entry are required'], 400);
        }
        $path = assertBibPath($path);
        $type = strtolower(trim((string) ($entry['type'] ?? 'article')));
        $key = trim((string) ($entry['key'] ?? ''));
        $fieldsIn = $entry['fields'] ?? [];
        if (!is_array($fieldsIn)) {
            $fieldsIn = [];
        }
        $fields = [];
        foreach ($fieldsIn as $fname => $fval) {
            $fields[(string) $fname] = (string) $fval;
        }
        $normalized = [
            'type' => $type,
            'key' => $key,
            'fields' => $fields,
        ];

        $raw = '';
        try {
            $raw = stx_projects()->readFile($p, $path);
        } catch (Throwable) {
            $raw = '';
        }
        try {
            $updated = BibParser::upsert($raw, $normalized);
        } catch (InvalidArgumentException $e) {
            stx_json(['error' => $e->getMessage()], 400);
        }
        $meta = stx_projects()->writeFile($user, $id, $path, $updated, 'save');
        stx_json([
            'ok' => true,
            'file' => $meta,
            'content' => $updated,
            'entries' => BibParser::parse($updated),
            'entry' => $normalized,
        ]);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}

/**
 * @param array<string,mixed> $project
 * @return array{bibFiles:list<string>,entries:list<array{type:string,key:string,fields:array<string,string>,path:string}>,path:?string}
 */
function bibliographyIndex(array $project, ?string $path): array
{
    $id = (string) $project['id'];
    $files = stx_projects()->listFiles($id);
    $bibFiles = [];
    foreach ($files as $f) {
        $fp = (string) ($f['path'] ?? '');
        if (str_ends_with(strtolower($fp), '.bib') && empty($f['binary'])) {
            $bibFiles[] = $fp;
        }
    }
    sort($bibFiles);

    if ($path !== null && $path !== '') {
        $path = assertBibPath($path);
        if (!in_array($path, $bibFiles, true)) {
            try {
                stx_projects()->readFile($project, $path);
            } catch (Throwable) {
                stx_json(['error' => 'Bibliography file not found'], 404);
            }
        }
        $targets = [$path];
    } else {
        $targets = $bibFiles;
    }

    $entries = [];
    foreach ($targets as $fp) {
        try {
            $raw = stx_projects()->readFile($project, $fp);
        } catch (Throwable) {
            continue;
        }
        foreach (BibParser::parse($raw) as $e) {
            $entries[] = [
                'type' => $e['type'],
                'key' => $e['key'],
                'fields' => $e['fields'],
                'path' => $fp,
            ];
        }
    }

    return [
        'bibFiles' => $bibFiles,
        'entries' => $entries,
        'path' => $path,
    ];
}

function assertBibPath(string $path): string
{
    $safe = stx_projects()->safePath($path);
    if ($safe === '' || !str_ends_with(strtolower($safe), '.bib')) {
        throw new RuntimeException('Path must be a .bib file.');
    }
    return $safe;
}
