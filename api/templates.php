<?php

declare(strict_types=1);

require __DIR__ . '/_bootstrap.php';

use SiamTeX\Catalog;

try {
    $catalog = Catalog::full();
    stx_json([
        // Full curated catalog (F-71)
        'license' => $catalog['license'],
        'templates' => $catalog['templates'],
        'macros' => $catalog['macros'],
        'packages' => $catalog['packages'],
        'resources' => $catalog['resources'],
        'commonFiles' => $catalog['commonFiles'],
        // Back-compat alias
        'catalog' => $catalog,
    ]);
} catch (Throwable $e) {
    stx_http_error($e);
}
