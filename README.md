# SiamTeX

**Write serious LaTeX in the browser — compile to PDF beside your source, with encryption, templates, and share links.**

SiamTeX is a modern rebuild of the original SiamTeX (~2004): a security-minded LaTeX studio for **students finishing a thesis**, **researchers polishing a conference paper**, and **anyone** who wants professional typesetting without installing a full TeX stack on every device.

**Source:** https://github.com/wsams/siamtex

---

## Why SiamTeX?

LaTeX is still the gold standard for academic writing — but the toolchain is intimidating. SiamTeX lowers the floor while keeping the ceiling high:

| For students | For researchers & professionals |
|--------------|----------------------------------|
| Start from **homework** or **blank** templates with editable starter text | Multi-file **article** projects with `refs.bib` and natbib |
| **Toolbar inserts** for bold, headings, math, lists, tables — no memorizing `\begin{}` | Side-by-side **PDF preview** with debounced auto-compile |
| **Clickable compile errors** that jump to the offending line | Import/export **zip**, **share links**, page estimates, geometry tools |
| Resume package with partials (experience, education, skills) | **AES-256-GCM encryption at rest** for sources and PDFs |

You get a real editor (CodeMirror), a sandboxed **Docker TeX worker** (`pdflatex`, `xelatex`, `lualatex`, BibTeX, Biber), and optional **GitHub OAuth** — or run in **local solo mode** on your own server with no sign-in wall.

---

## Screenshots

**Welcome & sign-in** — GitHub OAuth when you want it, or run locally without a sign-in wall.

![SiamTeX welcome screen](docs/screenshots/not-signed-in.png)

**Project dashboard** — your work, templates for articles, homework, and resumes, import/export zip.

![SiamTeX project dashboard](docs/screenshots/signed-in-dashboard.png)

**Editor + live PDF** — multi-file projects, toolbar inserts, compile errors you can click, preview beside your source.

![SiamTeX editor with live PDF preview](docs/screenshots/edit-document.png)

**Add files & assets** — upload images, spin up `.tex` partials, bibliographies, and sections without leaving the browser.

![SiamTeX add file dialog](docs/screenshots/upload-files.png)

---

## Features (v1)

- Multi-file projects with syntax-highlighted editor
- Beginner insert toolbar (structure, math, resume snippets, …)
- Live PDF preview and structured compile diagnostics
- Curated templates: blank, homework, resume (multi-file), academic article
- Import / export zip · share links · author tools
- Encrypted storage for project files and compiled PDFs
- GitHub OAuth optional

Details: [SPECS.md](./SPECS.md) · Future AI (BYOK): [AI.md](./AI.md)

---

## Install

**Self-hosting:** use an AI coding agent with [AGENTS.md](./AGENTS.md) — it is the full deployment runbook (PHP, Docker, web server, OAuth). Sample configs live in [`config/`](./config/README.md).

**Cursor:** this repo includes `.cursor/skills/install-siamtex/` — tell the agent to use the **install-siamtex** skill or paste the prompt from AGENTS.md.

**Requirements:** PHP 8.2+, Composer, Docker, 2 GB+ RAM and 40 GB+ disk recommended ([SPECS.md §6.2](./SPECS.md)).

---

## Project layout

| Path | Purpose |
|------|---------|
| `index.php` | App shell |
| `api/` | JSON, PDF, and auth endpoints |
| `src/` | PHP domain logic |
| `templates/` | Curated starter packages |
| `config/` | Sample server configs (not secrets) |
| `docs/screenshots/` | README marketing images (in git; blocked from HTTP on deploy) |
| `AGENTS.md` | Agent + operator install runbook |
| `data/` | SQLite, encrypted projects (**gitignored**) |

---

## Contributing

Bug fixes, templates, and UX improvements welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

Licensed under the [MIT License](./LICENSE).

---

*From first homework set to camera-ready paper — SiamTeX keeps you in the flow between `\section{}` and the PDF on the right.*
