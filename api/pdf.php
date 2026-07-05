<?php

declare(strict_types=1);

require dirname(__DIR__) . '/vendor/autoload.php';

use SiamTeX\Auth;
use SiamTeX\Config;
use SiamTeX\ProjectService;
use SiamTeX\Store;

try {
    $store = new Store();
    $projects = new ProjectService($store);
    $id = (string) ($_GET['id'] ?? '');
    $token = (string) ($_GET['token'] ?? '');
    if ($id === '') {
        http_response_code(400);
        header('Content-Type: text/plain');
        echo "Missing id\n";
        exit;
    }

    $user = Auth::currentUser($store);
    if ($user === null && !Config::authRequired()) {
        $user = $store->ensureLocalUser();
        Auth::setSessionCookie((int) $user['id']);
    }

    if ($token !== '') {
        $project = $projects->projectByShareToken($token);
        if (!$project || $project['id'] !== $id) {
            http_response_code(404);
            exit;
        }
    } else {
        if ($user === null) {
            http_response_code(401);
            exit;
        }
        $project = $projects->requireRole($user, $id, ['owner', 'edit', 'view']);
    }

    $pdf = $projects->readPdf($project);
    if ($pdf === null) {
        http_response_code(404);
        header('Content-Type: text/plain');
        echo "No PDF yet\n";
        exit;
    }

    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="project.pdf"');
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    echo $pdf;
} catch (Throwable $e) {
    error_log('siamtex-pdf: ' . $e->__toString());
    http_response_code(500);
    header('Content-Type: text/plain');
    echo Config::debug() ? $e->getMessage() : "Error\n";
}
