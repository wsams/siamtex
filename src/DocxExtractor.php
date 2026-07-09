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
 * Safe OOXML (.docx) text extraction.
 *
 * Opens the package as a ZIP and reads WordprocessingML XML only.
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

    /**
     * @return array{
     *   text: string,
     *   charCount: int,
     *   truncated: bool,
     *   warnings: list<string>,
     *   hasMacros: bool,
     *   parts: list<string>
     * }
     */
    public static function extractFromPath(string $path, ?int $maxChars = null): array
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
                // Cap per-part XML size to avoid pathological memory use.
                if (strlen($xml) > 8 * 1024 * 1024) {
                    $warnings[] = "Skipped oversized part: {$part}";
                    continue;
                }
                $text = self::xmlToPlainText($xml);
                if ($text === '') {
                    continue;
                }
                $chunks[] = $text;
                $usedParts[] = $part;
            }

            if ($chunks === []) {
                throw new RuntimeException('No readable text found in the document.');
            }

            $joined = implode("\n\n", $chunks);
            $joined = self::normalizeWhitespace($joined);
            $truncated = false;
            if (mb_strlen($joined) > $limit) {
                $joined = mb_substr($joined, 0, $limit);
                $truncated = true;
                $warnings[] = "Extracted text truncated to {$limit} characters.";
            }

            return [
                'text' => $joined,
                'charCount' => mb_strlen($joined),
                'truncated' => $truncated,
                'warnings' => $warnings,
                'hasMacros' => $hasMacros,
                'parts' => $usedParts,
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
     *   filename: string,
     *   bytes: int
     * }
     */
    public static function extractFromUpload(array $upload, ?int $maxBytes = null, ?int $maxChars = null): array
    {
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

        $result = self::extractFromPath($tmp, $maxChars);
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
     * Build a minimal article .tex from extracted plain text (no AI).
     */
    public static function toBasicLatex(string $plainText, string $title = 'Imported document'): string
    {
        $safeTitle = self::escapeLatex($title);
        $paras = preg_split("/\n{2,}/", trim($plainText)) ?: [];
        $body = '';
        foreach ($paras as $p) {
            $p = trim($p);
            if ($p === '') {
                continue;
            }
            // Single newlines inside a paragraph → spaces; keep as one LaTeX paragraph.
            $line = preg_replace("/\n+/", ' ', $p) ?? $p;
            $body .= self::escapeLatex($line) . "\n\n";
        }
        if ($body === '') {
            $body = "\\textit{(empty document)}\n\n";
        }

        return <<<TEX
\\documentclass[11pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage{hyperref}

\\title{{$safeTitle}}
\\author{}
\\date{}

\\begin{document}
\\maketitle

{$body}\\end{document}
TEX;
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

    private static function xmlToPlainText(string $xml): string
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

        $paragraphs = $xpath->query('//w:p');
        if ($paragraphs === false || $paragraphs->length === 0) {
            // Fallback: all w:t nodes
            return self::collectTextNodes($xpath->query('//w:t'));
        }

        $lines = [];
        foreach ($paragraphs as $p) {
            if (!$p instanceof DOMElement) {
                continue;
            }
            $line = self::paragraphText($p, $xpath);
            if ($line !== '') {
                $lines[] = $line;
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
