# SiamTeX roadmap — competitive gaps & TODOs

The LaTeX-in-the-browser space is crowded. Hosted IDEs, desktop TeX suites, and AI writing tools all overlap with parts of SiamTeX. This document tracks **what we already do differently**, **what typical competitors offer that we still lack**, and **planned work**. Competitor product names are intentionally omitted — the comparison is by capability.

See also the marketing summary in the [README](../README.md#how-siamtex-compares).

---

## Where SiamTeX already stands out

These are uncommon or weak in many hosted LaTeX products:

| Capability | Why it matters |
|------------|----------------|
| Self-host on a small VPS | You keep the stack; no mandatory SaaS lock-in |
| AES-256-GCM encryption at rest | Sources and PDFs encrypted on disk |
| Docker-sandboxed compile (`--network=none`) | Untrusted TeX stays isolated |
| Home GPU / Ollama over Tailscale | AI without shipping documents to a third-party model by default |
| BYOK + admin AI permissions & quotas | Operators control cost and who can use AI |
| Branching per-file version history | Diff-before-restore; restore does not erase the tree |
| Multiple compile entries / PDFs per project | e.g. `main.tex` + `cover-letter.tex` |
| Solo mode without OAuth | Single-user local deploy with no sign-in wall |
| Agent-friendly install runbooks | [AGENTS.md](../AGENTS.md), [INSTALL_DO.md](../INSTALL_DO.md) |

---

## Capability matrix (us vs typical alternatives)

| Capability | SiamTeX today | Typical hosted LaTeX IDE | Typical desktop TeX suite |
|------------|---------------|--------------------------|---------------------------|
| Browser editor + live PDF | Yes | Yes | No (local GUI) |
| Self-host / own your data | Yes | Rare / paid enterprise | N/A (local files) |
| Encryption at rest (app-managed) | Yes | Varies / opaque | Local disk only |
| Sandboxed remote compile | Yes (Docker) | Yes (vendor) | Local TeX install |
| Real-time multi-cursor co-editing | [TODO #1](https://github.com/wsams/siamtex/issues/1) | Often yes | Rare |
| Share links / roles | Partial ([#2](https://github.com/wsams/siamtex/issues/2), [#3](https://github.com/wsams/siamtex/issues/3), [#4](https://github.com/wsams/siamtex/issues/4)) | Yes | Manual file share |
| Git / GitHub project sync | [TODO #15](https://github.com/wsams/siamtex/issues/15) | Often yes | External git |
| Rich template marketplace | First-party only ([#9](https://github.com/wsams/siamtex/issues/9)) | Often large catalogs | CTAN / local |
| Smart bibliography UI | [TODO #7](https://github.com/wsams/siamtex/issues/7) | Often yes | Editor-dependent |
| Native spell check | [TODO #8](https://github.com/wsams/siamtex/issues/8) | Often yes | Often yes |
| Comments / review mode | [TODO #5](https://github.com/wsams/siamtex/issues/5) | Often yes | Rare |
| Track changes | [TODO #6](https://github.com/wsams/siamtex/issues/6) | Sometimes | Rare |
| AI assist (BYOK / local model) | Yes (alpha) | Vendor AI common; BYOK/local rare | Plugins vary |
| Admin AI quotas & per-user gates | Yes | Rare | N/A |
| Multiple PDFs per project | Yes | Varies | Manual |
| Branching file history in-app | Yes | History varies | External VCS |
| Word / DOCX import | Yes ([#10](https://github.com/wsams/siamtex/issues/10)) | Sometimes | Converters |
| Object storage (S3) backend | [TODO #12](https://github.com/wsams/siamtex/issues/12) | Common at scale | N/A |
| One-command full Compose stack | Partial ([#14](https://github.com/wsams/siamtex/issues/14)) | N/A | N/A |

---

## TODO — planned / missing features

### Collaboration & sharing

| TODO | Issue |
|------|--------|
| Real-time multi-cursor co-editing | [#1](https://github.com/wsams/siamtex/issues/1) |
| Invite-by-account sharing | [#2](https://github.com/wsams/siamtex/issues/2) |
| Edit-role share links in UI | [#3](https://github.com/wsams/siamtex/issues/3) |
| Anonymous share-link viewing when auth required | [#4](https://github.com/wsams/siamtex/issues/4) |
| Comments / review mode | [#5](https://github.com/wsams/siamtex/issues/5) |
| Track changes | [#6](https://github.com/wsams/siamtex/issues/6) |

### Authoring & content

| TODO | Issue |
|------|--------|
| Smart bibliography UI (SPECS F-61) | [#7](https://github.com/wsams/siamtex/issues/7) |
| Native spell check | [#8](https://github.com/wsams/siamtex/issues/8) |
| Expanded templates / macros catalog (F-71) | [#9](https://github.com/wsams/siamtex/issues/9) |
| Format converters (F-80) | [#11](https://github.com/wsams/siamtex/issues/11) |

### Platform & ops

| TODO | Issue |
|------|--------|
| S3-compatible blob storage | [#12](https://github.com/wsams/siamtex/issues/12) |
| Soft-delete retention purge | [#13](https://github.com/wsams/siamtex/issues/13) |
| Full Docker Compose (web + db + worker) | [#14](https://github.com/wsams/siamtex/issues/14) |
| Git / GitHub project sync | [#15](https://github.com/wsams/siamtex/issues/15) |

### AI maturity

| TODO | Issue |
|------|--------|
| Graduate AI from alpha | [#16](https://github.com/wsams/siamtex/issues/16) |
| Richer import-assist (md → project; deeper docx flows) | [#17](https://github.com/wsams/siamtex/issues/17) — DOCX extract + AI convert shipped via [#10](https://github.com/wsams/siamtex/issues/10) |

---

## Related

- [SPECS.md](../SPECS.md) §2 Non-goals, §9 Phased delivery
- [features.md](./features.md) — what ships today
- [user-guide.md](./user-guide.md) — how to use it
