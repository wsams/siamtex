#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Smoke-test DocxExtractor (text + media).
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
$withImage = $fixtureDir . '/sample-with-image.docx';

if (!is_dir($fixtureDir) && !mkdir($fixtureDir, 0755, true) && !is_dir($fixtureDir)) {
    fwrite(STDERR, "Could not create {$fixtureDir}\n");
    exit(1);
}

$png = base64_decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    true,
);
if ($png === false) {
    fwrite(STDERR, "Could not decode PNG fixture\n");
    exit(1);
}

$buildDocx = static function (string $path, bool $includeImage) use ($png): void {
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException("Could not create {$path}");
    }
    $overrides = <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>
XML;
    $zip->addFromString('[Content_Types].xml', $overrides);
    $zip->addFromString('_rels/.rels', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>
XML);
    if ($includeImage) {
        $zip->addFromString('word/_rels/document.xml.rels', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>
XML);
        $zip->addFromString('word/media/image1.png', $png);
        $document = <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <a:graphic>
              <a:graphicData>
                <a:blip r:embed="rId1"/>
              </a:graphicData>
            </a:graphic>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p><w:r><w:t>Second paragraph with special chars: A &amp; B, 50%, cost $10, file_name</w:t></w:r></w:p>
  </w:body>
</w:document>
XML;
        $zip->addFromString('word/document.xml', $document);
    } else {
        $zip->addFromString('word/document.xml', <<<'XML'
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello from Word</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second paragraph with special chars: A &amp; B, 50%, cost $10, file_name</w:t></w:r></w:p>
  </w:body>
</w:document>
XML);
    }
    $zip->close();
};

try {
    $buildDocx($fixture, false);
    $buildDocx($withImage, true);
} catch (Throwable $e) {
    fwrite(STDERR, $e->getMessage() . "\n");
    exit(1);
}

$result = DocxExtractor::extractFromPath($fixture);
$withMedia = DocxExtractor::extractFromPath($withImage, null, 'figures/sample');
$latex = DocxExtractor::toBasicLatex($withMedia['text'], 'Sample', $withMedia['figures']);

$checks = [
    'has text' => $result['charCount'] > 0 && str_contains($result['text'], 'Hello from Word'),
    'no macros' => $result['hasMacros'] === false,
    'not truncated' => $result['truncated'] === false,
    'latex escapes' => str_contains(DocxExtractor::escapeLatex('A & B'), '\\&'),
    'paragraph breaks' => str_contains($result['text'], "\n\n"),
    'extracts media' => count($withMedia['media']) === 1 && ($withMedia['media'][0]['path'] ?? '') === 'figures/sample/image1.png',
    'figure marker in text' => str_contains($withMedia['text'], '[Figure: figures/sample/image1.png]'),
    'latex includes graphicx' => str_contains($latex, '\\usepackage{graphicx}')
        && str_contains($latex, '\\includegraphics[width=0.85\\textwidth]{figures/sample/image1.png}'),
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

echo "All checks passed ({$result['charCount']} chars; " . count($withMedia['media']) . " image(s)).\n";
exit(0);
