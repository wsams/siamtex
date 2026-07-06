# Install SiamTeX on DigitalOcean (+ home GPU via Tailscale)

This guide is for a **production-style setup** that many self-hosters use:

| Machine | Role | Needs a GPU? |
|---------|------|----------------|
| **DigitalOcean droplet** | Public HTTPS, LaTeX compiles (Docker), encrypted storage | **No** |
| **Home PC / NAS** | Ollama with your models | **Yes** (or fast CPU) |

The droplet stays small and cheap (~**$6–12/mo**). **AI inference can run at home** (Tailscale + Ollama) or via a **cloud API** — see [docs/ai-providers.md](./docs/ai-providers.md).

**Repository:** https://github.com/wsams/siamtex

For generic installs (university server, Nginx, no AI), see [AGENTS.md](./AGENTS.md).

---

## What you get

- Browser LaTeX studio with live PDF preview and compile diagnostics
- **Multiple PDFs** — compile each top-level `.tex` separately (e.g. resume `main.tex` + `cover-letter.tex`)
- **AI chat** (Q&A, `@file` context, Markdown code blocks) · **AI assist** · **AI fix problems** · **create project from prompt** *(alpha; quality depends on your model)*
- **Per-user AI permissions** — off by default; operators set `SIAMTEX_ADMIN_GITHUB_LOGINS` and use **AI access** to enable features
- **Version history** — branching undo tree per file, diff before restore
- AES-256-GCM encryption at rest · optional GitHub OAuth · share links

---

## 0. Before you start

You do **not** need everything on day one, but this is the full picture:

