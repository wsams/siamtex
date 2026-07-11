<?php

declare(strict_types=1);

namespace SiamTeX;

/**
 * Curated first-party catalog: templates, macro packs, package guidance, and
 * licensed public resources (F-71). No third-party template federation.
 */
final class Catalog
{
    public const LICENSE_ID = 'MIT';
    public const LICENSE_URL = 'https://opensource.org/licenses/MIT';
    public const LICENSE_NOTE = 'First-party SiamTeX catalog content is MIT-licensed. See templates/LICENSE.';

    /**
     * Full catalog payload for the browse UI and API.
     *
     * @return array{
     *   license: array{id:string,name:string,url:string,note:string},
     *   templates: list<array<string,mixed>>,
     *   macros: list<array<string,mixed>>,
     *   packages: list<array<string,mixed>>,
     *   resources: list<array<string,mixed>>,
     *   commonFiles: list<array<string,mixed>>
     * }
     */
    public static function full(): array
    {
        return [
            'license' => [
                'id' => self::LICENSE_ID,
                'name' => 'MIT License',
                'url' => self::LICENSE_URL,
                'note' => self::LICENSE_NOTE,
            ],
            'templates' => Templates::catalog(),
            'macros' => self::macros(),
            'packages' => self::packages(),
            'resources' => self::resources(),
            'commonFiles' => Templates::commonFiles(),
        ];
    }

