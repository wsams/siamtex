# Deployment configuration samples

These files are **templates only**. Copy them to your server and edit paths, hostnames, and secrets. Do not commit real credentials or production URLs into git.

**AI agents:** follow [AGENTS.md](../AGENTS.md) end-to-end. This directory supplies the files referenced in that runbook.

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
6. **Permissions** — `data/` must be writable by the PHP-FPM user and must **not** be web-accessible.
7. **Apache `.htaccess`** (optional defense in depth):

   ```bash
   cp config/htaccess.example .htaccess
   ```

   Enable `AllowOverride` in your virtual host (see `apache-siamtex.conf.example`). `.htaccess` is gitignored so each server keeps its own copy.

## Files

| Sample | Purpose |
|--------|---------|
| `siamtex.env.example` | OAuth, encryption keys, Docker image name |
| `htaccess.example` | Copy to `.htaccess` in the web root |
| `apache-siamtex.conf.example` | Virtual host, deny sensitive paths |
| `nginx-siamtex.conf.example` | Server block for PHP-FPM |
| `php-fpm-siamtex.conf.example` | systemd drop-in to load `/etc/siamtex.env` |

## GitHub OAuth (optional)

Create a [GitHub OAuth App](https://github.com/settings/developers) with callback:

`https://YOUR_HOST/siamtex/api/auth_callback.php`

Set `SIAMTEX_OAUTH_BASE_URL` to the public base URL (no trailing slash). Until OAuth is configured, SiamTeX runs in **local mode** (single local user, no sign-in wall).

## Hardware

Plan for **2 GB+ RAM** and **40 GB+ disk** if you expect regular compiles (TeX Live in Docker is sizable). See [SPECS.md](../SPECS.md) §6.2.
