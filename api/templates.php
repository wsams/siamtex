<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Templates;

try {
    stx_json([
        'templates' => Templates::catalog(),
        'commonFiles' => Templates::commonFiles(),
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
