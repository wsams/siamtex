# SiamTeX

**Write serious LaTeX in the browser — compile to PDF beside your source, with encryption, templates, share links, and optional AI that runs on *your* hardware.**

SiamTeX is a security-minded LaTeX studio for **students finishing a thesis**, **researchers polishing a conference paper**, and **anyone** who wants professional typesetting without installing a full TeX stack on every device.

**Source:** https://github.com/wsams/siamtex

---

## Why SiamTeX?

LaTeX is still the gold standard for academic writing — but the toolchain is intimidating. SiamTeX lowers the floor while keeping the ceiling high:

| For students | For researchers & professionals |
|--------------|----------------------------------|
| Start from **homework** or **blank** templates with editable starter text | Multi-file **article** projects with `refs.bib` and natbib |
| **Toolbar / Insert menus** for bold, headings, math, lists, tables — no memorizing `\begin{}` | Side-by-side **PDF preview** with debounced auto-compile |
| **Multiple PDFs** — compile top-level files like `main.tex` and `cover-letter.tex` separately | Import/export **zip**, **share links**, page estimates, geometry tools |
| **Clickable compile errors** that jump to the offending line | **Version history** with branching undo and diff-before-restore |
| **AI fix problems** when the build breaks — review before applying | **AES-256-GCM encryption at rest** for sources and PDFs |
| Resume package with partials (experience, education, skills) | |

You get a real editor (CodeMirror), a sandboxed **Docker TeX worker** (`pdflatex`, `xelatex`, `lualatex`, BibTeX, Biber), and optional **GitHub OAuth** — or run in **local solo mode** on your own server with no sign-in wall.

---

## AI: home GPU or cloud APIs

> **Alpha / experimental.** AI assist and AI fix problems are early-stage. Accuracy, LaTeX correctness, and usefulness **depend on the model and provider you choose** (local Ollama, OpenAI, Gemini, etc.). Always review output before accepting — SiamTeX does not guarantee valid fixes or good edits.

SiamTeX does **not** need a GPU on the server. Common setups:

```
Path A (self-hosted):  Browser → VPS → Tailscale → Ollama at home
Path B (cloud API):    Browser → VPS → OpenAI / Gemini / Grok / OpenRouter
```

| Path | Best for |
|------|----------|
| **Tailscale + Ollama** | Modest VPS + GPU at home; no per-token cloud bill | [INSTALL_DO.md](./INSTALL_DO.md) · [docs/tailscale-ollama.md](./docs/tailscale-ollama.md) |
| **OpenAI, Gemini, Grok** | No home server; pay-as-you-go API | [docs/ai-providers.md](./docs/ai-providers.md) |
| **Claude (Anthropic)** | Via **OpenRouter** or OpenAI-compatible proxy | [docs/ai-providers.md](./docs/ai-providers.md) |

**In the app:** **AI chat** (Q&A with `@file` context) · **AI assist** · **AI fix compile problems** · **create project from prompt** · progress UI · version history.

Traffic path: **browser → your PHP server → provider you configure** (never browser → home Ollama directly).

### Administrator-controlled AI

On multi-user hosts, **AI is managed by an administrator** — not automatically on for everyone.

| Control | How it works |
|---------|----------------|
| **Server switch** | `SIAMTEX_AI_ENABLED=0` disables AI for the whole instance |
| **Per-user features** | Admins (`SIAMTEX_ADMIN_GITHUB_LOGINS`) use **AI access** in the app to enable Chat, Create project, Assist, Fix errors, and BYOK settings per account |
| **Default for new users** | All AI features **off** until granted |
| **Token quotas** | Optional per-user cap; blank = unlimited. Enforced before each AI call |
| **Usage visibility** | **AI access** shows tokens used per user (including admins) and **all-users total** |

Provider setup: [docs/ai-providers.md](./docs/ai-providers.md) · architecture: [AI.md](./AI.md).

---

## Scenarios

Screenshots live in `docs/screenshots/` for people who want to browse raw captures, but they go stale quickly as the UI evolves. The README focuses on the scenarios instead of embedding thumbnail galleries.

### Getting started

| Scenario | What it shows |
|---|---|
| Welcome & sign-in | GitHub OAuth when you want it, or local solo mode without a sign-in wall. |
| Project dashboard | Searchable project list, template starters, AI project creation, import/export zip. |
| Editor + live PDF | Multi-file editing, Insert menus, compile errors you can click, preview beside source. |
| Add files & assets | Upload images, bibliographies, and extra `.tex` files without leaving the browser. |

### AI chat for questions *(alpha)*

Ask plain-English questions in the sidebar chat, attach project files with `@file`, and copy LaTeX from the reply when you just want help thinking or typesetting.

### AI editing flow *(alpha)*

| Scenario | What happens |
|---|---|
| Start from blank | Create a project, open the editor, and let AI draft the first pass from a plain-English instruction. |
| Filter or rewrite | Use the AI sidebar to pick a target file, choose a filter, review token usage/thinking, and apply the result back into the editor. |
| Review before accept | Watch the stream in chat, inspect the generated LaTeX, then re-apply or continue editing manually. |
| Compile the result | Build immediately after the edit and see the PDF preview update beside the source. |

### Image workflow

| Scenario | What happens |
|---|---|
| Upload an asset | Add `png`, `jpg`, `pdf`, bibliography, or extra source files to the project. |
| Ask AI to place it | Tell AI where to insert the figure; it can use the filename already in the project. |
| Tweak layout in place | Ask AI to resize, re-center, or restyle the figure without hunting through LaTeX manually. |
| Rebuild and verify | Compile again and confirm the PDF layout looks right. |

