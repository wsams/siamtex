# SiamTeX

**Write serious LaTeX in the browser — compile to PDF beside your source, with encryption, templates, share links, and optional AI that runs on *your* hardware.**

SiamTeX is a security-minded LaTeX studio for **students finishing a thesis**, **researchers polishing a conference paper**, and **anyone** who wants professional typesetting without installing a full TeX stack on every device.

The browser-LaTeX market is crowded. Hosted IDEs, desktop suites, and AI writing tools each cover a slice of the problem. SiamTeX is for people who want a **real editor + sandboxed compile**, **documents encrypted at rest**, and **AI you control** — self-hosted on a small VPS, with a home GPU or a cloud API you choose.

**Source:** https://github.com/wsams/siamtex

---

## Why SiamTeX?

| You care about… | SiamTeX gives you… |
|-----------------|--------------------|
| **Owning the stack** | Self-host on a modest VPS; solo mode or GitHub OAuth |
| **Privacy by default** | AES-256-GCM encryption for sources and PDFs; Docker compile with `--network=none` |
| **AI without a vendor lock-in** | Ollama at home (e.g. over Tailscale), or OpenAI / Gemini / Grok / OpenRouter — BYOK and admin quotas |
| **Getting work done** | Live PDF preview, clickable errors, multi-file projects, multiple PDFs per project |
| **Not losing work** | Branching per-file version history with diff-before-restore |
| **Starting fast** | Homework, resume, article, and book templates + Insert menus for newcomers |

Deep dive: [docs/features.md](./docs/features.md) · walkthroughs: [docs/user-guide.md](./docs/user-guide.md)

---

## Standout capabilities

These are the pieces that set SiamTeX apart from “just another online TeX editor”:

- **Self-host first** — your server, your data, your upgrade cadence
- **Encryption at rest** — project files and compiled PDFs under AES-256-GCM
- **Sandboxed TeX** — `pdflatex` / `xelatex` / `lualatex` + BibTeX/Biber in Docker, not on the host
- **AI on your terms** *(alpha)* — chat, assist, fix compile problems, create-from-prompt; local model or cloud API; per-user permissions and token quotas
- **Multiple compile entries** — e.g. `main.tex` and `cover-letter.tex` each produce their own PDF
- **Branching history** — every save and AI apply is on a timeline; restore never erases the past
- **Agent-ready install** — paste a prompt into Cursor/Claude Code and follow [AGENTS.md](./AGENTS.md) / [INSTALL_DO.md](./INSTALL_DO.md)

---

## How SiamTeX compares

Many products offer a browser editor and a PDF preview. Fewer let you **self-host**, **encrypt at rest**, and **point AI at your own GPU**. We do not name competitors here — only capabilities.

| Capability | SiamTeX | Typical hosted LaTeX IDE | Typical desktop TeX |
|------------|:-------:|:------------------------:|:-------------------:|
| Browser editor + live PDF | Yes | Yes | — |
| Self-host / own your data | **Yes** | Rare | Local files |
| App-managed encryption at rest | **Yes** | Varies | — |
| Docker-sandboxed remote compile | **Yes** | Vendor sandbox | Local TeX |
| AI with BYOK / local Ollama | **Yes** (alpha) | Usually vendor AI | Plugins |
| Admin AI permissions & quotas | **Yes** | Rare | — |
| Multiple PDFs per project | **Yes** | Varies | Manual |
| Branching in-app file history | **Yes** | Varies | Use git |
| Real-time multi-cursor co-editing | [TODO](https://github.com/wsams/siamtex/issues/1) | Often | Rare |
| Smart bibliography UI | **Yes** | Often | Varies |
| Native spell check | Yes | Often | Often |
| Comments / review mode | [TODO](https://github.com/wsams/siamtex/issues/5) | Often | Rare |
| Git / GitHub project sync | [TODO](https://github.com/wsams/siamtex/issues/15) | Often | External git |
| Word / DOCX import | **Yes** | Sometimes | Converters |
| Large template marketplace | First-party ([expand](https://github.com/wsams/siamtex/issues/9)) | Often | CTAN |

Full matrix, rationale, and issue links: **[docs/roadmap.md](./docs/roadmap.md)**.

---

## AI: home GPU or cloud APIs

> **Alpha / experimental.** Quality depends on the model you choose. Always review before accepting.

```
Path A (self-hosted):  Browser → VPS → Tailscale → Ollama at home
Path B (cloud API):    Browser → VPS → OpenAI / Gemini / Grok / OpenRouter
```

Traffic is always **browser → your PHP server → provider** — never browser → home Ollama directly. On multi-user hosts, AI starts **off** until an admin enables features per user.

| Guide | When to use it |
|-------|----------------|
| [docs/ai-providers.md](./docs/ai-providers.md) | OpenAI, Gemini, Grok, OpenRouter/Claude, Ollama env recipes |
| [INSTALL_DO.md](./INSTALL_DO.md) + [docs/tailscale-ollama.md](./docs/tailscale-ollama.md) | Droplet + home GPU |
| [AI.md](./AI.md) | BYOK architecture, permissions, quotas |

---

## Documentation

| Doc | What it is |
|-----|------------|
| **[docs/user-guide.md](./docs/user-guide.md)** | Scenarios: editor, AI flows, images, errors, history |
| **[docs/features.md](./docs/features.md)** | Full feature inventory |
| **[docs/roadmap.md](./docs/roadmap.md)** | Competitive gaps & TODOs (with GitHub issues) |
| **[docs/project-layout.md](./docs/project-layout.md)** | Repository map |
| **[SPECS.md](./SPECS.md)** | Product & security requirements |
| **[AGENTS.md](./AGENTS.md)** | Operator / AI-agent install runbook (any Linux host) |
| **[INSTALL_DO.md](./INSTALL_DO.md)** | DigitalOcean droplet (+ optional Tailscale Ollama) |
| **[docs/ai-providers.md](./docs/ai-providers.md)** | AI provider setup |
| **[config/](./config/README.md)** | Sample Apache/Nginx, env, php-fpm, `.htaccess` |
| **[CONTRIBUTING.md](./CONTRIBUTING.md)** | How to contribute |

---

## Install (quick start)

You do **not** need to read every guide. The easiest path is an AI coding agent with SSH access:

> Read [AGENTS.md](./AGENTS.md) (or [INSTALL_DO.md](./INSTALL_DO.md) for DigitalOcean) and install SiamTeX on this server.  
> Web URL: `https://YOUR_DOMAIN/siamtex`  
> I want GitHub OAuth (or solo mode). For AI I will use **Ollama over Tailscale** / **OpenAI** / **none** — ask me before writing API keys.  
> Do not commit secrets.

**Requirements:** PHP 8.2+, Composer, Docker, **2 GB+ RAM**, **40 GB+ disk** ([SPECS.md §6.2](./SPECS.md)).

**Cursor:** `@install-siamtex` or `.cursor/skills/install-siamtex/`.

---

## Contributing

Bug fixes, templates, and UX improvements welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md). Feature ideas and gaps are tracked in [docs/roadmap.md](./docs/roadmap.md) and [GitHub Issues](https://github.com/wsams/siamtex/issues).

Licensed under the [MIT License](./LICENSE).

---

*From first homework set to camera-ready paper — compile on a small VPS, think with a model at home, and keep every revision on the timeline.*
