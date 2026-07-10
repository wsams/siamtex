<?php

declare(strict_types=1);

namespace SiamTeX;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use RuntimeException;
use ZipArchive;

/**
 * Safe OOXML (.docx) text + media extraction.
 *
 * Opens the package as a ZIP and reads WordprocessingML XML / word/media only.
 * Does not load, execute, or interpret VBA macros, OLE objects, or ActiveX.
 */
final class DocxExtractor
{
    /** OOXML parts that may contain readable body text. */
    private const TEXT_PARTS = [
        'word/document.xml',
        'word/footnotes.xml',
        'word/endnotes.xml',
        'word/header1.xml',
        'word/header2.xml',
        'word/header3.xml',
        'word/footer1.xml',
        'word/footer2.xml',
        'word/footer3.xml',
    ];

    /** Parts that indicate macros / executable content — never opened for execution. */
    private const MACRO_HINTS = [
        'word/vbaProject.bin',
        'word/vbaData.xml',
        'word/macrosheets/',
    ];

    /** Image extensions we store as project assets and can reference from LaTeX. */
    private const MEDIA_EXTENSIONS = [
        'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp', 'svg', 'pdf', 'eps',
    ];

    /** Common in Word but not usable by pdflatex graphicx without conversion. */
    private const SKIP_MEDIA_EXTENSIONS = [
        'emf', 'wmf', 'emz', 'wmz',
    ];

    /**
     * @return array{
     *   text: string,
     *   charCount: int,
     *   truncated: bool,
     *   warnings: list<string>,
     *   hasMacros: bool,
     *   parts: list<string>,
     *   media: list<array{path:string, bytes:int, content:string, contentType:string, source:string}>,
     *   figures: list<string>
     * }
     */
    public static function extractFromPath(string $path, ?int $maxChars = null, string $mediaPrefix = 'figures'): array
    {
        if (!is_file($path) || !is_readable($path)) {
            throw new RuntimeException('Could not read the uploaded document.');
        }
        $size = filesize($path);
        if ($size === false || $size <= 0) {
            throw new RuntimeException('Empty document.');
        }
        $limit = $maxChars ?? Config::maxDocxExtractChars();
        if ($limit < 1000) {
            $limit = 1000;
        }
        $mediaPrefix = trim(str_replace('\\', '/', $mediaPrefix), '/');
        if ($mediaPrefix === '' || str_contains($mediaPrefix, '..')) {
            $mediaPrefix = 'figures';
        }

        $fh = fopen($path, 'rb');
        if ($fh === false) {
            throw new RuntimeException('Could not open the uploaded document.');
        }
        $magic = fread($fh, 4);
        fclose($fh);
        // ZIP local file header
        if ($magic !== "PK\x03\x04" && $magic !== "PK\x05\x06" && $magic !== "PK\x07\x08") {
            throw new RuntimeException('Not a valid .docx file (expected an OOXML ZIP package).');
        }

        $zip = new ZipArchive();
        $open = $zip->open($path, ZipArchive::RDONLY);
        if ($open !== true) {
            throw new RuntimeException('Could not open .docx archive (corrupt or unsupported).');
        }

        try {
            if ($zip->locateName('[Content_Types].xml') === false) {
                throw new RuntimeException('Not a valid .docx package (missing [Content_Types].xml).');
            }
            if ($zip->locateName('word/document.xml') === false) {
                throw new RuntimeException('Not a valid .docx package (missing word/document.xml).');
            }

            $warnings = [];
            $hasMacros = self::detectMacros($zip);
            if ($hasMacros) {
                $warnings[] = 'This document contains VBA macros; they were ignored and not executed.';
            }

            $relMap = self::loadImageRelationships($zip, $warnings);
            $mediaResult = self::extractMedia($zip, $relMap, $mediaPrefix, $warnings);
            /** @var array<string, string> $rIdToPath */
            $rIdToPath = $mediaResult['rIdToPath'];
            /** @var list<array{path:string, bytes:int, content:string, contentType:string, source:string}> $media */
            $media = $mediaResult['media'];

            $chunks = [];
            $usedParts = [];
            foreach (self::TEXT_PARTS as $part) {
                $idx = $zip->locateName($part);
                if ($idx === false) {
                    continue;
                }
                $xml = $zip->getFromIndex($idx);
                if ($xml === false || $xml === '') {
                    continue;
                }
                $maxPart = Config::maxDocxXmlPartBytes();
                if (strlen($xml) > $maxPart) {
                    $warnings[] = "Skipped oversized part: {$part}";
                    continue;
                }
                $partRels = $part === 'word/document.xml'
                    ? $rIdToPath
                    : self::loadImageRelationshipsForPart($zip, $part, $mediaPrefix, $media, $warnings);
                $text = self::xmlToPlainText($xml, $partRels);
                if ($text === '') {
                    continue;
                }
                $chunks[] = $text;
                $usedParts[] = $part;
            }

            if ($chunks === [] && $media === []) {
                throw new RuntimeException('No readable text or images found in the document.');
            }
            if ($chunks === []) {
                $chunks[] = '(Document contained images but no extractable text.)';
                $warnings[] = 'No body text found; imported figures only.';
            }

            $joined = implode("\n\n", $chunks);
            $joined = self::normalizeWhitespace($joined);
            $truncated = false;
            if (mb_strlen($joined) > $limit) {
                $joined = mb_substr($joined, 0, $limit);
                $truncated = true;
                $warnings[] = "Extracted text truncated to {$limit} characters.";
            }

            $figures = array_values(array_unique(array_map(
                static fn (array $m): string => $m['path'],
                $media,
            )));

            return [
                'text' => $joined,
                'charCount' => mb_strlen($joined),
                'truncated' => $truncated,
                'warnings' => $warnings,
                'hasMacros' => $hasMacros,
                'parts' => $usedParts,
                'media' => $media,
                'figures' => $figures,
            ];
        } finally {
            $zip->close();
        }
    }

