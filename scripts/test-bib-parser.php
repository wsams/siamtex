#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Smoke-test BibParser + LogParser citation diagnostics (F-61).
 * Usage: php scripts/test-bib-parser.php
 */

$root = dirname(__DIR__);
spl_autoload_register(static function (string $class) use ($root): void {
    if (!str_starts_with($class, 'SiamTeX\\')) {
        return;
    }
    $path = $root . '/src/' . str_replace('\\', '/', substr($class, 8)) . '.php';
    if (is_file($path)) {
        require $path;
    }
});

use SiamTeX\BibParser;
use SiamTeX\LogParser;

$fail = 0;
function assertTrue(bool $cond, string $msg): void
{
    global $fail;
    if ($cond) {
        echo "OK  {$msg}\n";
    } else {
        echo "FAIL {$msg}\n";
        $fail++;
    }
}

$sample = <<<'BIB'
@article{example2024,
  author  = {Ada Lovelace and Alan Turing},
  title   = {An Example Reference},
  journal = {Journal of Examples},
  year    = {2024},
  volume  = {1},
  pages   = {1--10}
}

@book{knuth84,
  author = {Donald E. Knuth},
  title = {The TeXbook},
  year = 1984,
  publisher = {Addison-Wesley}
}
BIB;

$entries = BibParser::parse($sample);
assertTrue(count($entries) === 2, 'parse finds 2 entries');
assertTrue(($entries[0]['key'] ?? '') === 'example2024', 'first key');
assertTrue(($entries[0]['fields']['author'] ?? '') !== '', 'author field');
assertTrue(($entries[1]['fields']['year'] ?? '') === '1984', 'bare year');

$keys = BibParser::keys($sample);
assertTrue($keys === ['example2024', 'knuth84'], 'keys() order');

$updated = BibParser::upsert($sample, [
    'type' => 'article',
    'key' => 'new2025',
    'fields' => [
        'author' => 'Test Author',
        'title' => 'New Paper',
        'year' => '2025',
    ],
]);
assertTrue(str_contains($updated, '@article{new2025,'), 'upsert appends');
assertTrue(count(BibParser::parse($updated)) === 3, 'three entries after upsert');

$replaced = BibParser::upsert($updated, [
    'type' => 'article',
    'key' => 'example2024',
    'fields' => [
        'author' => 'Updated Author',
        'title' => 'Updated Title',
        'year' => '2024',
    ],
]);
$parsed = BibParser::parse($replaced);
$ex = null;
foreach ($parsed as $e) {
    if ($e['key'] === 'example2024') {
        $ex = $e;
        break;
    }
}
assertTrue(($ex['fields']['author'] ?? '') === 'Updated Author', 'upsert replaces fields');

$removed = BibParser::remove($replaced, 'knuth84');
assertTrue(!str_contains($removed, 'knuth84'), 'remove drops key');
assertTrue(count(BibParser::keys($removed)) === 2, 'two keys after remove');

try {
    BibParser::serializeEntry(['type' => 'article', 'key' => 'bad key!', 'fields' => []]);
    assertTrue(false, 'invalid key should throw');
} catch (InvalidArgumentException) {
    assertTrue(true, 'invalid key rejected');
}

$log = <<<'LOG'
Package natbib Warning: Citation `missingKey' on page 1 undefined on input line 42.
LaTeX Warning: Citation `alsoMissing' on page 2 undefined on input line 10.
Warning--I didn't find a database entry for "bibtexMiss"
LOG;

$diags = LogParser::parse($log);
$citeDiags = array_values(array_filter(
    $diags,
    static fn ($d) => ($d['category'] ?? '') === 'citation'
));
assertTrue(count($citeDiags) >= 3, 'citation diagnostics parsed');
$citeKeys = array_map(static fn ($d) => $d['citationKey'] ?? '', $citeDiags);
assertTrue(in_array('missingKey', $citeKeys, true), 'natbib missing key');
assertTrue(in_array('alsoMissing', $citeKeys, true), 'latex missing key');
assertTrue(in_array('bibtexMiss', $citeKeys, true), 'bibtex missing key');

$nat = null;
foreach ($citeDiags as $d) {
    if (($d['citationKey'] ?? '') === 'missingKey') {
        $nat = $d;
        break;
    }
}
assertTrue(($nat['line'] ?? null) === 42, 'citation line number');
assertTrue(str_starts_with($nat['message'] ?? '', 'Missing citation:'), 'message prefix');

if ($fail > 0) {
    fwrite(STDERR, "\n{$fail} assertion(s) failed\n");
    exit(1);
}
echo "\nAll bibliography parser checks passed.\n";
exit(0);
