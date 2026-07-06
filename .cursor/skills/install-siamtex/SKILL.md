---
name: install-siamtex
description: >-
  Installs and configures SiamTeX on a Linux server with PHP-FPM, Docker, and
  Apache or Nginx. Use when deploying SiamTeX, self-hosting, server setup,
  php-fpm environment, TeX worker Docker image, OAuth callback configuration,
  or when the user asks an agent to install or operate SiamTeX.
---

# Install SiamTeX

Deploy the SiamTeX LaTeX studio on a Linux host.

## Which doc to follow

| Host / AI | Read first |
|-----------|------------|
| **DigitalOcean droplet** (incl. Tailscale → home Ollama) | **[INSTALL_DO.md](../../../INSTALL_DO.md)** |
| **Cloud AI** (OpenAI, Gemini, Grok, OpenRouter/Claude) | **[docs/ai-providers.md](../../../docs/ai-providers.md)** after core install |
| Any other Linux server | **[AGENTS.md](../../../AGENTS.md)** |

If the user says **DigitalOcean**, **DO**, or **droplet + home GPU**, use **INSTALL_DO.md**.  
If they name **OpenAI**, **Gemini**, **Grok**, **Claude**, or **Anthropic**, use **docs/ai-providers.md** (Claude → OpenRouter).  
**Ask which AI provider** if not stated — do not assume Ollama.

Always apply cross-cutting rules from AGENTS.md: web exposure, security, no secrets in git.

## Before running commands

Collect from the human (ask if missing):

- Public base URL, e.g. `https://HOST/siamtex` (no trailing slash)
- App root path, e.g. `/var/www/html/siamtex`
- Web server: Apache or Nginx
- PHP-FPM version and pool user (usually `www-data`)
- GitHub OAuth: yes/no
- **AI:** none / Ollama (home) / OpenAI / Gemini / Grok / OpenRouter (Claude) — see [docs/ai-providers.md](../../../docs/ai-providers.md). **Alpha features** — set expectations with the human.
- **AI admins** (multi-user): comma-separated GitHub logins for `SIAMTEX_ADMIN_GITHUB_LOGINS` — enables **AI access** UI to grant chat/assist/fix/create/BYOK per user.

Never commit secrets, `.htaccess`, or `data/` to git. Never write production URLs into tracked source files.

**Web exposure:** the git tree is not the public web surface. Do not copy screenshots or admin files into served paths. Install deny rules (`config/htaccess.example`) and verify `AGENTS.md`, `config/`, and `docs/` return 403/404 — see AGENTS.md § Repository vs deployment.

## Deploy checklist

```
- [ ] Prerequisites: PHP 8.2+, Composer, Docker, openssl + pdo_sqlite
- [ ] php-fpm user in docker group
- [ ] composer install --no-dev --optimize-autoloader
- [ ] docker build -t siamtex-tex-worker:local docker/tex-worker
- [ ] ./scripts/compile-example.sh  → must produce work/main.pdf
- [ ] mkdir -p data/projects data/tmp && chown php-fpm-user data
- [ ] install config/siamtex.env.example → /etc/siamtex.env (640, edit values)
- [ ] install php-fpm systemd drop-in from config/php-fpm-siamtex.conf.example
- [ ] configure web server from config/apache-* or config/nginx-*
- [ ] cp config/htaccess.example .htaccess  (Apache)
- [ ] verify AGENTS.md / config / docs NOT reachable over HTTP (403/404)
- [ ] restart php-fpm + web server
- [ ] curl api/auth_me.php — JSON OK
- [ ] browser: create project, compile PDF
- [ ] if AI requested: docs/ai-providers.md → `/etc/siamtex.env` → restart php-fpm → AI test connection
- [ ] if multi-user + AI: set `SIAMTEX_ADMIN_GITHUB_LOGINS` → `php scripts/sync-ai-admins.php` → enable features in **AI access**
- [ ] optional: compile a second top-level `.tex` (e.g. cover letter) and confirm per-entry PDF preview
```

## Key paths

| Item | Location |
|------|----------|
| Env (secrets) | `/etc/siamtex.env` from `config/siamtex.env.example` |
| Runtime data | `data/` (gitignored, not web-accessible) |
| Config samples | `config/` |
| OAuth callback | `{SIAMTEX_OAUTH_BASE_URL}/api/auth_callback.php` |

## Solo mode vs OAuth

- **Empty** `SIAMTEX_GITHUB_CLIENT_ID` / `SECRET` → local solo mode, no sign-in wall
- **Set both** + `SIAMTEX_AUTH_REQUIRED=1` → GitHub sign-in required

Human must create the GitHub OAuth App; agent writes credentials to `/etc/siamtex.env` only.

## Verification (required before reporting done)

1. `./scripts/compile-example.sh` exit 0
2. `curl -sS "$BASE/api/auth_me.php"` returns valid JSON
3. Deployment report: paths, services restarted, OAuth callback URL if applicable

## On failure

See troubleshooting table in [AGENTS.md](../../../AGENTS.md). Do not weaken Docker sandbox (`--network=none`, memory limit, read-only root).

## Additional resources

- AI providers (OpenAI, Gemini, Grok, OpenRouter, Ollama): [docs/ai-providers.md](../../../docs/ai-providers.md)
- DigitalOcean + home GPU: [INSTALL_DO.md](../../../INSTALL_DO.md)
- Full runbook: [AGENTS.md](../../../AGENTS.md)
- Config templates: [config/README.md](../../../config/README.md)
- Security requirements: [SPECS.md](../../../SPECS.md) §5
