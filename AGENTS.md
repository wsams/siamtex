# AGENTS.md — Deploying SiamTeX

This document is the **operator and AI-agent runbook** for installing SiamTeX on a server. Human administrators should point coding agents here; agents should treat this file as the source of truth for deployment.

**Repository:** https://github.com/wsams/siamtex

---

## Choose the right install guide

**Agents and humans:** read this section first. Do not run the generic checklist below when a specialized guide applies.

| Situation | Primary doc | What to do |
|-----------|-------------|------------|
| **DigitalOcean droplet** (especially + home GPU / Ollama over Tailscale) | **[INSTALL_DO.md](./INSTALL_DO.md)** | Follow INSTALL_DO.md end-to-end — includes §0 prerequisites, DNS (Namecheap/DO/Cloudflare), PHP-FPM, Certbot, Docker TeX worker, optional AI. Use AGENTS.md for cross-cutting rules. |
| **Cloud AI** (OpenAI, Gemini, Grok, OpenRouter/Claude, other OpenAI-compatible) | **[docs/ai-providers.md](./docs/ai-providers.md)** | Install core app per AGENTS.md or INSTALL_DO.md, then configure `SIAMTEX_AI_*` in `/etc/siamtex.env` using the matching provider recipe. Restart php-fpm; verify **AI → Test connection**. |
| University / corporate Linux, Nginx, no AI, custom paths | **This file (AGENTS.md)** | Full generic runbook below. |
| Tailscale ACL hardening or Ollama bind details only | [docs/tailscale-ollama.md](./docs/tailscale-ollama.md) | Supplement after INSTALL_DO.md §7. |
| AI provider comparison and BYOK | [docs/ai-providers.md](./docs/ai-providers.md) | All install paths — ask human which provider before writing keys. |

**If the human says “DigitalOcean”, “DO droplet”, or “droplet + home Ollama”:** open and follow **[INSTALL_DO.md](./INSTALL_DO.md)** as the install source of truth. Mention that in your deployment report.

**If the human says “OpenAI”, “Gemini”, “Grok”, “Claude”, or “Anthropic”:** configure AI per **[docs/ai-providers.md](./docs/ai-providers.md)**. Claude/Anthropic uses **OpenRouter** (or another OpenAI-compatible gateway), not `api.anthropic.com` directly.

**Sample agent prompt (cloud AI):**

> Read `AGENTS.md` and `docs/ai-providers.md`. Install SiamTeX, then configure OpenAI (or Gemini / Grok / OpenRouter) in `/etc/siamtex.env`. I will paste the API key when you ask. Do not commit secrets.

**Sample agent prompt (DigitalOcean):**

> Read `INSTALL_DO.md` in the SiamTeX repo and install on this DigitalOcean droplet.  
> Web URL base: `https://YOUR_DOMAIN/siamtex`  
> I will use Tailscale to reach Ollama at home for AI.  
> Do not commit secrets or production URLs to git.

**Sample agent prompt (generic):**

> Read `AGENTS.md` in the SiamTeX repo and install the service on this server.  
> …

---

## How to use an agent to install SiamTeX

