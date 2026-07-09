# Contributing to SiamTeX

Thank you for helping improve SiamTeX — a browser-native LaTeX studio built for students, researchers, and anyone who cares about beautiful documents.

**Repository:** https://github.com/wsams/siamtex

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce, expected vs. actual behavior, and browser/PHP version if relevant.
- **Feature ideas** — check [SPECS.md](./SPECS.md) and [docs/roadmap.md](./docs/roadmap.md) first; open a discussion or issue describing the use case (especially for academic workflows). Many gaps already have issues linked from the roadmap.
- **Pull requests** — fix bugs, improve templates, tighten security, or polish UX. Keep changes focused.

## Before you start

1. Read [SPECS.md](./SPECS.md) for product direction and security requirements.
2. Self-host with [AGENTS.md](./AGENTS.md) (agent runbook) and [config/](./config/README.md) samples.
3. Never commit secrets, user data, or anything under `data/` or `work/`.

## Development setup

```bash
git clone https://github.com/wsams/siamtex.git
cd siamtex
composer install
docker build -t siamtex-tex-worker:local docker/tex-worker
./scripts/compile-example.sh
```

Run without OAuth for solo mode — leave `SIAMTEX_GITHUB_CLIENT_ID` and `SIAMTEX_GITHUB_CLIENT_SECRET` empty.

## Pull request guidelines

- **One logical change per PR** when possible (easier review).
- **Match existing style** — PSR-4 PHP, minimal comments, no unrelated refactors.
- **Security first** — compile jobs stay sandboxed; no secrets in repo; validate uploads and paths.
- **Document behavior** — update [docs/features.md](./docs/features.md), [docs/user-guide.md](./docs/user-guide.md), or SPECS if you change user-facing or operator-facing behavior; keep the README as the short marketing overview.
- **Test manually** — create a project, edit, compile, export zip, and (if OAuth is configured) sign in.

## What we will not merge

- Committed `.env`, keys, SQLite databases, or encrypted project blobs
- Hard-coded production URLs or personal identifiers
- Changes that weaken compile sandboxing (network on worker, root in container, etc.)
- Large drive-by formatting or dependency upgrades without a clear benefit

## Templates & academic content

Template improvements (homework, article, resume) are welcome. Keep placeholder text generic (“Your Name”, “Paper Title”) and suitable for public distribution.

## Code of conduct

Be respectful and constructive. We want SiamTeX to be welcoming to first-time LaTeX users and experienced TeX authors alike.

## Questions?

Open an issue on GitHub with the **question** label, or describe your academic use case — that context helps us prioritize.
