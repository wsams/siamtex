<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Auth;

try {
    stx_require_csrf();
    Auth::clearSessionCookie();
    stx_json(['ok' => true]);
} catch (Throwable $e) {
    stx_http_error($e);
}