    /**
     * Macro / snippet packs users can insert or add as project files.
     *
     * @return list<array{
     *   id:string,name:string,description:string,category:string,tags:list<string>,
     *   license:string,licenseNote:string,path:string,content:string
     * }>
     */
    public static function macros(): array
    {
        return [
            [
                'id' => 'math-helpers',
                'name' => 'Math helpers',
                'description' => 'Common math shortcuts: R, N, E, Var, norms, and a TODO marker.',
                'category' => 'macros',
                'tags' => ['math', 'amsmath', 'preamble'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'macros-math.tex',
                'content' => <<<'TEX'
% Math helpers — \input{macros-math} from your preamble (after amsmath)
\newcommand{\R}{\mathbb{R}}
\newcommand{\N}{\mathbb{N}}
\newcommand{\Z}{\mathbb{Z}}
\newcommand{\E}{\mathbb{E}}
\newcommand{\Var}{\mathrm{Var}}
\newcommand{\norm}[1]{\left\lVert #1 \right\rVert}
\newcommand{\abs}[1]{\left\lvert #1 \right\rvert}
\newcommand{\todo}[1]{\textcolor{red}{[TODO: #1]}}
TEX,
            ],
            [
                'id' => 'theorem-envs',
                'name' => 'Theorem environments',
                'description' => 'amsthm theorem, lemma, definition, and proof environments.',
                'category' => 'macros',
                'tags' => ['amsthm', 'theorem', 'proof'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'macros-theorems.tex',
                'content' => <<<'TEX'
% Theorem environments — \usepackage{amsthm} then \input{macros-theorems}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\newtheorem{corollary}[theorem]{Corollary}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{example}[theorem]{Example}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}
TEX,
            ],
            [
                'id' => 'units-si',
                'name' => 'SI unit shortcuts',
                'description' => 'Lightweight unit macros without requiring siunitx (compatible with the default worker).',
                'category' => 'macros',
                'tags' => ['units', 'science', 'lab'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'macros-units.tex',
                'content' => <<<'TEX'
% SI-style unit helpers (no extra packages)
\newcommand{\unit}[1]{\,\mathrm{#1}}
\newcommand{\metre}{\unit{m}}
\newcommand{\second}{\unit{s}}
\newcommand{\kilogram}{\unit{kg}}
\newcommand{\newton}{\unit{N}}
\newcommand{\joule}{\unit{J}}
\newcommand{\celsius}{\unit{^{\circ}C}}
\newcommand{\percent}{\%}
TEX,
            ],
            [
                'id' => 'resume-snippets',
                'name' => 'Resume entry snippets',
                'description' => 'Copy-paste blocks for a job entry, skills line, and education row.',
                'category' => 'snippets',
                'tags' => ['resume', 'career'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'snippets-resume.tex',
                'content' => <<<'TEX'
% Resume snippets — paste into experience.tex / skills.tex / education.tex

% --- Job entry ---
\noindent\textbf{Role Title}\hfill Date range\\
\textit{Organization}, City, ST
\begin{itemize}
  \item Impact bullet with a metric when possible.
  \item Second accomplishment.
\end{itemize}

% --- Skills line ---
\noindent\textbf{Skills:} Language A, Tool B, Framework C

% --- Education row ---
\noindent\textbf{Degree}, Field\hfill Year\\
\textit{University Name}, City, ST
TEX,
            ],
            [
                'id' => 'table-booktabs',
                'name' => 'Booktabs table',
                'description' => 'A clean three-line table using booktabs (\toprule / \midrule / \bottomrule).',
                'category' => 'snippets',
                'tags' => ['table', 'booktabs'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'snippets-table.tex',
                'content' => <<<'TEX'
% Requires \usepackage{booktabs}
\begin{table}[ht]
\centering
\begin{tabular}{lcc}
\toprule
Column A & Column B & Column C \\
\midrule
Row 1 & --- & --- \\
Row 2 & --- & --- \\
\bottomrule
\end{tabular}
\caption{Caption for the table.}
\label{tab:example}
\end{table}
TEX,
            ],
            [
                'id' => 'figure-include',
                'name' => 'Figure include',
                'description' => 'Standard figure float with \includegraphics and a caption.',
                'category' => 'snippets',
                'tags' => ['figure', 'graphicx'],
                'license' => self::LICENSE_ID,
                'licenseNote' => self::LICENSE_NOTE,
                'path' => 'snippets-figure.tex',
                'content' => <<<'TEX'
% Requires \usepackage{graphicx}; place the image under figures/
\begin{figure}[ht]
  \centering
  \includegraphics[width=0.7\textwidth]{figures/example.png}
  \caption{Caption describing the figure.}
  \label{fig:example}
\end{figure}
TEX,
            ],
        ];
    }

    public static function macroById(string $id): ?array
    {
        foreach (self::macros() as $m) {
            if ($m['id'] === $id) {
                return $m;
            }
        }
        return null;
    }

    /**
     * Package guidance for packages available (or commonly used) with the TeX worker.
     *
     * @return list<array{
     *   id:string,name:string,description:string,category:string,tags:list<string>,
     *   license:string,licenseNote:string,ctanUrl:string,usage:string,inWorker:bool
     * }>
     */
    public static function packages(): array
    {
        $mitNote = 'Guidance text is MIT (SiamTeX). The TeX package itself has its own CTAN license.';
        return [
            [
                'id' => 'geometry',
                'name' => 'geometry',
                'description' => 'Set page margins and paper size without fighting the class defaults.',
                'category' => 'packages',
                'tags' => ['layout', 'margins'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/geometry',
                'usage' => '\\usepackage[margin=1in]{geometry}',
                'inWorker' => true,
            ],
            [
                'id' => 'hyperref',
                'name' => 'hyperref',
                'description' => 'Clickable links, PDF metadata, and cross-reference hyperlinks.',
                'category' => 'packages',
                'tags' => ['links', 'pdf'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/hyperref',
                'usage' => '\\usepackage{hyperref}',
                'inWorker' => true,
            ],
            [
                'id' => 'amsmath',
                'name' => 'amsmath',
                'description' => 'Essential math environments: align, gather, cases, and more.',
                'category' => 'packages',
                'tags' => ['math'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/amsmath',
                'usage' => '\\usepackage{amsmath,amssymb}',
                'inWorker' => true,
            ],
            [
                'id' => 'natbib',
                'name' => 'natbib',
                'description' => 'Author–year and numeric citations with BibTeX (used by article/book templates).',
                'category' => 'packages',
                'tags' => ['bibliography', 'citations'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/natbib',
                'usage' => "\\usepackage{natbib}\n\\bibliographystyle{plainnat}\n\\bibliography{refs}",
                'inWorker' => true,
            ],
            [
                'id' => 'enumitem',
                'name' => 'enumitem',
                'description' => 'Control list spacing, labels, and nesting for itemize/enumerate.',
                'category' => 'packages',
                'tags' => ['lists'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/enumitem',
                'usage' => '\\usepackage{enumitem}',
                'inWorker' => true,
            ],
            [
                'id' => 'booktabs',
                'name' => 'booktabs',
                'description' => 'Professional table rules (\toprule, \midrule, \bottomrule).',
                'category' => 'packages',
                'tags' => ['tables'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/booktabs',
                'usage' => '\\usepackage{booktabs}',
                'inWorker' => true,
            ],
            [
                'id' => 'graphicx',
                'name' => 'graphicx',
                'description' => 'Include PNG/JPEG/PDF figures with \includegraphics.',
                'category' => 'packages',
                'tags' => ['figures', 'images'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/graphicx',
                'usage' => '\\usepackage{graphicx}',
                'inWorker' => true,
            ],
            [
                'id' => 'titlesec',
                'name' => 'titlesec',
                'description' => 'Customize section headings (used by the resume template).',
                'category' => 'packages',
                'tags' => ['headings', 'resume'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/titlesec',
                'usage' => '\\usepackage{titlesec}',
                'inWorker' => true,
            ],
            [
                'id' => 'xcolor',
                'name' => 'xcolor',
                'description' => 'Text and rule colors; required for colored TODO markers.',
                'category' => 'packages',
                'tags' => ['color'],
                'license' => 'LPPL',
                'licenseNote' => $mitNote,
                'ctanUrl' => 'https://ctan.org/pkg/xcolor',
                'usage' => '\\usepackage{xcolor}',
                'inWorker' => true,
            ],
        ];
    }

    /**
     * Well-known public resources (links only — not redistributed).
     *
     * @return list<array{
     *   id:string,name:string,description:string,category:string,tags:list<string>,
     *   license:string,licenseNote:string,url:string
     * }>
     */
    public static function resources(): array
    {
        return [
            [
                'id' => 'ctan',
                'name' => 'CTAN',
                'description' => 'Comprehensive TeX Archive Network — search packages and documentation.',
                'category' => 'resources',
                'tags' => ['packages', 'docs'],
                'license' => 'Various',
                'licenseNote' => 'External site; packages have individual licenses. SiamTeX only links here.',
                'url' => 'https://ctan.org/',
            ],
            [
                'id' => 'latex-project',
                'name' => 'LaTeX Project',
                'description' => 'Official LaTeX documentation and getting-started guides.',
                'category' => 'resources',
                'tags' => ['docs', 'beginner'],
                'license' => 'Various',
                'licenseNote' => 'External documentation; linked for guidance only.',
                'url' => 'https://www.latex-project.org/help/documentation/',
            ],
            [
                'id' => 'overleaf-learn',
                'name' => 'Learn LaTeX (Overleaf)',
                'description' => 'Free public tutorials on common LaTeX tasks (external).',
                'category' => 'resources',
                'tags' => ['tutorial', 'beginner'],
                'license' => 'Various',
                'licenseNote' => 'External tutorials; linked where licensing allows public access.',
                'url' => 'https://www.overleaf.com/learn',
            ],
            [
                'id' => 'tex-stackexchange',
                'name' => 'TeX Stack Exchange',
                'description' => 'Q&A community for TeX and LaTeX problems.',
                'category' => 'resources',
                'tags' => ['help', 'community'],
                'license' => 'CC BY-SA',
                'licenseNote' => 'Community content under Stack Exchange terms; linked only.',
                'url' => 'https://tex.stackexchange.com/',
            ],
        ];
    }
}
