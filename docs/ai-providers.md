# AI provider setup (for operators and install agents)

> **Alpha / experimental.** SiamTeX AI features are not production-grade. Results vary widely by model — a small local quantised model may hallucinate or return invalid JSON; cloud APIs are generally more reliable but still require human review. Tell operators to **always preview before Accept**.

SiamTeX optional AI features call a **Chat Completions** HTTP API (`POST …/chat/completions`). The PHP app proxies requests server-side — browsers never talk to the model host directly.

| Feature | UI | Writes project files? | Permission flag |
|---------|-----|----------------------|-----------------|
| **AI chat** | Slide-out **Chat** panel | No — Q&A only; suggests copy-paste LaTeX | `chat` |
| **AI assist** | Project **AI** drawer | Yes — after user **Accept** | `assist` |
| **AI fix problems** | Problems → **AI fix problems** | Yes — after **Accept** | `fixErrors` |
| **Create project** | Dashboard AI prompt | Creates new project on accept | `createProject` |
| **BYOK / settings** | AI settings API / future UI | Stores encrypted user provider config | `settings` |

**Two configuration layers:**

| Layer | Where | Who pays / hosts |
|-------|--------|------------------|
| **Server defaults** | `/etc/siamtex.env` (`SIAMTEX_AI_*`) | Operator sets one provider for all users |
| **Per-user BYOK** | `PUT /api/ai_settings.php` (encrypted in SQLite) | Each user brings their own key/endpoint |

Server env is enough for solo or small teams. Multi-user hosts often set `SIAMTEX_AI_ENABLED=0` and let users configure BYOK — or set a shared server key only if you accept the cost/risk.

**Never commit API keys** to git. Write secrets only to `/etc/siamtex.env` or per-user settings via the API.

---

## Agent workflow

1. **Ask the human** which AI path they want (see table below). Do not assume Ollama.
2. Install SiamTeX core first (compile worker, OAuth, web hardening) — [AGENTS.md](../AGENTS.md) or [INSTALL_DO.md](../INSTALL_DO.md).
3. Apply the matching **provider block** to `/etc/siamtex.env` (or document BYOK for per-user keys).
4. `systemctl restart php8.3-fpm` after env changes.
5. **Verify:** signed-in user → project → **AI → Test connection**; or from shell:

   ```bash
   # After auth cookie / solo mode — or test Ollama reachability directly:
   curl -sS http://home-ollama:11434/api/tags   # Ollama only
   ```

6. Report in deployment summary: provider name, base URL host (not the key), model id, timeout.

### Inputs to collect

| Question | Why |
|----------|-----|
| AI needed? (yes / no / later) | Skip § entirely if no |
| **Provider** | Ollama home, OpenAI, Gemini, Grok, OpenRouter, other OpenAI-compatible |
| **Who supplies the API key?** | Server env vs each user (BYOK) |
| Model name | Provider-specific string |
| Expected project size | Large projects need higher `SIAMTEX_AI_MAX_CONTEXT_CHARS` / `SIAMTEX_AI_MAX_TOKENS` |

---

## Supported providers (today)

SiamTeX ships an **OpenAI-compatible client** only. Providers with a native different API need a **gateway** (OpenRouter, LiteLLM) unless listed below.

