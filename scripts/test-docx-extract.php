#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Smoke-test DocxExtractor.
 * Usage: php scripts/test-docx-extract.php
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

use SiamTeX\DocxExtractor;

$fixtureDir = $root . '/scripts/fixtures';
$fixture = $fixtureDir . '/sample.docx';
if (!is_file($fixture)) {
    if (!is_dir($fixtureDir) && !mkdir($fixtureDir, 0755, true) && !is_dir($fixtureDir)) {
        fwrite(STDERR, "Could not create {$fixtureDir}\n");
        exit(1);
    }
    $zip = new ZipArchive();
    if ($zip->open($fixture, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        fwrite(STDERR, "Could not create fixture {$fixture}\n");
        exit(1);
    }
    $zip->addFromString('[Content_Types].xml', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
XML);
    $zip->addFromString('_rels/.rels', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
XML);
    $zip->addFromString('word/document.xml', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph with special chars: A &amp; B, 50%, cost $10, file_name</w:t></w:r></w:p>
  </w:body>
</w:document>
XML);
    $zip->close();
}

$result = DocxExtractor::extractFromPath($fixture);
$checks = [
    'has text' => $result['charCount'] > 0 && str_contains($result['text'], 'Hello from Word'),
    'no macros' => $result['hasMacros'] === false,
    'not truncated' => $result['truncated'] === false,
    'latex escapes' => str_contains(DocxExtractor::escapeLatex('A & B'), '\\&'),
    'paragraph breaks' => str_contains($result['text'], "\n\n"),
];

$failed = 0;
foreach ($checks as $label => $ok) {
    echo ($ok ? 'OK  ' : 'FAIL') . " {$label}\n";
    if (!$ok) {
        $failed++;
    }
}

if ($failed > 0) {
    fwrite(STDERR, "{$failed} check(s) failed\n");
    exit(1);
}

echo "All checks passed ({$result['charCount']} chars extracted).\n";
exit(0);
