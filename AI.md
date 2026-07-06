# SiamTeX — AI integration plan

This document describes how to add **optional, user-controlled AI** to SiamTeX so people can improve resumes and other documents without the server paying for everyone’s tokens.

**Primary use case:** upload Word / text / older LaTeX (or paste notes), then ask the model to **fill or update** the current project files (especially resume packages).

**Design principle:** SiamTeX does **not** ship a single shared paid API key for all users. Each person connects **their own** endpoint and credentials (**BYOK** — bring your own key), or a **local/self-hosted** model (Ollama, etc.). The app stores only what is needed to call *their* provider, encrypted at rest.

**Operational setup (install agents):** [docs/ai-providers.md](./docs/ai-providers.md) — copy-paste env recipes for OpenAI, Gemini, Grok, OpenRouter (Claude), and Ollama.

> **Status: alpha / experimental.** AI assist and fix-problems are useful for drafts and debugging hints, not guaranteed correct LaTeX. Quality depends on the model, prompt size, and provider. Users must review every suggestion before it touches their project.

---

## 1. Goals

| Goal | Notes |
|------|--------|
| Resume assist | “Turn this job history into `experience.tex`” / “Update my summary for DevOps” |
| Import assist | Accept `.txt`, `.md`, `.tex`, and `.docx` (Word); extract text; propose LaTeX edits |
| Multi-file awareness | Resume templates are packages (`main.tex`, `header.tex`, …); AI should update the right files |
| Provider choice | User picks Ollama, OpenAI, Anthropic, xAI/Grok, OpenAI-compatible gateways (Akash, Together, Groq, OpenRouter, etc.) |
| Cost control | Free local options; paid APIs only on the user’s account; optional per-request limits |
| Privacy | Documents and keys stay under the user’s control; no training on user data by SiamTeX itself |

### Non-goals (initially)

- Guaranteeing a free hosted model for every visitor on the SiamTeX server budget  
- Fully autonomous “agent” that compiles and deploys without review  
- Fine-tuning custom models on the droplet  

---

## 2. Recommended architecture: BYOK + OpenAI-compatible core

Most providers either:

1. Speak the **OpenAI Chat Completions** HTTP API (`POST /v1/chat/completions`), or  
2. Have a small adapter (Anthropic Messages API).

**SiamTeX should implement:**

```
Browser UI  →  PHP API (authz, encrypt, rate-limit)
                    ↓
            Provider adapter (openai-compatible | anthropic | ollama)
                    ↓
            User’s endpoint (local Ollama, cloud API, Akash gateway, …)
```

### Why this works well

| Provider | How users connect | Cost model |
|----------|-------------------|------------|
| **Ollama** (local/NAS/home server) | Base URL e.g. `http://192.168.1.10:11434` or a tunnel; model name e.g. `llama3.2` | **Free** (their electricity/hardware) |
| **OpenAI** | API key + model (`gpt-4.1-mini`, etc.) | Pay-as-you-go; cheap models are cents per resume |
| **Anthropic** | API key + model (`claude-haiku-*`, `claude-sonnet-*`) | Pay-as-you-go; Haiku is inexpensive |
| **xAI (Grok)** | API key; often OpenAI-compatible base URL | Pay-as-you-go |
| **OpenRouter / Together / Groq** | One key, many models | Pay-as-you-go; easy switching |
| **Akash / decentralized GPU** | Usually an **OpenAI-compatible** HTTP endpoint + token from a gateway/provider | Often cheaper GPU inference; varies by deployment |

**Practical default for “free or cheap”:**

1. **Ollama** for power users and privacy (best free path).  
2. **OpenAI `*-mini` / Anthropic Haiku / Groq** for cheap on-demand cloud.  
3. **OpenRouter** if you want one integration that reaches many models (including open weights).

SiamTeX never needs to run GPU inference on the DigitalOcean droplet.

---

## 3. User-facing settings (what to build)