| Provider | `SIAMTEX_AI_PROVIDER` | Base URL | API key | Notes |
|----------|----------------------|----------|---------|--------|
| **Ollama** (self-hosted) | `ollama` | `http://HOST:11434/v1` | Usually empty | Use Tailscale hostname (e.g. `http://home-ollama:11434/v1`). See [tailscale-ollama.md](./tailscale-ollama.md). |
| **OpenAI** | `openai` | `https://api.openai.com/v1` | Required | GPT-4.1 mini, o4-mini, etc. |
| **Google Gemini** | `google` | `https://generativelanguage.googleapis.com/v1beta/openai` | Required | [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| **xAI (Grok)** | `xai` | `https://api.x.ai/v1` | Required | OpenAI-compatible |
| **OpenRouter** | `openrouter` | `https://openrouter.ai/api/v1` | Required | One key → many models (Claude, Llama, …) |
| **Other** | `openai_compatible` | Gateway URL + `/v1` | Usually required | Together, Groq, Fireworks, local LiteLLM, etc. |

### Anthropic (Claude) — use a gateway

Anthropic’s **native** API is `/v1/messages`, not Chat Completions. SiamTeX does **not** call it directly yet.

**Recommended for agents:**

- **OpenRouter** — model e.g. `anthropic/claude-3.5-haiku`, base `https://openrouter.ai/api/v1`
- Or self-hosted **LiteLLM** proxy exposing `/v1/chat/completions` → Anthropic

Tell the human: “Claude via OpenRouter/LiteLLM,” not `api.anthropic.com` directly.

---

## Environment variables

All go in `/etc/siamtex.env` (mode `640`, root:www-data). Loaded by PHP-FPM — restart after edits.

| Variable | Required | Description |
|----------|----------|-------------|
| `SIAMTEX_AI_ENABLED` | Yes for AI | `1` / `0` |
| `SIAMTEX_AI_PROVIDER` | Yes | `ollama`, `openai`, `google`, `xai`, `openrouter`, `openai_compatible` |
| `SIAMTEX_AI_BASE_URL` | Yes | OpenAI-compatible base, **no trailing slash** |
| `SIAMTEX_AI_MODEL` | Yes | Provider model id |
| `SIAMTEX_AI_API_KEY` | Cloud providers | Bearer token; empty for local Ollama without auth |
| `SIAMTEX_AI_MAX_TOKENS` | Optional | Default `16384` — raise for big multi-file fixes |
| `SIAMTEX_AI_TIMEOUT` | Optional | Default `180` seconds |
| `SIAMTEX_AI_MAX_CONTEXT_CHARS` | Optional | Default `200000` |
| `SIAMTEX_AI_MAX_CALLS_PER_HOUR` | Optional | Per-user rate limit (default `20`) |
| `SIAMTEX_ADMIN_GITHUB_LOGINS` | Optional | Comma-separated GitHub usernames with **full AI access** and **AI access** admin UI to enable features for others |

After setting admins, run `php scripts/sync-ai-admins.php` from the app root (or have each admin sign in once). **New users have all AI features disabled** until an admin enables them in **AI access**. Optional **per-user token quotas** (blank = unlimited) are set in the same panel; usage is shown per user and site-wide.

Copy-paste blocks are in [config/siamtex.env.example](../config/siamtex.env.example).

---

## Provider recipes (server env)

Replace secrets with values from the human. **Do not commit these lines.**

### Ollama over Tailscale (home GPU)

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=ollama
SIAMTEX_AI_BASE_URL=http://home-ollama:11434/v1
SIAMTEX_AI_MODEL=qwythos:9b
SIAMTEX_AI_TIMEOUT=180
SIAMTEX_AI_MAX_TOKENS=16384
SIAMTEX_AI_MAX_CONTEXT_CHARS=200000
```

Full network setup: [INSTALL_DO.md](../INSTALL_DO.md) §7 · [tailscale-ollama.md](./tailscale-ollama.md)  
Helper script: `sudo ./scripts/configure-ai-ollama.sh`

### OpenAI

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=openai
SIAMTEX_AI_BASE_URL=https://api.openai.com/v1
SIAMTEX_AI_MODEL=gpt-4.1-mini
SIAMTEX_AI_API_KEY=sk-...
SIAMTEX_AI_TIMEOUT=120
SIAMTEX_AI_MAX_TOKENS=16384
```

Create keys: https://platform.openai.com/api-keys  
Cost-conscious default: `gpt-4.1-mini` or `gpt-4o-mini` for LaTeX edits.

### Google Gemini

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=google
SIAMTEX_AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
SIAMTEX_AI_MODEL=gemini-2.0-flash
SIAMTEX_AI_API_KEY=...
SIAMTEX_AI_TIMEOUT=120
SIAMTEX_AI_MAX_TOKENS=16384
```

Create keys: https://aistudio.google.com/apikey  
Use current model ids from Google’s docs (e.g. `gemini-2.0-flash`, `gemini-2.5-pro`).

### xAI (Grok)

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=xai
SIAMTEX_AI_BASE_URL=https://api.x.ai/v1
SIAMTEX_AI_MODEL=grok-3-mini
SIAMTEX_AI_API_KEY=xai-...
SIAMTEX_AI_TIMEOUT=120
SIAMTEX_AI_MAX_TOKENS=16384
```

Keys: https://console.x.ai/

### OpenRouter (Claude, Llama, many others)

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=openrouter
SIAMTEX_AI_BASE_URL=https://openrouter.ai/api/v1
SIAMTEX_AI_MODEL=anthropic/claude-3.5-haiku
SIAMTEX_AI_API_KEY=sk-or-...
SIAMTEX_AI_TIMEOUT=180
SIAMTEX_AI_MAX_TOKENS=16384
```

Browse models: https://openrouter.ai/models  
**Use this path when the human asks for Anthropic/Claude** without running your own proxy.

Optional OpenRouter headers (HTTP-Referer, X-Title) are not set by SiamTeX today; add via a reverse proxy if OpenRouter requires them for your account tier.

### Generic OpenAI-compatible (Groq, Together, Fireworks, LiteLLM, …)

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_PROVIDER=openai_compatible
SIAMTEX_AI_BASE_URL=https://api.groq.com/openai/v1
SIAMTEX_AI_MODEL=llama-3.3-70b-versatile
SIAMTEX_AI_API_KEY=gsk_...
SIAMTEX_AI_TIMEOUT=120
```

Confirm the vendor’s **OpenAI-compatible base URL** in their docs (must end at `/v1`).

---

## Per-user BYOK (optional)

When the server leaves `SIAMTEX_AI_BASE_URL` empty or the human wants individual keys:

1. Enable AI on the server (`SIAMTEX_AI_ENABLED=1` or per-user row).
2. User calls `PUT /api/ai_settings.php` with JSON:

   ```json
   {
     "provider": "openai",
     "baseUrl": "https://api.openai.com/v1",
     "model": "gpt-4.1-mini",
     "apiKey": "sk-...",
     "enabled": true
   }
   ```

Keys are encrypted at rest with the app master key. The UI may not expose a settings page yet — API is available for integrators.

---

## Security notes (agents must follow)

- **UrlGuard** blocks AI base URLs that resolve to loopback, RFC1918, or link-local — **except** Tailscale `100.64.0.0/10` for home Ollama.
- Cloud URLs (`api.openai.com`, etc.) are allowed.
- Do not expose Ollama on `0.0.0.0` to the public internet.
- Do not log `SIAMTEX_AI_API_KEY` or paste keys into git, README, or deployment tickets.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| AI disabled in UI | `SIAMTEX_AI_ENABLED=0` or empty base/model | Set env; restart php-fpm |
| Could not reach provider | Network, wrong URL, Tailscale down | `curl` base URL from droplet |
| Empty / invalid JSON response | Reasoning model without Ollama `format:json` | Use `SIAMTEX_AI_PROVIDER=ollama` (auto), or try OpenAI/Gemini |
| Timeout | Slow home GPU or huge project | Raise `SIAMTEX_AI_TIMEOUT`; smaller scope |
| HTTP 401 | Bad or missing API key | Rotate key in env |
| User sees no Chat / AI buttons | Permissions off by default | Admin enables features in **AI access**; or add login to `SIAMTEX_ADMIN_GITHUB_LOGINS` |
| Admin has no **AI access** menu | Not in `SIAMTEX_ADMIN_GITHUB_LOGINS` or DB not synced | Set env; `php scripts/sync-ai-admins.php`; sign in again |
| AI token quota reached | User at or over per-user cap | Raise quota in **AI access** or leave blank for unlimited |

---

## Related

- [AI.md](../AI.md) — product architecture and BYOK principles
- [INSTALL_DO.md](../INSTALL_DO.md) — DigitalOcean + optional Tailscale Ollama
- [AGENTS.md](../AGENTS.md) — full install runbook
- [config/siamtex.env.example](../config/siamtex.env.example) — commented provider blocks
