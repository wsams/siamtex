<?php

declare(strict_types=1);

namespace SiamTeX;

use RuntimeException;

/**
 * First-party template packages live under templates/<id>/ as multi-file trees.
 * Each package has manifest.json plus any .tex/.bib/etc. files to copy into a project.
 */
final class Templates
{
    /**
     * @return list<array{
     *   id:string,name:string,description:string,longDescription:string,category:string,
     *   tags:list<string>,files:list<string>,mainFile:string,engine:string,
     *   license:string,licenseNote:string
     * }>
     */
    public static function catalog(): array
    {
        $out = [];
        foreach (self::packageIds() as $id) {
            $manifest = self::manifest($id);
            $files = array_keys(self::filesFor($id));
            $tags = $manifest['tags'] ?? [];
            if (!is_array($tags)) {
                $tags = [];
            }
            $tags = array_values(array_filter(array_map('strval', $tags)));
            $out[] = [
                'id' => $id,
                'name' => (string) ($manifest['name'] ?? $id),
                'description' => (string) ($manifest['description'] ?? ''),
                'longDescription' => (string) ($manifest['longDescription'] ?? $manifest['description'] ?? ''),
                'category' => (string) ($manifest['category'] ?? 'general'),
                'tags' => $tags,
                'mainFile' => (string) ($manifest['mainFile'] ?? 'main.tex'),
                'engine' => (string) ($manifest['engine'] ?? 'pdflatex'),
                'license' => (string) ($manifest['license'] ?? Catalog::LICENSE_ID),
                'licenseNote' => (string) ($manifest['licenseNote'] ?? Catalog::LICENSE_NOTE),
                'files' => $files,
            ];
        }
        return $out;
    }

    /** @return list<string> */
    public static function packageIds(): array
    {
        $dir = Config::templatesDir();
        if (!is_dir($dir)) {
            return [];
        }
        $ids = [];
        foreach (scandir($dir) ?: [] as $name) {
            if ($name === '.' || $name === '..') {
                continue;
            }
            if (is_dir($dir . '/' . $name) && is_file($dir . '/' . $name . '/manifest.json')) {
                $ids[] = $name;
            }
        }
        sort($ids);
        return $ids;
    }

    /** @return array<string,mixed> */
    public static function manifest(string $id): array
    {
        $id = self::safeId($id);
        $path = Config::templatesDir() . '/' . $id . '/manifest.json';
        if (!is_file($path)) {
            throw new RuntimeException('Unknown template: ' . $id);
        }
        $data = json_decode((string) file_get_contents($path), true);
        if (!is_array($data)) {
            throw new RuntimeException('Invalid template manifest: ' . $id);
        }
        $data['id'] = $id;
        return $data;
    }

    /** @return array<string,string> path => content */
    public static function filesFor(string $id): array
    {
        $id = self::safeId($id);
        $root = Config::templatesDir() . '/' . $id;
        if (!is_dir($root)) {
            throw new RuntimeException('Unknown template: ' . $id);
        }
        $files = [];
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iterator as $fileInfo) {
            /** @var \SplFileInfo $fileInfo */
            if (!$fileInfo->isFile()) {
                continue;
            }
            $full = $fileInfo->getPathname();
            $rel = substr($full, strlen($root) + 1);
            $rel = str_replace('\\', '/', $rel);
            $base = basename($rel);
            if ($base === 'manifest.json' || str_starts_with($base, '.')) {
                continue;
            }
            if (!preg_match('/\.(tex|bib|sty|cls|txt|md)$/i', $rel)) {
                continue;
            }
            $files[$rel] = (string) file_get_contents($full);
        }
        if ($files === []) {
            throw new RuntimeException('Template has no files: ' . $id);
        }
        ksort($files);
        return $files;
    }

    /**
     * Common starter files users can add to any project (includes macro packs).
     *
     * @return list<array{id:string,path:string,label:string,description:string,category:string,content:string,license:string}>
     */
    public static function commonFiles(): array
    {
        $files = [
            [
                'id' => 'refs-bib',
                'path' => 'refs.bib',
                'label' => 'Bibliography (refs.bib)',
                'description' => 'BibTeX file for citations.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'BIB'
@article{example2024,
  author  = {Author One and Author Two},
  title   = {Example Paper Title},
  journal = {Journal Name},
  year    = {2024},
  volume  = {1},
  pages   = {1--10}
}
BIB,
            ],
            [
                'id' => 'abstract',
                'path' => 'abstract.tex',
                'label' => 'Abstract section',
                'description' => 'Separate abstract file to \\input{}.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
\begin{abstract}
Write your abstract here.
\end{abstract}
TEX,
            ],
            [
                'id' => 'intro',
                'path' => 'introduction.tex',
                'label' => 'Introduction section',
                'description' => 'Chapter/section partial.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
\section{Introduction}
Start your introduction here.
TEX,
            ],
            [
                'id' => 'methods',
                'path' => 'methods.tex',
                'label' => 'Methods section',
                'description' => 'Methods partial.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
\section{Methods}
Describe your methods here.
TEX,
            ],
            [
                'id' => 'conclusion',
                'path' => 'conclusion.tex',
                'label' => 'Conclusion section',
                'description' => 'Conclusion partial.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
\section{Conclusion}
Summarize your findings here.
TEX,
            ],
            [
                'id' => 'appendix',
                'path' => 'appendix.tex',
                'label' => 'Appendix',
                'description' => 'Appendix partial.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
\appendix
\section{Appendix}
Additional material.
TEX,
            ],
            [
                'id' => 'macros',
                'path' => 'macros.tex',
                'label' => 'Macros / preamble helpers',
                'description' => 'Custom commands to \\input{} from the preamble.',
                'category' => 'macros',
                'license' => Catalog::LICENSE_ID,
                'content' => <<<'TEX'
% Custom commands — \\input{macros} from your preamble
\usepackage{xcolor}
\newcommand{\todo}[1]{\textcolor{red}{[TODO: #1]}}
TEX,
            ],
            [
                'id' => 'blank-tex',
                'path' => 'section.tex',
                'label' => 'Blank .tex file',
                'description' => 'Empty section file.',
                'category' => 'starters',
                'license' => Catalog::LICENSE_ID,
                'content' => "% New section file\n",
            ],
        ];

        foreach (Catalog::macros() as $macro) {
            $files[] = [
                'id' => 'macro-' . $macro['id'],
                'path' => $macro['path'],
                'label' => $macro['name'],
                'description' => $macro['description'],
                'category' => (string) ($macro['category'] ?? 'macros'),
                'license' => (string) ($macro['license'] ?? Catalog::LICENSE_ID),
                'content' => $macro['content'],
            ];
        }

        return $files;
    }

    public static function commonFileById(string $id): ?array
    {
        foreach (self::commonFiles() as $f) {
            if ($f['id'] === $id) {
                return $f;
            }
        }
        return null;
    }

    private static function safeId(string $id): string
    {
        if (!preg_match('/^[a-z0-9_-]+$/i', $id)) {
            throw new RuntimeException('Invalid template id.');
        }
        return $id;
    }
}