    /**
     * @param array{name:string,type?:string,tmp_name:string,error:int,size:int} $upload
     * @return array{
     *   text: string,
     *   charCount: int,
     *   truncated: bool,
     *   warnings: list<string>,
     *   hasMacros: bool,
     *   parts: list<string>,
     *   media: list<array{path:string, bytes:int, content:string, contentType:string, source:string}>,
     *   figures: list<string>,
     *   filename: string,
     *   bytes: int
     * }
     */
    public static function extractFromUpload(
        array $upload,
        ?int $maxBytes = null,
        ?int $maxChars = null,
        string $mediaPrefix = 'figures',
    ): array {
        $err = (int) ($upload['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($err !== UPLOAD_ERR_OK) {
            throw new RuntimeException(ProjectService::uploadErrorMessage($err));
        }
        $size = (int) ($upload['size'] ?? 0);
        $max = $maxBytes ?? Config::maxDocxImportBytes();
        if ($size <= 0) {
            throw new RuntimeException('Empty upload.');
        }
        if ($size > $max) {
            throw new RuntimeException('Document too large (max ' . $max . ' bytes).');
        }
        $name = (string) ($upload['name'] ?? 'document.docx');
        $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (!in_array($ext, self::allowedExtensions(), true)) {
            throw new RuntimeException('Only .docx (Word OOXML) files are supported for import.');
        }
        $tmp = (string) ($upload['tmp_name'] ?? '');
        if ($tmp === '' || !is_uploaded_file($tmp)) {
            // Allow non-HTTP uploads in CLI tests when SIAMTEX_ALLOW_LOCAL_UPLOAD is set.
            if ($tmp === '' || !is_file($tmp) || getenv('SIAMTEX_ALLOW_LOCAL_UPLOAD') !== '1') {
                throw new RuntimeException('Invalid upload.');
            }
        }

        $stem = pathinfo(basename($name), PATHINFO_FILENAME);
        $stem = preg_replace('/[^A-Za-z0-9._-]+/', '_', (string) $stem) ?: 'import';
        $prefix = trim($mediaPrefix, '/') . '/' . $stem;

        $result = self::extractFromPath($tmp, $maxChars, $prefix);
        $result['filename'] = basename($name);
        $result['bytes'] = $size;
        return $result;
    }

    /**
     * @return list<string>
     */
    public static function allowedExtensions(): array
    {
        return ['docx'];
    }

    /**
     * Escape plain text for inclusion in a minimal LaTeX article body.
     */
    public static function escapeLatex(string $text): string
    {
        $map = [
            '\\' => '\\textbackslash{}',
            '{' => '\\{',
            '}' => '\\}',
            '#' => '\\#',
            '$' => '\\$',
            '%' => '\\%',
            '&' => '\\&',
            '_' => '\\_',
            '~' => '\\textasciitilde{}',
            '^' => '\\textasciicircum{}',
        ];
        return strtr($text, $map);
    }

    /**
     * Build a minimal article .tex from extracted plain text and figure paths (no AI).
     *
     * @param list<string> $figures project-relative image paths
     */
    public static function toBasicLatex(
        string $plainText,
        string $title = 'Imported document',
        array $figures = [],
    ): string {
        $safeTitle = self::escapeLatex($title);
        $paras = preg_split("/\n{2,}/", trim($plainText)) ?: [];
        $body = '';
        $usedFigures = [];
        foreach ($paras as $p) {
            $p = trim($p);
            if ($p === '') {
                continue;
            }
            if (preg_match('/^\[Figure:\s*(.+?)\]$/u', $p, $m)) {
                $figPath = trim($m[1]);
                $body .= self::figureLatex($figPath);
                $usedFigures[$figPath] = true;
                continue;
            }
            // Single newlines inside a paragraph → spaces; keep as one LaTeX paragraph.
            $line = preg_replace("/\n+/", ' ', $p) ?? $p;
            $body .= self::escapeLatex($line) . "\n\n";
        }

        foreach ($figures as $figPath) {
            $figPath = (string) $figPath;
            if ($figPath === '' || isset($usedFigures[$figPath])) {
                continue;
            }
            $body .= self::figureLatex($figPath);
            $usedFigures[$figPath] = true;
        }

        if ($body === '') {
            $body = "\\textit{(empty document)}\n\n";
        }

        $graphicx = $figures !== [] || str_contains($body, 'includegraphics')
            ? "\\usepackage{graphicx}\n"
            : '';

        return <<<TEX
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
{$graphicx}\\usepackage{hyperref}

\\title{{$safeTitle}}
\\author{}
\\date{}

\\begin{document}
\\maketitle

{$body}\\end{document}
TEX;
    }

    private static function figureLatex(string $path): string
    {
        $path = str_replace('\\', '/', $path);
        // Paths in \includegraphics should not be LaTeX-escaped the same way as prose;
        // keep safe characters only (already sanitized on write).
        $safe = preg_replace('/[^A-Za-z0-9._\\/-]+/', '_', $path) ?? $path;
        return "\\begin{figure}[ht]\n"
            . "  \\centering\n"
            . "  \\includegraphics[width=0.85\\textwidth]{{$safe}}\n"
            . "  \\caption{}\n"
            . "\\end{figure}\n\n";
    }

    private static function detectMacros(ZipArchive $zip): bool
    {
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            $lower = strtolower($name);
            foreach (self::MACRO_HINTS as $hint) {
                if (str_contains($lower, strtolower($hint))) {
                    return true;
                }
            }
            if (str_ends_with($lower, '.docm') || str_contains($lower, 'vbaproject')) {
                return true;
            }
        }
        return false;
    }

