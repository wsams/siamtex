# SiamTeX features

Detailed inventory of what ships today. For a short pitch, see the [README](../README.md). For gaps and planned work, see [roadmap.md](./roadmap.md).

---

## Editor & compile

- Multi-file projects with a syntax-highlighted **CodeMirror** editor
- **Native spell check** (offline Hunspell/`Typo.js`) — wavy underlines in prose, right-click suggestions; skips LaTeX commands and math; toggle with **Spell** in the editor bar
- Beginner **Insert menus** — bold, italic, headings, links, lists, colors, math, tables, images, resume snippets; wraps the current selection
- Side-by-side **PDF preview** with debounced auto-compile and explicit Compile
- Structured **compile diagnostics** (file, line, severity) with click-to-jump; raw build log still available
- **Multiple compile entries** — each top-level `.tex` builds its own encrypted PDF; preview follows the active file
- Sandboxed **Docker TeX worker** — `pdflatex`, `xelatex`, `lualatex`, BibTeX, Biber via `latexmk` (no host TeX install)

---

## Projects & templates

- Curated first-party templates: **blank**, **homework**, **resume** (multi-file package), **article**, **book**
- Import / export **zip**
- Upload images, PDFs, bibliographies, and extra sources into a project
- **Word / DOCX import** — extract text and figures (macros never executed); images land under `figures/` as downloadable project assets; save as basic `.tex` or optional AI conversion with review-before-accept
- Soft-delete projects (retention purge is planned — see roadmap)

---

## Security & auth

- **AES-256-GCM encryption at rest** for project files and compiled PDFs
- Compile path: decrypt → temp dir → `docker run --network=none …` → encrypt PDF → wipe plaintext
- Optional **GitHub OAuth** or **local solo mode** when OAuth credentials are empty
- CSRF protection on mutating APIs; deny rules for non-public paths on deploy

---

## Sharing & history

- **Share links** with server-enforced roles
- **Per-file version history** — branching undo tree, diff before restore, restore grows a new branch

---

## Author tools

- Page-length estimate, geometry/margins helper, rough word count
- Geometry insert helpers from the toolbar

---

## AI *(alpha / experimental)*

Quality depends on the model and provider you configure. Always review before accepting.

| Capability | Notes |
|------------|--------|
| **AI chat** | Q&A with Markdown replies, copyable code blocks, `@file` / `@active` / `@selection` context |
| **AI assist** | Structured single- or multi-file edits; review before apply |
| **AI fix problems** | Send build log + sources; accept a minimal repair |
| **Create project from prompt** | Dashboard flow to scaffold a new project |
| **Providers** | Server Ollama (e.g. home GPU over Tailscale), OpenAI, Gemini, Grok, OpenRouter/Claude, other OpenAI-compatible |
| **BYOK** | Per-user encrypted provider settings |
| **Admin AI access** | New users start with all AI **off**; admins enable Chat / Assist / Fix / Create / BYOK per account |
| **Token quotas** | Optional per-user caps; usage tracked per user and site-wide |
| **Streaming** | Live progress via SSE (`api/ai_stream.php`) |

Setup: [ai-providers.md](./ai-providers.md) · architecture: [AI.md](../AI.md).

---

## Who it is for

| Students | Researchers & professionals |
|----------|------------------------------|
| Homework / blank templates with editable starter text | Multi-file article projects with `refs.bib` and natbib |
| Toolbar / Insert menus — no memorizing `\begin{}` | Side-by-side PDF with auto-compile |
| Multiple PDFs (e.g. resume + cover letter) | Import/export zip, share links, page estimates, geometry |
| Clickable compile errors | Branching version history with diff-before-restore |
| AI fix problems when the build breaks | AES-256-GCM encryption at rest |

---

## Related

- [user-guide.md](./user-guide.md) — scenarios and walkthroughs
- [roadmap.md](./roadmap.md) — competitive gaps and TODOs
- [SPECS.md](../SPECS.md) — requirements source of truth