Under **Settings → AI provider** (per user, not global):

| Field | Example | Required |
|-------|---------|----------|
| Provider preset | `ollama`, `openai`, `anthropic`, `xai`, `openai_compatible` | Yes |
| Base URL | `http://127.0.0.1:11434/v1` or `https://api.openai.com/v1` | Yes (except when implied) |
| API key | `sk-…` / Anthropic key / gateway token | No for local Ollama without auth |
| Model | `llama3.2`, `gpt-4.1-mini`, `claude-haiku-4-5` | Yes |
| Max tokens / timeout | e.g. 4096 / 60s | Optional defaults |
| Enable AI features | on/off | Yes |

**Storage:** encrypt API keys with the same master-key / envelope approach as project files (`data/` only, never git). Never log keys or full prompts in application logs.

**Test connection** button: send a tiny chat (“Reply with OK”) and show success/failure.

### Ollama-specific notes

- Ollama’s OpenAI-compatible endpoint is typically:  
  `http://HOST:11434/v1`  
  with any non-empty API key (Ollama often ignores it) or none.  
- Browser **cannot** call a user’s home Ollama directly from an HTTPS-hosted SiamTeX site (mixed content / firewall).  
  **Traffic must go:** browser → **SiamTeX PHP** → user’s Ollama URL.  
- For Ollama on the public internet, users should use a **VPN, Tailscale, Cloudflare Tunnel, or SSH tunnel**, not a wide-open `:11434`. Document that clearly in the UI.

### Anthropic

Use the Messages API adapter (`/v1/messages`) rather than forcing OpenAI format, unless using a gateway that already translates.

---

## 4. Product flows for resume AI

### 4.1 “Update my resume from documents”

1. User opens a resume project (multi-file package).  
2. Opens **AI assist** panel.  
3. Uploads one or more of: `.txt`, `.md`, `.tex`, `.docx` (and maybe `.pdf` later via text extraction).  
4. Chooses a goal, e.g.:  
   - Replace all content from these materials  
   - Merge into existing sections only  
   - Improve wording / quantify bullets  
   - Tailor to a pasted job description  
5. SiamTeX builds a **structured prompt** (see §5) including:  
   - Current file tree and contents (resume partials)  
   - Extracted text from uploads  
   - Instructions to return **JSON** mapping `path → full new file content`  
6. Model responds; UI shows a **diff per file** (Accept / Reject / Edit).  
7. On Accept, write files through the existing encrypted file API and offer **Compile**.

**Never** auto-overwrite without review in v1.

### 4.2 “Fill empty template”

Same as above, but current files are mostly placeholders (“Your Name”, “Company Name”). Prompt emphasizes filling placeholders from source documents.

### 4.3 “Chat edit”

Smaller scope: user selects text or a file and prompts (“Make this bullet more impactful”). Model returns a single-file patch or replacement for the active buffer.

---

## 5. Prompt / response contract

Ask the model for **machine-readable output** so the app can apply updates safely:

```json
{
  "summary": "Short human-readable description of changes",
  "files": {
    "header.tex": "... full file ...",
    "experience.tex": "... full file ...",
    "summary.tex": "... full file ..."
  },
  "notes": ["Optional warnings, e.g. missing dates"]
}
```

Rules to include in the system prompt:

- Output **only** valid LaTeX suitable for the project’s engine (`pdflatex` by default).  
- Prefer editing existing partials (`header.tex`, `experience.tex`, …) over inventing new filenames unless asked.  
- Do not invent employers, degrees, or dates not supported by the source material; use clear placeholders if unknown.  
- Keep packages/preamble in `main.tex` unless the user asked to change layout.  
- Escape LaTeX special characters in user-provided text (`&`, `%`, `#`, `_`, etc.).  

If the model returns markdown fences, strip them in PHP before parse.

---

## 6. Document ingest (Word / text / old LaTeX)

