# AGENTS.md — Deploying SiamTeX

This document is the **operator and AI-agent runbook** for installing SiamTeX on a server. Human administrators should point coding agents here; agents should treat this file as the source of truth for deployment.

**Repository:** https://github.com/wsams/siamtex

---

## How to use an agent to install SiamTeX

Give your agent **SSH or shell access** to the target server (or a staging VM with the same OS stack), then paste a prompt like:

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
| `/etc/siamtex.env` | OAuth + optional keys — **never in git** |

Compiles: PHP decrypts → temp dir → `docker run --network=none … latexmk` → encrypt PDF → wipe plaintext.

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
- [ ] 9. .htaccess installed (Apache)
- [ ] 10. Smoke tests passed
- [ ] 11. OAuth configured (if requested)
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

`.htaccess` is **gitignored** — each server keeps its own copy. Blocks HTTP access to `data/`, `vendor/`, `work/`, dotfiles, and sensitive extensions.

### 10. Smoke tests

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

### 11. GitHub OAuth (human + agent)

**Human:** create OAuth App at https://github.com/settings/developers  
**Agent:** write credentials to `/etc/siamtex.env`, restart php-fpm, verify sign-in flow.

---

## Security rules (non-negotiable)

Agents must **not**:

- Commit `.env`, `/etc/siamtex.env`, `.htaccess`, `data/`, `work/`, or `vendor/`
- Put production hostnames in tracked source files
- Disable Docker sandbox flags (`--network=none`, memory limits, read-only root)
- Expose `data/` or `.git` over HTTP
- Log OAuth secrets or encryption keys

Agents **should**:

- Use templates in `config/*.example` only
- Prefer TLS for public deployments
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
- [AI.md](./AI.md) — future BYOK AI integration (not required for install)