Give your agent **SSH or shell access** to the target server (or a staging VM with the same OS stack), then paste a prompt like the **generic** example below — or the **DigitalOcean** example in [Choose the right install guide](#choose-the-right-install-guide) if that matches your host.

> Read `AGENTS.md` in the SiamTeX repo and install the service on this server.  
> Web URL base: `https://YOUR_HOST/siamtex`  
> Web root: `/var/www/html/siamtex`  
> Stack: Apache + PHP 8.3-FPM + Docker  
> GitHub OAuth: yes (I will paste client ID/secret when you ask)  
> Do not commit secrets or production URLs to git.

**Cursor users:** this repo ships a project skill at `.cursor/skills/install-siamtex/SKILL.md`. Mention “use the install-siamtex skill” or `@install-siamtex` so the agent loads the workflow automatically.

**What the agent should produce when done:**

1. A short **deployment report** (what was installed, paths, services restarted).
2. Confirmation that `./scripts/compile-example.sh` succeeded.
3. The **OAuth callback URL** (if OAuth is enabled) for you to paste into GitHub.
4. Any **manual steps** only you can do (DNS, TLS cert, GitHub OAuth app creation).

Agents must **run commands themselves** — not only print instructions — unless blocked by permissions.

---

## Collect these inputs first

Ask the human for anything missing before changing production config.

| Input | Example | Required |
|-------|---------|----------|
| Public base URL (no trailing slash) | `https://latex.university.edu/siamtex` | Yes |
| Filesystem path to app root | `/var/www/html/siamtex` | Yes |
| Web server | Apache or Nginx | Yes |
| PHP version / FPM pool user | `8.3`, `www-data` | Yes |
| TLS termination | Let’s Encrypt, existing cert, reverse proxy | Yes |
| GitHub OAuth | on / off | Yes |
| Server RAM / disk | ≥ 2 GB RAM, ≥ 40 GB disk | Warn if low |
| **AI provider** (if any) | `none`, `ollama`, `openai`, `google`, `xai`, `openrouter`, `openai_compatible` | Ask — see [docs/ai-providers.md](./docs/ai-providers.md) |
| **AI credentials** | API key or Tailscale/Ollama hostname | Human provides; write only to `/etc/siamtex.env` or per-user BYOK |

**Defaults if unspecified:**

- Image tag: `siamtex-tex-worker:local`
- Env file: `/etc/siamtex.env`
- Solo mode when OAuth credentials are empty

---

## Architecture (what you are installing)

| Component | Role |
|-----------|------|
| PHP app (`index.php`, `api/`, `src/`) | Web UI + JSON API |
| SQLite (`data/siamtex.sqlite`) | Users, projects, build metadata — **gitignored** |
| Encrypted blobs (`data/projects/`) | AES-256-GCM project files and PDFs — **gitignored** |
| Docker TeX worker | Sandboxed `latexmk` compiles — **no host TeX install** |
| `/etc/siamtex.env` | OAuth + optional AI keys — **never in git** |

Compiles: PHP decrypts → temp dir → `docker run --network=none … latexmk` → encrypt PDF → wipe plaintext.

**Optional AI:** PHP proxies `POST /v1/chat/completions` to the configured provider (Ollama, OpenAI, Gemini, Grok, OpenRouter, etc.). See [docs/ai-providers.md](./docs/ai-providers.md). Agents must ask which provider — do not assume home Ollama. **AI features are alpha/experimental;** set expectations that model choice drives accuracy.

---

## Repository vs deployment vs web exposure

The git clone is **not** the same thing as “everything that should be browsable.” On many servers the app root *is* the DocumentRoot (e.g. `/var/www/html/siamtex`), so **every file in the tree is a candidate for HTTP access** unless you block it. Agents must separate three concerns:

| Layer | What it is | Agent mindset |
|-------|------------|---------------|
| **Git repository** | Source, docs, runbooks, samples, skills | OK to commit; not all of it belongs on a public URL |
| **Deployment tree** | Files on the server that run the app | Install only what the service needs; create runtime dirs (`data/`) |
| **Web surface** | URLs that should return 200 to anonymous users | **Small allow-list** — see below |

### Intentionally web-accessible

These paths are **meant** to be served over HTTP:

| Path | Why |
|------|-----|
| `index.php` | App shell |
| `api/*.php` | JSON, PDF, auth endpoints |
| `assets/*` | CSS, JS, favicons (public static UI) |
| `favicon.ico` | Tab icon |

Everything else is loaded by PHP from disk (e.g. `src/`, `templates/`, `vendor/`) and **must not** be directly fetchable.

### In the repo but must NOT be web-accessible

Do **not** treat a full `git clone` as public content. Block HTTP access to:

| Path / pattern | Examples | Why |
|----------------|----------|-----|
| Runtime & secrets | `data/`, `work/`, `*.sqlite`, `*.enc` | User documents, keys, DB |
| Dependencies & source | `vendor/`, `src/` | Implementation detail; supply-chain risk |
| Operator / docs | `AGENTS.md`, `README.md`, `SPECS.md`, `CONTRIBUTING.md`, `docs/` | Runbooks, marketing screenshots, specs |
| Deploy samples | `config/`, `scripts/`, `docker/`, `.cursor/` | Samples and tooling — not for visitors |
| Templates on disk | `templates/` | Served via API logic, not direct download |
| VCS & dotfiles | `.git/`, `.gitignore`, `.env` | Standard hardening |

**Screenshots and marketing assets** (e.g. README PNGs) belong in **`docs/`** in git — or **outside the web root entirely** on the admin workstation. **Never** copy them into the DocumentRoot root, `assets/`, or other served paths unless they are deliberate public static files (they are not, today).

### What agents must not do during install

- Copy personal or marketing files (screenshots, edited PNGs, home-directory paths) into the web root “for convenience”
- Add new directories under the app root without checking whether HTTP access is intended
- Assume “it’s in the repo” ⇒ “it should be deployable as-is over HTTP”
- Skip `.htaccess` / nginx `deny` rules because “Apache already has a vhost”
- Commit server-specific `.htaccess`, `.env`, or `data/` back to git

### What agents should do

1. **Deploy the application**, not the entire monorepo mindset — same directory is fine, but **lock down the web surface**.
2. Install **`config/htaccess.example` → `.htaccess`** (Apache) or equivalent nginx rules (see `config/`).
3. Store secrets in **`/etc/siamtex.env`**, never under the web tree.
4. Put optional README/marketing images in **`docs/`** (tracked in git) and verify they return **403/404** over HTTP after install.
5. Prefer **`docs/screenshots/`** for any future screenshot set — never `/screenshots/` at repo root without deny rules.

### Verify web exposure after install

Replace `BASE` with the public URL (e.g. `https://YOUR_HOST/siamtex`):

```bash
# Should succeed (200)
curl -sS -o /dev/null -w "app.js %{http_code}\n" "$BASE/assets/app.js"
curl -sS -o /dev/null -w "api %{http_code}\n" "$BASE/api/auth_me.php"

# Should fail (403 or 404) — adjust paths if you add docs/screenshots/
curl -sS -o /dev/null -w "AGENTS.md %{http_code}\n" "$BASE/AGENTS.md"
curl -sS -o /dev/null -w "config %{http_code}\n" "$BASE/config/siamtex.env.example"
curl -sS -o /dev/null -w "data %{http_code}\n" "$BASE/data/"
curl -sS -o /dev/null -w "docs %{http_code}\n" "$BASE/docs/"
```

If any blocked path returns **200**, fix Apache/Nginx/`.htaccess` before handing off.

### Optional: split docroot (advanced)

For stricter separation, point DocumentRoot at a **`public/`** subtree only (not implemented in v1). Until then, **deny rules** on the full tree are required.

---

## Install workflow

Copy this checklist and mark steps as you go:

```
Deploy progress:
- [ ] 1. Prerequisites verified
- [ ] 2. Application code present
- [ ] 3. Composer dependencies installed
- [ ] 4. TeX worker image built
- [ ] 5. data/ permissions set
- [ ] 6. Environment file installed
- [ ] 7. PHP-FPM loads environment
- [ ] 8. Web server configured
- [ ] 9. .htaccess installed (Apache) — blocks non-public paths
- [ ] 10. Web exposure verified (docs/config/data return 403/404)
- [ ] 11. Smoke tests passed
- [ ] 12. OAuth configured (if requested)
```

### 1. Prerequisites

Verify on the host:

```bash
php -v          # need 8.2+
composer -V
docker --version
php -m | grep -E 'openssl|pdo_sqlite|json'
```

**Hardware:** minimum 2 vCPU, 2 GB RAM, 40 GB disk (see [SPECS.md](./SPECS.md) §6.2). Warn the human if below recommended (4 GB RAM for production).

**PHP user must run Docker:**

```bash
usermod -aG docker www-data   # adjust user to match php-fpm pool
```

### 2. Application code

```bash
git clone https://github.com/wsams/siamtex.git /var/www/html/siamtex
cd /var/www/html/siamtex
```

Or sync an existing tree; ensure `vendor/` is **not** committed — install via Composer.

### 3. Composer

```bash
composer install --no-dev --optimize-autoloader
```

### 4. TeX worker image

```bash
docker build -t siamtex-tex-worker:local docker/tex-worker
./scripts/compile-example.sh
```

Expect `PDF: …/work/main.pdf`. If this fails, **stop** — the web app cannot compile.

Set `SIAMTEX_DOCKER_IMAGE=siamtex-tex-worker:local` in env (default).

### 5. Data directory permissions

PHP creates `data/` on first request, but pre-create with correct ownership:

```bash
mkdir -p data/projects data/tmp
chown -R www-data:www-data data    # match php-fpm user
chmod 0770 data data/projects data/tmp
```

`data/` must **never** be web-accessible (see step 9 / web server samples).

### 6. Environment file

Copy template and edit **on the server only**:

```bash
install -m 640 -o root -g www-data config/siamtex.env.example /etc/siamtex.env
```

Set at minimum:

```bash
SIAMTEX_OAUTH_BASE_URL=https://YOUR_HOST/siamtex
```

For OAuth (optional):

```bash
SIAMTEX_GITHUB_CLIENT_ID=…
SIAMTEX_GITHUB_CLIENT_SECRET=…
SIAMTEX_AUTH_REQUIRED=1
```

**Callback URL for GitHub OAuth App:**

`https://YOUR_HOST/siamtex/api/auth_callback.php`

Leave client ID/secret empty for **local solo mode** (single local user, no sign-in wall).

Do **not** write secrets into the repo, `.env` in the web tree, or git.

### 7. PHP-FPM

Load `/etc/siamtex.env` via systemd drop-in — adapt PHP version:

```bash
mkdir -p /etc/systemd/system/php8.3-fpm.service.d
cp config/php-fpm-siamtex.conf.example /etc/systemd/system/php8.3-fpm.service.d/siamtex.conf
systemctl daemon-reload
systemctl restart php8.3-fpm
```

Confirm variables are visible to PHP (optional):

```bash
sudo -u www-data env -i bash -lc 'source /etc/siamtex.env; php -r "echo getenv(\"SIAMTEX_OAUTH_BASE_URL\");"'
```

### 8. Web server

Use samples in [`config/`](./config/README.md):

| Stack | Sample file |
|-------|-------------|
| Apache vhost | `config/apache-siamtex.conf.example` |
| Nginx | `config/nginx-siamtex.conf.example` |

Replace `YOUR_HOST` and paths. Reload the web server after edits.

**Apache:** enable `AllowOverride FileInfo Options AuthConfig` so `.htaccess` rules apply (see sample vhost).

**Subpath installs:** if the app lives at `/siamtex`, set `SIAMTEX_OAUTH_BASE_URL` accordingly; the app auto-detects base path from `SCRIPT_NAME` when env is unset, but OAuth requires the explicit base URL.

### 9. Apache `.htaccess` (defense in depth)

```bash
cp config/htaccess.example .htaccess
```

`.htaccess` is **gitignored** — each server keeps its own copy. Blocks HTTP access to runtime dirs, source, docs, config samples, and markdown (see **Repository vs deployment vs web exposure** above).

### 10. Verify web exposure

Run the `curl` checks in [Repository vs deployment vs web exposure](#repository-vs-deployment-vs-web-exposure). Fix deny rules before smoke tests if `AGENTS.md`, `config/`, or `docs/` are reachable.

### 11. Smoke tests

**Worker (already run in step 4):**

```bash
./scripts/compile-example.sh
```

**API health:**

```bash
curl -sS "https://YOUR_HOST/siamtex/api/auth_me.php" | head
```

Expect JSON with `authRequired`, `oauthConfigured`, etc.

**Browser (ask human if no browser automation):**

1. Open the base URL.
2. Create a project from the **homework** template.
3. Confirm PDF preview updates after edit.
4. Export zip.

### 12. GitHub OAuth (human + agent)

**Human:** create OAuth App at https://github.com/settings/developers  
**Agent:** write credentials to `/etc/siamtex.env`, restart php-fpm, verify sign-in flow.

---

## Security rules (non-negotiable)

Agents must **not**:

- Commit `.env`, `/etc/siamtex.env`, `.htaccess`, `data/`, `work/`, or `vendor/`
- Put production hostnames in tracked source files
- Copy marketing screenshots or admin-only assets into web-served paths (`assets/`, repo root, etc.)
- Leave repo-only paths (`docs/`, `config/`, `AGENTS.md`, …) reachable over HTTP after install
- Disable Docker sandbox flags (`--network=none`, memory limits, read-only root)
- Expose `data/` or `.git` over HTTP
- Log OAuth secrets or encryption keys

Agents **should**:

- Use templates in `config/*.example` only
- Prefer TLS for public deployments
- Apply and verify deny rules (`.htaccess` or nginx) for non-public paths
- Keep README/marketing images in `docs/` and confirm they are not browsable
- Report permission or ownership issues instead of `chmod 777`

See [SPECS.md](./SPECS.md) §5 (security requirements) for product-level constraints.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Compile fails immediately | Docker not in PATH for PHP user, or image missing | `usermod -aG docker www-data`; rebuild image; restart php-fpm |
| 401 on API writes | OAuth required but not signed in | Configure OAuth or clear `SIAMTEX_AUTH_REQUIRED` for solo mode |
| OAuth redirect mismatch | `SIAMTEX_OAUTH_BASE_URL` ≠ public URL | Fix env; callback must match GitHub app settings exactly |
| Permission denied on `data/` | Wrong owner | `chown www-data:www-data data` |
| 403 on mutating API | Missing CSRF header from UI | Use the web UI; custom clients need `X-SiamTeX-CSRF: 1` |
| `.htaccess` ignored | `AllowOverride None` | Update Apache Directory block per sample |
| `README.md` or `docs/` browsable | Deny rules missing or not loaded | Install `config/htaccess.example`; reload web server; re-run exposure curls |
| Screenshots accidentally in web root | Agent copied admin files into deploy path | Move to `docs/` or off-server; add deny rules; never commit private paths |

**Logs:** PHP-FPM journal, web server error log, compile output in the app’s build log panel.

---

## File reference

| Path | Purpose |
|------|---------|
| `AGENTS.md` | This runbook |
| `config/` | Sample env, Apache, Nginx, php-fpm, htaccess |
| `scripts/compile-example.sh` | Worker smoke test |
| `SPECS.md` | Product + security requirements |
| `.gitignore` | What must never be committed |
| `.cursor/skills/install-siamtex/` | Cursor agent skill (condensed workflow) |

---

## Related docs

- [README.md](./README.md) — project overview for humans
- [CONTRIBUTING.md](./CONTRIBUTING.md) — code contributions
- [config/README.md](./config/README.md) — config template index
- [SPECS.md](./SPECS.md) — full requirements
- [INSTALL_DO.md](./INSTALL_DO.md) — DigitalOcean droplet + Tailscale to home Ollama
- [docs/ai-providers.md](./docs/ai-providers.md) — OpenAI, Gemini, Grok, OpenRouter/Claude, Ollama env recipes
- [AI.md](./AI.md) — BYOK AI architecture (optional; server Ollama supported)