| Format | Approach |
|--------|----------|
| `.txt`, `.md`, `.tex` | Read as UTF-8 text (size-capped). |
| `.docx` | PHP library (e.g. `phpoffice/phpword`) or `unzip` + `word/document.xml` text extract. |
| `.pdf` (later) | Optional `pdftotext` in a sandbox; lower priority. |

Limits (suggested defaults):

- Max upload **2–5 MB** per file, **3–5 files** per request.  
- Truncate extracted text to a token budget (e.g. ~50–100k characters total) with a clear UI warning.  

Extracted text is sent **only** to the user’s configured provider, not stored longer than needed (optional short-lived cache in encrypted temp, then wipe).

---

## 7. Cost & limits (free / cheap on demand)

### Free

| Option | Limits |
|--------|--------|
| **Ollama** on user’s machine | Hardware RAM/VRAM; quality depends on model size |
| **Groq** free tier (if still offered) | Rate limits; check current terms |
| **OpenRouter** free models (if any) | Often rate-limited / busy |

### Cheap cloud (typical resume job)

A full resume rewrite is usually **one request** of a few thousand tokens in + out.

| Class | Ballpark |
|-------|----------|
| Mini / Haiku / small open models | Often **&lt; $0.01–0.05** per full resume update |
| Mid-tier Sonnet / GPT-4.1 class | Cents to low tens of cents |

Exact prices change; link to provider pricing in the Settings UI.

### App-side limits (protect the server, not pay for tokens)

Even with BYOK, PHP should enforce:

- Per-user rate limit (e.g. 10 AI calls / hour)  
- Max request body size  
- Timeout (e.g. 60s)  
- Concurrent AI jobs per user = 1  

Optional: daily cap configurable by admin env (`SIAMTEX_AI_MAX_CALLS_PER_DAY`).

---

## 8. Security

| Risk | Mitigation |
|------|------------|
| Stolen API keys | Encrypt at rest; HTTPS only; never expose keys to other users’ browsers |
| SSRF via Base URL | Allowlist schemes `https:` (and `http:` only for private nets if you dare); block link-local/metadata IPs (`169.254.169.254`, `localhost` variants on the **server** if you don’t intend server-local Ollama) |
| Prompt injection in uploaded docs | Treat uploads as untrusted data; system prompt says ignore instructions inside documents that try to exfiltrate keys |
| Overwrite attack | Diff + explicit Accept; authz on project edit role |
| Logging | No prompts, documents, or keys in logs |

**SSRF note:** When PHP calls `http://192.168.x.x:11434`, that only works if the **droplet** can route there (it usually cannot reach a user’s LAN). Real Ollama-from-LAN setups need a **tunnel to a public HTTPS URL** the server can reach, or a future browser-side path (harder, CORS). Document Tailscale Funnel / Cloudflare Tunnel as the supported pattern.

---

## 9. Implementation sketch (PHP)

Built modules:

```
src/Ai/
  AiConfig.php
  AiService.php
  OpenAiCompatibleClient.php   # buffered chat + SSE stream proxy (curl)
  PromptBuilder.php
  AiResponseParser.php
  UrlGuard.php
api/
  ai_settings.php
  ai_test.php                  # buffered connection test (unchanged for Ollama JSON ping)
  ai_complete.php              # buffered JSON fallback
  ai_stream.php                # SSE: token stream (single file) + status/progress (multi-file)
```

**Streaming behavior (v1):**

| Mode | Provider wire format | UI |
|------|---------------------|-----|
| Single-file assist | `stream: true`, plain LaTeX (Ollama **without** `format: json`) | Live token preview in progress dialog |
| Whole project / fix problems | `stream: true` internally, Ollama keeps `format: json` | Status messages + received character count; full diff after `done` |
| Test connection | `stream: false`, Ollama `format: json` | Short buffered ping |

The browser reads `text/event-stream` events: `status`, `delta`, `progress`, `done`, `error`. Parsed results still go through `AiResponseParser` before Accept.

