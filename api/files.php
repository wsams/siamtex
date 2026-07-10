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
        $token = (string) ($_GET['token'] ?? '');
        if ($token !== '') {
            $p = stx_projects()->projectByShareToken($token);
            if (!$p || $p['id'] !== $id) {
                stx_json(['error' => 'Access denied'], 403);
            }
        } else {
            $p = stx_projects()->requireRole($user, $id, ['owner', 'edit', 'view']);
        }
        if ($path === '') {
            stx_json(['files' => stx_projects()->listFiles($id)]);
        }
        if (\SiamTeX\ProjectService::isBinaryPath($path)) {
            $files = stx_projects()->listFiles($id);
            $meta = null;
            foreach ($files as $f) {
                if ($f['path'] === $path) {
                    $meta = $f;
                    break;
                }
            }
            if ($meta === null) {
                stx_json(['error' => 'File not found.'], 404);
            }
            $asDownload = isset($_GET['download']) && $_GET['download'] !== '' && $_GET['download'] !== '0';
            if ($asDownload) {
                $bytes = stx_projects()->readFile($p, $path);
                $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
                $ctype = match ($ext) {
                    'png' => 'image/png',
                    'jpg', 'jpeg' => 'image/jpeg',
                    'gif' => 'image/gif',
                    'webp' => 'image/webp',
                    'bmp' => 'image/bmp',
                    'tif', 'tiff' => 'image/tiff',
                    'ico' => 'image/x-icon',
                    'svg', 'svgz' => 'image/svg+xml',
                    'pdf' => 'application/pdf',
                    'eps', 'ps' => 'application/postscript',
                    'otf' => 'font/otf',
                    'ttf' => 'font/ttf',
                    'woff' => 'font/woff',
                    'woff2' => 'font/woff2',
                    default => 'application/octet-stream',
                };
                $basename = basename($path);
                header('Content-Type: ' . $ctype);
                header('Content-Length: ' . (string) strlen($bytes));
                header('Content-Disposition: attachment; filename="' . str_replace('"', '', $basename) . '"');
                header('X-Content-Type-Options: nosniff');
                header('Cache-Control: private, no-store');
                echo $bytes;
                exit;
            }
            // Binary assets are not returned as UTF-8 editor text.
            stx_json([
                'path' => $path,
                'binary' => true,
                'size' => $meta['size'],
                'content' => null,
                'downloadUrl' => 'files.php?id=' . rawurlencode($id)
                    . '&path=' . rawurlencode($path)
                    . '&download=1'
                    . ($token !== '' ? '&token=' . rawurlencode($token) : ''),
            ]);
        }
        $content = stx_projects()->readFile($p, $path);
        stx_json(['path' => $path, 'content' => $content, 'binary' => false]);
    }

    stx_require_csrf();

    if ($method === 'PUT') {
        $body = stx_read_json();
        $path = (string) ($body['path'] ?? $path);
        $content = (string) ($body['content'] ?? '');
        $source = (string) ($body['source'] ?? 'save');
        if (!in_array($source, ['save', 'compile', 'ai', 'import', 'restore'], true)) {
            $source = 'save';
        }
        $label = isset($body['label']) ? (string) $body['label'] : null;
        $meta = stx_projects()->writeFile($user, $id, $path, $content, $source, $label);
        stx_json(['file' => $meta]);
    }

    if ($method === 'DELETE') {
        if ($path === '') {
            $body = stx_read_json();
            $path = (string) ($body['path'] ?? '');
        }
        stx_projects()->deleteFile($user, $id, $path);
        stx_json(['ok' => true]);
    }

    stx_json(['error' => 'Method not allowed'], 405);
} catch (Throwable $e) {
    stx_http_error($e);
}
