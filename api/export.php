<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\Auth;
use SiamTeX\Config;
use SiamTeX\ProjectService;
use SiamTeX\Store;

try {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        http_response_code(405);
        exit;
    }
    $store = new Store();
    $projects = new ProjectService($store);
    $user = Auth::currentUser($store);
    if ($user === null && !Config::authRequired()) {
        $user = $store->ensureLocalUser();
        Auth::setSessionCookie((int) $user['id']);
    }
    if ($user === null) {
        http_response_code(401);
        exit;
    }
    $id = (string) ($_GET['id'] ?? '');
    $project = $projects->requireRole($user, $id, ['owner', 'edit', 'view']);
    $zip = $projects->exportZip($project);
    $name = preg_replace('/[^A-Za-z0-9._-]+/', '_', $project['name']) ?: 'project';
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $name . '.zip"');
    header('Cache-Control: private, no-store');
    readfile($zip);
    @unlink($zip);
} catch (Throwable $e) {
    error_log('siamtex-export: ' . $e->__toString());
    http_response_code(500);
    header('Content-Type: text/plain');
    echo Config::debug() ? $e->getMessage() : "Export failed\n";
}