    /**
     * Map rId → media zip path (word/media/…) from document relationships.
     *
     * @param list<string> $warnings
     * @return array<string, string> rId => zip path under word/
     */
    private static function loadImageRelationships(ZipArchive $zip, array &$warnings): array
    {
        return self::parseRelsXml(
            $zip,
            'word/_rels/document.xml.rels',
            $warnings,
        );
    }

    /**
     * @param list<array{path:string, bytes:int, content:string, contentType:string, source:string}> $media
     * @param list<string> $warnings
     * @return array<string, string>
     */
    private static function loadImageRelationshipsForPart(
        ZipArchive $zip,
        string $part,
        string $mediaPrefix,
        array &$media,
        array &$warnings,
    ): array {
        $base = basename($part);
        $relsPath = 'word/_rels/' . $base . '.rels';
        $map = self::parseRelsXml($zip, $relsPath, $warnings);
        if ($map === []) {
            return [];
        }

        // Index already-extracted media by source zip basename.
        $bySource = [];
        foreach ($media as $item) {
            $src = strtolower((string) ($item['source'] ?? ''));
            if ($src !== '') {
                $bySource[$src] = (string) $item['path'];
            }
        }

        $rIdToPath = [];
        $needExtract = [];
        foreach ($map as $rId => $zipPath) {
            $src = strtolower(basename($zipPath));
            if (isset($bySource[$src])) {
                $rIdToPath[$rId] = $bySource[$src];
                continue;
            }
            $needExtract[$rId] = $zipPath;
        }
        if ($needExtract === []) {
            return $rIdToPath;
        }

        $extra = self::extractMedia($zip, $needExtract, $mediaPrefix, $warnings);
        foreach ($extra['media'] as $item) {
            $exists = false;
            foreach ($media as $existing) {
                if ($existing['path'] === $item['path']
                    || strcasecmp((string) ($existing['source'] ?? ''), (string) ($item['source'] ?? '')) === 0
                ) {
                    $exists = true;
                    break;
                }
            }
            if (!$exists) {
                $media[] = $item;
                $src = strtolower((string) ($item['source'] ?? ''));
                if ($src !== '') {
                    $bySource[$src] = $item['path'];
                }
            }
        }
        foreach ($extra['rIdToPath'] as $rId => $projectPath) {
            $rIdToPath[$rId] = $projectPath;
        }
        return $rIdToPath;
    }

