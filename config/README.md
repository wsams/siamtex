# Deployment configuration samples

These files are **templates only**. Copy them to your server and edit paths, hostnames, and secrets. Do not commit real credentials or production URLs into git.

**AI agents:** follow [AGENTS.md](../AGENTS.md) end-to-end — especially **Repository vs deployment vs web exposure** (do not treat the whole clone as public HTTP content). This directory supplies the files referenced in that runbook.

## Quick checklist

1. **Web root** — point Apache or Nginx at the SiamTeX directory (where `index.php` lives).
2. **Environment** — copy `siamtex.env.example` to `/etc/siamtex.env` (mode `640`, root-owned).
3. **PHP-FPM** — load that env file via a systemd drop-in (see `php-fpm-siamtex.conf.example`).
4. **Docker** — build the TeX worker and add the PHP user to the `docker` group:

   ```bash
   docker build -t siamtex-tex-worker:local docker/tex-worker
   usermod -aG docker www-data   # or your php-fpm user
   ```

5. **Composer** — from the app root: `composer install --no-dev --optimize-autoloader`
6. **PHP curl** — required for AI streaming: `php -m | grep curl` (install `php8.3-curl` if missing)
7. **Permissions** — `data/` must be writable by the PHP-FPM user and must **not** be web-accessible.
8. **Apache `.htaccess`** (optional defense in depth):

   ```bash
   cp config/htaccess.example .htaccess
   ```

   Enable `AllowOverride` in your virtual host (see `apache-siamtex.conf.example`). `.htaccess` is gitignored so each server keeps its own copy.

## Files

| Sample | Purpose |
|--------|---------|
| `siamtex.env.example` | OAuth, encryption keys, Docker image, AI provider blocks, `SIAMTEX_ADMIN_GITHUB_LOGINS` |
| `htaccess.example` | Copy to `.htaccess` in the web root |
| `apache-siamtex.conf.example` | Virtual host, deny sensitive paths |
| `nginx-siamtex.conf.example` | Server block for PHP-FPM; includes `ai_stream.php` SSE tuning (`fastcgi_buffering off`) |
| `php-fpm-siamtex.conf.example` | systemd drop-in to load `/etc/siamtex.env` |
| `php-uploads-siamtex.ini.example` | PHP-FPM `upload_max_filesize` / `post_max_size` (≥ app 5 MB limit) |

## GitHub OAuth (optional)

Create a [GitHub OAuth App](https://github.com/settings/developers) with callback:

`https://YOUR_HOST/siamtex/api/auth_callback.php`

Set `SIAMTEX_OAUTH_BASE_URL` to the public base URL (no trailing slash). Until OAuth is configured, SiamTeX runs in **local mode** (single local user, no sign-in wall).

## Hardware

Plan for **2 GB+ RAM** and **40 GB+ disk** if you expect regular compiles (TeX Live in Docker is sizable). See [SPECS.md](../SPECS.md) §6.2.

**AI inference** does not run on the droplet by default. Provider recipes: [docs/ai-providers.md](../docs/ai-providers.md). **AI features are alpha/experimental** — accuracy depends on the chosen model. On multi-user hosts, set **`SIAMTEX_ADMIN_GITHUB_LOGINS`** so operators can enable per-user AI (chat, assist, fix errors, create project, BYOK) via the **AI access** admin UI; run `php scripts/sync-ai-admins.php` after env changes.

**Compile model:** each **top-level** `.tex` in a project (no `/` in the path) may produce its own PDF; see [SPECS.md](../SPECS.md) F-35–F-36.