| Prerequisite | Required? | Notes |
|--------------|-----------|--------|
| [DigitalOcean](https://www.digitalocean.com/) account | Yes | Or any Ubuntu VPS — this guide uses DO terminology |
| **SSH key** on your laptop | Strongly recommended | Add public key when creating the droplet |
| **Domain name** | Recommended | For HTTPS and GitHub OAuth; **registrar can be anywhere** (Namecheap, Porkbun, Google Domains, Cloudflare, …) |
| DNS pointed at droplet | Before TLS | A record → droplet public IP (§2) |
| GitHub account | If using OAuth | Optional — solo mode works without it |
| Home GPU + Tailscale | Only for Path A AI | Optional — use cloud AI instead (§8) |

**Stack this guide installs on the droplet:**

| Piece | Role |
|-------|------|
| **Apache 2** | Serves `index.php`, `api/`, `assets/` |
| **PHP 8.3-FPM** | Runs app logic; must read `/etc/siamtex.env` and invoke Docker |
| **Docker** | Sandboxed `latexmk` compiles (no host TeX install) |
| **Composer** | PHP dependencies (`vendor/`) |
| **Certbot** | Free TLS certificate from Let’s Encrypt (needs a real domain) |

**URL shapes:** examples use `https://YOUR_DOMAIN/siamtex` (app in a **subpath**). You can also serve at the vhost root (`https://latex.example.edu/`) — adjust `DocumentRoot`, `SIAMTEX_OAUTH_BASE_URL`, and Apache aliases accordingly.

**Agents:** ask the human for domain registrar, whether OAuth is wanted, and AI path (Ollama vs cloud) before writing secrets.

---

## 1. Create the droplet

In the DigitalOcean control panel → **Droplets → Create**:

| Setting | Value |
|---------|--------|
| Image | **Ubuntu 24.04 LTS** |
| Size | **2 GB RAM / 1 vCPU** minimum; **4 GB** if many concurrent users |
| Disk | **40 GB+** (Docker TeX image is large) |
| Region | Closest to you and your readers |
| Authentication | **SSH key** (not password-only) |

After create, note the droplet’s **public IPv4** (e.g. `143.198.x.x`). You will use it for DNS and SSH:

```bash
ssh root@YOUR_DROPLET_IP
```

---

## 2. Domain & DNS

Your domain does **not** need to come from DigitalOcean. Common setups:

| Registrar / DNS host | What to do |
|---------------------|------------|
| **Namecheap**, Porkbun, GoDaddy, etc. | Advanced DNS → **A record**: host `@` (and optionally `www`) → droplet IP |
| **DigitalOcean Networking** | Add domain → create **A record** → assign droplet |
| **Cloudflare** | DNS only (orange cloud off for first certbot run is simplest) → A record → droplet IP |

Example (apex domain `latex.example.com` → `203.0.113.50`):

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | `@` | `203.0.113.50` | 300 |
| A | `www` | `203.0.113.50` | optional |

Wait for DNS to propagate (minutes to a few hours). Check:

```bash
dig +short latex.example.com A
# or: host latex.example.com
```

**Without a domain:** you can still install and test over `http://DROPLET_IP/siamtex`, but Let’s Encrypt will not issue a cert for a bare IP, and GitHub OAuth needs a stable HTTPS URL. For production, use a domain.

Set `YOUR_DOMAIN` in the rest of this guide to the hostname users will type (e.g. `latex.example.com`).

---

## 3. Initial server setup (PHP, Apache, Docker)

SSH in as `root` (or sudo). Install the **LAMP-ish** base — Apache + PHP-FPM + Docker:

```bash
apt update && apt upgrade -y
apt install -y git curl ca-certificates apache2 \
  php8.3 php8.3-fpm php8.3-cli php8.3-sqlite3 php8.3-curl php8.3-mbstring php8.3-xml \
  composer docker.io
systemctl enable --now docker apache2 php8.3-fpm
usermod -aG docker www-data
```

**Why `www-data` in the `docker` group:** compile requests run `docker run` as the PHP-FPM user. Without this, compiles fail with “permission denied”.

Verify PHP extensions:

```bash
php -m | grep -E 'openssl|pdo_sqlite|json|mbstring'
php -v   # expect 8.2+
```

Clone SiamTeX and install PHP deps:

```bash
mkdir -p /var/www/html
git clone https://github.com/wsams/siamtex.git /var/www/html/siamtex
cd /var/www/html/siamtex
composer install --no-dev --optimize-autoloader
```

Build the TeX worker and smoke-test compiles:

```bash
docker build -t siamtex-tex-worker:local docker/tex-worker
./scripts/compile-example.sh
```

Expect `PDF: …/work/main.pdf`. If this fails, fix Docker before continuing.

---

## 4. Data directory and permissions

```bash
mkdir -p /var/www/html/siamtex/data/projects /var/www/html/siamtex/data/tmp
chown -R www-data:www-data /var/www/html/siamtex/data
chmod 0770 /var/www/html/siamtex/data /var/www/html/siamtex/data/projects /var/www/html/siamtex/data/tmp
```

`data/` holds SQLite and encrypted project blobs — it must **not** be web-accessible (Apache deny rules in §6).

---

## 5. Environment file (`/etc/siamtex.env`)

Secrets and site URL live **outside** the git tree:

```bash
install -m 640 -o root -g www-data config/siamtex.env.example /etc/siamtex.env
nano /etc/siamtex.env
```

Set at minimum (use your real domain once DNS works):

```bash
SIAMTEX_OAUTH_BASE_URL=https://YOUR_DOMAIN/siamtex
```

**GitHub OAuth (optional):** create an app at https://github.com/settings/developers with callback:

`https://YOUR_DOMAIN/siamtex/api/auth_callback.php`

Set `SIAMTEX_GITHUB_CLIENT_ID` and `SIAMTEX_GITHUB_CLIENT_SECRET`. Leave both empty for **solo mode** (single local user, no sign-in wall).

**AI:** configure later (§8) or see [docs/ai-providers.md](./docs/ai-providers.md).

### Load env into PHP-FPM

PHP-FPM does not read `/etc/siamtex.env` automatically. Install the systemd drop-in:

```bash
mkdir -p /etc/systemd/system/php8.3-fpm.service.d
cp config/php-fpm-siamtex.conf.example /etc/systemd/system/php8.3-fpm.service.d/siamtex.conf
systemctl daemon-reload
systemctl restart php8.3-fpm
```

Confirm variables reach PHP (optional):

```bash
sudo -u www-data env -i bash -lc 'source /etc/siamtex.env; php -r "echo getenv(\"SIAMTEX_OAUTH_BASE_URL\");"'
```

Restart `php8.3-fpm` after **every** edit to `/etc/siamtex.env`.

---

## 6. Apache, PHP-FPM, and TLS (Certbot)

### 6a. Apache virtual host

Copy and edit the sample vhost — set `ServerName YOUR_DOMAIN` and `DocumentRoot`:

```bash
cp config/apache-siamtex.conf.example /etc/apache2/sites-available/siamtex.conf
nano /etc/apache2/sites-available/siamtex.conf
```

Defense in depth — install `.htaccess` deny rules (blocks `data/`, `docs/`, source from HTTP):

```bash
cp config/htaccess.example /var/www/html/siamtex/.htaccess
```

Enable site and modules:

```bash
a2enmod rewrite ssl headers proxy_fcgi setenvif
a2enconf php8.3-fpm
a2ensite siamtex
a2dissite 000-default 2>/dev/null || true
apachectl configtest && systemctl reload apache2
```

At this point `http://YOUR_DOMAIN/siamtex` may work over plain HTTP. Proceed to TLS before sharing widely.

### 6b. Let’s Encrypt (Certbot)

Requires **DNS already pointing** at this droplet (§2).

```bash
apt install -y certbot python3-certbot-apache
certbot --apache -d YOUR_DOMAIN
# add -d www.YOUR_DOMAIN if you use www
```

Certbot edits the Apache vhost for HTTPS and sets up auto-renewal. Test renewal:

```bash
certbot renew --dry-run
```

Update `/etc/siamtex.env` so `SIAMTEX_OAUTH_BASE_URL` matches the **exact** URL users see (`https://`, correct host, `/siamtex` path). Then:

```bash
systemctl restart php8.3-fpm
```

**OAuth note:** the GitHub callback URL must match character-for-character.

---

## 7. Verify web exposure

Replace `BASE` with your public URL:

```bash
BASE=https://YOUR_DOMAIN/siamtex
curl -sS -o /dev/null -w "app.js %{http_code}\n" "$BASE/assets/app.js"
curl -sS -o /dev/null -w "api %{http_code}\n" "$BASE/api/auth_me.php"
curl -sS -o /dev/null -w "AGENTS.md %{http_code}\n" "$BASE/AGENTS.md"    # expect 403 or 404
curl -sS -o /dev/null -w "data %{http_code}\n" "$BASE/data/"              # expect 403 or 404
```

---

## 8. Optional: enable AI

You do **not** need a GPU on the droplet. Pick **one** path:

| Path | When to use | Doc |
|------|-------------|-----|
| **A. Home Ollama over Tailscale** | GPU/desktop at home | §8a–8d below |
| **B. Cloud API** | OpenAI, Gemini, Grok, OpenRouter | [docs/ai-providers.md](./docs/ai-providers.md) |

AI features are **alpha / experimental** — quality depends on your model.

**Multi-user hosts:** set `SIAMTEX_ADMIN_GITHUB_LOGINS` in `/etc/siamtex.env` (your GitHub username), restart php-fpm, run `php scripts/sync-ai-admins.php`, then sign in and use **AI access** to enable features for other users. New accounts start with all AI off.

### Path A — Tailscale + home Ollama

### 8a. Droplet joins Tailscale

```bash
cd /var/www/html/siamtex
sudo bash scripts/setup-tailscale-droplet.sh
```

### 8b. Home machine joins Tailscale

See [docs/tailscale-ollama.md](./docs/tailscale-ollama.md) for Ollama bind and ACL hardening.

### 8c. Test from droplet

```bash
curl -sS http://home-ollama:11434/api/tags
```

### 8d. Enable SiamTeX AI

```bash
sudo /var/www/html/siamtex/scripts/configure-ai-ollama.sh
sudo systemctl restart php8.3-fpm
```

**Streaming:** AI assist uses `api/ai_stream.php` (SSE). Ensure PHP **curl** is installed (`php8.3-curl`). On **Nginx**, use the sample vhost’s `ai_stream.php` location (`fastcgi_buffering off`, `fastcgi_read_timeout` ≥ `SIAMTEX_AI_TIMEOUT`, default 120s). Single-file edits stream live LaTeX; project-wide, fix-problems, and create-project show status/char counts while the model returns JSON. **AI chat** streams Markdown (rendered with copyable code blocks in the UI).

### Path B — Cloud provider (no Tailscale)

1. Complete §§1–7.
2. Apply a provider block from [docs/ai-providers.md](./docs/ai-providers.md) to `/etc/siamtex.env`.
3. `sudo systemctl restart php8.3-fpm`
4. **AI → Test connection** in the app.

---

## 9. Smoke test in the browser

1. Open `https://YOUR_DOMAIN/siamtex`
2. Create a project from the **homework** template
3. Edit and **Compile** — PDF should update
4. *(Resume projects)* add `cover-letter.tex` at project root, open it, **Compile** — preview label should show `cover-letter.tex` and a separate PDF
5. **History** — confirm version timeline after a save
6. **AI** (if enabled for your account) → Test connection → single-file instruction → confirm **live output** → Accept
7. **Chat** (if enabled) → ask a LaTeX question; confirm fenced ` ```latex ` blocks render as styled samples with **Copy**, not raw backticks
8. *(Operators)* **AI access** — confirm admin can toggle AI features for other users

---

## 10. Costs and hardware notes

| Component | Typical cost |
|-----------|----------------|
| DO droplet 2 GB | ~$12/mo (varies by region) |
| Domain | ~$10–15/yr (any registrar) |
| Tailscale | Free for personal use |
| Ollama at home | Electricity + hardware you own |
| Cloud AI APIs | Optional — [docs/ai-providers.md](./docs/ai-providers.md) |

**Do not** port-forward Ollama (`:11434`) on your home router to the internet.

---

## 11. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `dig` does not show droplet IP | Fix DNS at registrar; wait for TTL |
| Certbot fails | DNS must resolve to this server; port 80 open; try `certbot --apache -d YOUR_DOMAIN` again |
| Blank page / 500 | `journalctl -u php8.3-fpm -n 50`; check Apache error log |
| Compile fails immediately | `usermod -aG docker www-data`; rebuild TeX image; restart php-fpm |
| Env vars empty in app | PHP-FPM drop-in installed? `systemctl restart php8.3-fpm` after editing `/etc/siamtex.env` |
| AI “could not reach provider” | Tailscale / API key / base URL — [docs/ai-providers.md](./docs/ai-providers.md) |
| AI progress frozen until the end | Nginx buffering or short `fastcgi_read_timeout` | Apply `config/nginx-siamtex.conf.example` `ai_stream.php` block; timeout ≥ `SIAMTEX_AI_TIMEOUT`; restart nginx + php-fpm |
| OAuth redirect mismatch | `SIAMTEX_OAUTH_BASE_URL` must match browser URL exactly |

Logs: `journalctl -u php8.3-fpm`, `/var/log/apache2/siamtex-error.log`, in-app **Build log** panel.

---

## Related

- [AGENTS.md](./AGENTS.md) — full agent-oriented install runbook (any Linux host)
- [docs/ai-providers.md](./docs/ai-providers.md) — OpenAI, Gemini, Grok, OpenRouter, Ollama
- [docs/tailscale-ollama.md](./docs/tailscale-ollama.md) — ACL examples, security notes
- [config/README.md](./config/README.md) — config template index
- [SPECS.md](./SPECS.md) — product requirements and security model