    /**
     * @param list<string> $warnings
     * @return array<string, string>
     */
    private static function parseRelsXml(ZipArchive $zip, string $relsPath, array &$warnings): array
    {
        $idx = $zip->locateName($relsPath);
        if ($idx === false) {
            return [];
        }
        $xml = $zip->getFromIndex($idx);
        if ($xml === false || $xml === '') {
            return [];
        }
        $prev = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $ok = $dom->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok) {
            $warnings[] = "Could not parse relationships: {$relsPath}";
            return [];
        }
        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('r', 'http://schemas.openxmlformats.org/package/2006/relationships');
        $nodes = $xpath->query('//r:Relationship');
        $map = [];
        if ($nodes === false) {
            return [];
        }
        foreach ($nodes as $node) {
            if (!$node instanceof DOMElement) {
                continue;
            }
            $id = $node->getAttribute('Id');
            $type = $node->getAttribute('Type');
            $target = $node->getAttribute('Target');
            $mode = $node->getAttribute('TargetMode');
            if ($id === '' || $target === '') {
                continue;
            }
            if (strcasecmp($mode, 'External') === 0) {
                $warnings[] = "Skipped external image link ({$id}).";
                continue;
            }
            if (!str_contains(strtolower($type), '/image')) {
                continue;
            }
            $target = str_replace('\\', '/', $target);
            if (str_contains($target, '..')) {
                $warnings[] = "Skipped unsafe media path ({$id}).";
                continue;
            }
            // Targets are relative to word/
            $zipPath = str_starts_with($target, '/')
                ? ltrim($target, '/')
                : 'word/' . ltrim($target, '/');
            // Normalize word/../media → skip
            if (str_contains($zipPath, '..')) {
                continue;
            }
            $map[$id] = $zipPath;
        }
        return $map;
    }

    /**
     * @param array<string, string> $relMap rId => zip path
     * @param list<string> $warnings
     * @return array{
     *   media: list<array{path:string, bytes:int, content:string, contentType:string, source:string}>,
     *   rIdToPath: array<string, string>
     * }
     */
    private static function extractMedia(
        ZipArchive $zip,
        array $relMap,
        string $mediaPrefix,
        array &$warnings,
    ): array {
        $maxImages = Config::maxDocxMediaFiles();
        $maxEach = Config::maxDocxMediaBytes();
        $maxTotal = Config::maxDocxMediaTotalBytes();
        $total = 0;
        $media = [];
        $rIdToPath = [];
        $usedNames = [];

        // Prefer relationship-ordered extraction; also pick up orphan media files.
        $candidates = [];
        foreach ($relMap as $rId => $zipPath) {
            $candidates[] = ['rId' => $rId, 'zipPath' => $zipPath];
        }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = (string) $zip->getNameIndex($i);
            if (!str_starts_with(strtolower($name), 'word/media/')) {
                continue;
            }
            $already = false;
            foreach ($candidates as $c) {
                if (strcasecmp($c['zipPath'], $name) === 0) {
                    $already = true;
                    break;
                }
            }
            if (!$already) {
                $candidates[] = ['rId' => '', 'zipPath' => $name];
            }
        }

        foreach ($candidates as $c) {
            if (count($media) >= $maxImages) {
                $warnings[] = "Stopped after {$maxImages} images (limit).";
                break;
            }
            $zipPath = $c['zipPath'];
            $ext = strtolower(pathinfo($zipPath, PATHINFO_EXTENSION));
            if (in_array($ext, self::SKIP_MEDIA_EXTENSIONS, true)) {
                $warnings[] = "Skipped unsupported figure format (.{$ext}): " . basename($zipPath);
                continue;
            }
            if (!in_array($ext, self::MEDIA_EXTENSIONS, true)) {
                $warnings[] = 'Skipped non-image media: ' . basename($zipPath);
                continue;
            }
            $idx = $zip->locateName($zipPath);
            if ($idx === false) {
                // Case-insensitive search
                $idx = $zip->locateName($zipPath, ZipArchive::FL_NOCASE);
            }
            if ($idx === false) {
                $warnings[] = 'Missing media part: ' . basename($zipPath);
                continue;
            }
            $stat = $zip->statIndex($idx);
            $rawSize = is_array($stat) ? (int) ($stat['size'] ?? 0) : 0;
            if ($rawSize > $maxEach) {
                $warnings[] = 'Skipped oversized image ' . basename($zipPath) . " ({$rawSize} bytes).";
                continue;
            }
            if ($total + $rawSize > $maxTotal) {
                $warnings[] = 'Reached total media size limit; remaining images skipped.';
                break;
            }
            $bin = $zip->getFromIndex($idx);
            if ($bin === false || $bin === '') {
                continue;
            }
            if (strlen($bin) > $maxEach) {
                $warnings[] = 'Skipped oversized image ' . basename($zipPath) . '.';
                continue;
            }

            $base = strtolower(pathinfo($zipPath, PATHINFO_FILENAME));
            $base = preg_replace('/[^a-z0-9._-]+/', '_', $base) ?: 'image';
            $destName = $base . '.' . ($ext === 'jpeg' ? 'jpg' : $ext);
            $n = 2;
            while (isset($usedNames[$destName])) {
                $destName = $base . '-' . $n . '.' . ($ext === 'jpeg' ? 'jpg' : $ext);
                $n++;
            }
            $usedNames[$destName] = true;
            $projectPath = $mediaPrefix . '/' . $destName;

            $media[] = [
                'path' => $projectPath,
                'bytes' => strlen($bin),
                'content' => $bin,
                'contentType' => self::contentTypeForExt($ext),
                'source' => basename($zipPath),
            ];
            $total += strlen($bin);
            if ($c['rId'] !== '') {
                $rIdToPath[$c['rId']] = $projectPath;
            }
        }

        return ['media' => $media, 'rIdToPath' => $rIdToPath];
    }

    private static function contentTypeForExt(string $ext): string
    {
        return match (strtolower($ext)) {
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'bmp' => 'image/bmp',
            'tif', 'tiff' => 'image/tiff',
            'webp' => 'image/webp',
            'svg' => 'image/svg+xml',
            'pdf' => 'application/pdf',
            'eps' => 'application/postscript',
            default => 'application/octet-stream',
        };
    }

    /**
     * @param array<string, string> $rIdToPath
     */
    private static function xmlToPlainText(string $xml, array $rIdToPath = []): string
    {
        $prev = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        $ok = $dom->loadXML($xml, LIBXML_NONET | LIBXML_NOENT | LIBXML_COMPACT);
        libxml_clear_errors();
        libxml_use_internal_errors($prev);
        if (!$ok) {
            return '';
        }

        $xpath = new DOMXPath($dom);
        $xpath->registerNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main');
        $xpath->registerNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main');
        $xpath->registerNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
        $xpath->registerNamespace('v', 'urn:schemas-microsoft-com:vml');

        $paragraphs = $xpath->query('//w:p');
        if ($paragraphs === false || $paragraphs->length === 0) {
            return self::collectTextNodes($xpath->query('//w:t'));
        }

        $lines = [];
        foreach ($paragraphs as $p) {
            if (!$p instanceof DOMElement) {
                continue;
            }
            $line = self::paragraphText($p, $xpath);
            $figs = self::paragraphFigures($p, $xpath, $rIdToPath);
            if ($line !== '') {
                $lines[] = $line;
            }
            foreach ($figs as $figPath) {
                $lines[] = '[Figure: ' . $figPath . ']';
            }
        }
        // Separate Word paragraphs with a blank line so importers can split on \n\n.
        return implode("\n\n", $lines);
    }

    private static function paragraphText(DOMElement $p, DOMXPath $xpath): string
    {
        $parts = [];
        $nodes = $xpath->query('.//w:t|.//w:tab|.//w:br', $p);
        if ($nodes === false) {
            return '';
        }
        foreach ($nodes as $node) {
            if (!$node instanceof DOMElement) {
                continue;
            }
            $local = $node->localName ?? $node->nodeName;
            if ($local === 't') {
                $parts[] = $node->textContent;
            } elseif ($local === 'tab') {
                $parts[] = "\t";
            } elseif ($local === 'br') {
                $parts[] = "\n";
            }
        }
        return trim(implode('', $parts));
    }

    /**
     * @param array<string, string> $rIdToPath
     * @return list<string>
     */
    private static function paragraphFigures(DOMElement $p, DOMXPath $xpath, array $rIdToPath): array
    {
        if ($rIdToPath === []) {
            return [];
        }
        $out = [];
        $seen = [];
        // DrawingML blips
        $blips = $xpath->query('.//a:blip[@r:embed]', $p);
        if ($blips !== false) {
            foreach ($blips as $blip) {
                if (!$blip instanceof DOMElement) {
                    continue;
                }
                $rId = $blip->getAttributeNS(
                    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                    'embed',
                );
                if ($rId === '') {
                    $rId = $blip->getAttribute('r:embed');
                }
                if ($rId !== '' && isset($rIdToPath[$rId]) && !isset($seen[$rId])) {
                    $out[] = $rIdToPath[$rId];
                    $seen[$rId] = true;
                }
            }
        }
        // VML imagedata (older Word)
        $vml = $xpath->query('.//v:imagedata[@r:id]', $p);
        if ($vml !== false) {
            foreach ($vml as $img) {
                if (!$img instanceof DOMElement) {
                    continue;
                }
                $rId = $img->getAttributeNS(
                    'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                    'id',
                );
                if ($rId === '') {
                    $rId = $img->getAttribute('r:id');
                }
                if ($rId !== '' && isset($rIdToPath[$rId]) && !isset($seen[$rId])) {
                    $out[] = $rIdToPath[$rId];
                    $seen[$rId] = true;
                }
            }
        }
        return $out;
    }

    /** @param \DOMNodeList<DOMNode>|false $nodes */
    private static function collectTextNodes($nodes): string
    {
        if ($nodes === false) {
            return '';
        }
        $parts = [];
        foreach ($nodes as $node) {
            $parts[] = $node->textContent;
        }
        return trim(implode('', $parts));
    }

    private static function normalizeWhitespace(string $text): string
    {
        $text = str_replace(["\r\n", "\r"], "\n", $text);
        // Collapse runs of blank lines
        $text = preg_replace("/\n{3,}/", "\n\n", $text) ?? $text;
        return trim($text);
    }
}