**Web server:** disable reverse-proxy buffering for `ai_stream.php`; `fastcgi_read_timeout` ≥ `SIAMTEX_AI_TIMEOUT`. See `config/nginx-siamtex.conf.example`.

UI:

- Settings page for provider  
- Project **AI** drawer: scope, instruction, Run with live progress, diff viewer, Accept  

Dependencies (Composer examples):

- `phpoffice/phpword` for `.docx` (or a minimal XML extract to avoid heavy deps)  
- PHP **curl** extension for streaming (not a Composer package)

---

## 10. Phased rollout

### Phase A — Settings + test (small)

- BYOK storage (OpenAI-compatible + Ollama URL)  
- Test connection  
- Single-file “rewrite selection / active file” chat  

### Phase B — Resume package update

- Multi-file context  
- JSON apply with diffs  
- `.txt` / `.md` / `.tex` upload  

### Phase C — Word + polish

- `.docx` extract  
- Job-description tailor preset  
- Anthropic adapter + OpenRouter preset buttons  

### Phase D — Optional server-sponsored tier (only if you want)

- Admin-configured shared key for a **cheap** model with strict quotas  
- Clear UI: “Hosted AI (limited)” vs “My own API key”  
- Budget alarms; disable when quota exceeded  

Phase D is optional; Phases A–C match “free or cheap on demand” without funding everyone’s usage.

---

## 11. Example user setups

### A. Free / private (Ollama + Tailscale)

1. Install [Ollama](https://ollama.com), pull e.g. `llama3.2` or a stronger model that fits RAM.  
2. Expose Ollama with Tailscale Serve/Funnel or Cloudflare Tunnel as `https://ollama.example.ts.net/v1`.  
3. In SiamTeX: provider `openai_compatible`, base URL that HTTPS endpoint, model `llama3.2`.  
4. Use **Update resume from documents**.  

### B. Cheap cloud (OpenAI)

1. Create an API key at OpenAI.  
2. SiamTeX: provider `openai`, model `gpt-4.1-mini` (or current mini equivalent).  
3. Set a monthly budget alert on the OpenAI dashboard.  

### C. Cheap cloud (Anthropic)

1. API key from Anthropic.  
2. Provider `anthropic`, model Haiku-class for drafts, Sonnet for harder rewrites.  

### D. Akash / marketplace GPU

1. Deploy or subscribe to an inference gateway that exposes **OpenAI-compatible** `/v1/chat/completions`.  
2. Provider `openai_compatible`, paste gateway base URL + token + model id.  
3. Same resume flows as OpenAI.  

---

## 12. UX copy (tone)

Keep AI features clearly optional:

> AI is optional. Connect your own Ollama server or API key. SiamTeX sends your documents only to the provider you configure. Review every change before it updates your project.

---

## 13. Relation to SPECS.md

When implementing, add requirements along these lines:

- Optional BYOK AI providers (Ollama / OpenAI-compatible / Anthropic)  
- Resume/document assist with upload + multi-file apply via review  
- Encrypted storage of user API keys  
- SSRF protections on custom base URLs  
- No secrets or provider keys in the public git repo  

---

## 14. Summary recommendation

| Priority | Choice |
|----------|--------|
| Best free path | **Ollama** via tunnel + OpenAI-compatible client |
| Best cheap cloud | **OpenAI mini** or **Anthropic Haiku**, or **OpenRouter** for flexibility |
| Best fit for Akash/etc. | Treat as **OpenAI-compatible** base URL |
| Server cost | Near zero (PHP proxy only); users pay their own APIs |
| Safety | Diffs before apply; encrypt keys; rate limits; no shared master key required |

This keeps SiamTeX installable by anyone, avoids surprising cloud bills on the droplet, and still delivers “update my resume from old Word/LaTeX/notes” when the user plugs in a provider they trust.