### Recover from compile errors

| Scenario | What happens |
|---|---|
| Problems panel catches the error | Structured diagnostics show file, line, and message. |
| AI fix problems | SiamTeX sends the build log and relevant sources to the model. |
| Minimal repair suggestion | Review the proposed fix before it touches the editor. |
| Clean compile again | Accept the fix, rebuild, and confirm the PDF preview comes back. |

### Version history

| Scenario | What happens |
|---|---|
| Timeline view | Every save, AI apply, and restore becomes a node on a per-file branching timeline. |
| Diff before restore | Compare the current editor against any earlier revision before jumping back. |
| Branching restore | Restoring does not erase history; it grows a new branch from the point you chose. |

---

## Features

- Multi-file projects with syntax-highlighted editor and Insert menus for common LaTeX
- Live PDF preview and structured compile diagnostics (file, line, severity)
- **Multiple compile entries** — each top-level `.tex` (e.g. `main.tex`, `cover-letter.tex`) builds its own PDF; preview follows the active file
- Curated templates: blank, homework, resume (multi-file), academic article
- Import / export zip · share links · author tools (page estimate, geometry)
- Encrypted storage for project files and compiled PDFs (per-entry PDF blobs)
- GitHub OAuth optional · local solo mode when OAuth is unset
- **AI chat** (Markdown, copyable code blocks, `@file` context) · **AI assist** · **fix compile problems** · **create project from prompt** *(alpha — quality depends on your model)*; server Ollama or BYOK
- **Per-user AI permissions** — off by default; admins enable Chat / Assist / Fix / Create / BYOK per account in **AI access**
- **Per-user AI token quotas** — optional caps set by administrators; usage tracked per user and site-wide
- **Per-file version history** — branching undo tree, diff preview, restore

Details: [SPECS.md](./SPECS.md) · AI architecture & BYOK: [AI.md](./AI.md)

---

## Install

You do **not** need to read every guide cover-to-cover. The docs exist for humans **and** for coding agents (Cursor, Claude Code, Copilot, etc.) that can SSH into a server and run the steps for you.

### Easiest path: let an agent install it

1. Create a Linux VPS (e.g. [DigitalOcean](https://www.digitalocean.com/)) and add your SSH key.
2. Open an AI agent with **shell access** to the droplet.
3. Paste a prompt like:

> Read [AGENTS.md](./AGENTS.md) (or [INSTALL_DO.md](./INSTALL_DO.md) for DigitalOcean) and install SiamTeX on this server.  
> Web URL: `https://YOUR_DOMAIN/siamtex`  
> I want GitHub OAuth (or solo mode). For AI I will use **Ollama over Tailscale** / **OpenAI** / **none** — ask me before writing API keys.  
> Do not commit secrets.

The agent should follow [AGENTS.md](./AGENTS.md) or [INSTALL_DO.md](./INSTALL_DO.md), configure [docs/ai-providers.md](./docs/ai-providers.md) if you want AI, and report back with the OAuth callback URL and smoke-test results. [AI.md](./AI.md) explains BYOK and architecture if the agent needs context.

**Home Ollama (optional):** the same pattern works on your desktop — join Tailscale, install Ollama, point the droplet at your machine per [INSTALL_DO.md](./INSTALL_DO.md) §8 and [docs/tailscale-ollama.md](./docs/tailscale-ollama.md). Or skip home GPU and use a cloud API.

**Manual install:** follow the guides yourself if you prefer — same files, more clicking.

| Guide | Best for |
|-------|----------|
| **[INSTALL_DO.md](./INSTALL_DO.md)** | **DigitalOcean** — prerequisites, DNS (any registrar), PHP/Apache/Docker, Certbot TLS, optional AI |
| **[docs/ai-providers.md](./docs/ai-providers.md)** | **AI setup** — OpenAI, Gemini, Grok, OpenRouter/Claude, Ollama (any host) |
| **[AGENTS.md](./AGENTS.md)** | Any Linux server — full runbook for AI coding agents |
| **[AI.md](./AI.md)** | BYOK architecture, permissions, quotas (product context for agents) |
| **[config/](./config/README.md)** | Sample vhost, env, `.htaccess`, php-fpm drop-in |

**Cursor:** use the project skill `.cursor/skills/install-siamtex/` or `@install-siamtex` so the agent loads the workflow automatically.

**Requirements (compile server):** PHP 8.2+, Composer, Docker, **2 GB+ RAM**, **40 GB+ disk** ([SPECS.md §6.2](./SPECS.md)). AI inference is optional and typically runs elsewhere.

---

## Project layout

| Path | Purpose |
|------|---------|
| `index.php` | App shell |
| `api/` | JSON, PDF, auth, AI, and history endpoints |
| `src/` | PHP domain logic |
| `templates/` | Curated starter packages |
| `config/` | Sample server configs (not secrets) |
| `docs/` | Screenshots, Tailscale guide (**blocked from HTTP on deploy**) |
| `INSTALL_DO.md` | DigitalOcean install (+ optional home GPU) |
| `docs/ai-providers.md` | AI provider env recipes for agents |
| `AGENTS.md` | Agent + operator install runbook |
| `data/` | SQLite, encrypted projects (**gitignored**) |

---

## Contributing

Bug fixes, templates, and UX improvements welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md).

Licensed under the [MIT License](./LICENSE).

---

*From first homework set to camera-ready paper — compile on a small VPS, think with a model at home, and keep every revision on the timeline.*
