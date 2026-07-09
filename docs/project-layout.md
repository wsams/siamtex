# Project layout

Repository map for contributors and operators. Runtime data under `data/` is gitignored and must never be web-accessible after deploy.

| Path | Purpose |
|------|---------|
| `index.php` | App shell |
| `api/` | JSON, PDF, auth, AI, and history endpoints |
| `assets/` | Public CSS, JS, favicons |
| `src/` | PHP domain logic |
| `templates/` | Curated starter packages |
| `config/` | Sample server configs (not secrets) |
| `docker/` | TeX worker image |
| `scripts/` | Smoke tests and operator helpers |
| `docs/` | Guides, screenshots, Tailscale/AI recipes (**blocked from HTTP on deploy**) |
| `INSTALL_DO.md` | DigitalOcean install (+ optional home GPU) |
| `AGENTS.md` | Agent + operator install runbook |
| `SPECS.md` | Product & security requirements |
| `AI.md` | BYOK AI architecture |
| `data/` | SQLite, encrypted projects (**gitignored**) |

### Intentionally web-accessible after install

`index.php`, `api/*.php`, `assets/*`, `favicon.ico`.

Everything else (including `docs/`, `config/`, `src/`, `vendor/`, `AGENTS.md`) must return 403/404 — see [AGENTS.md](../AGENTS.md) § Repository vs deployment vs web exposure.
