# Tailscale + home Ollama (droplet ↔ home)

Secure pattern: **Ollama never on the public internet.** Both the DigitalOcean droplet and your home PC join the same Tailscale tailnet; only the droplet reaches `home-ollama:11434`.

| Machine | Example role |
|---------|----------------|
| **Droplet** (`siamtex-droplet`) | Runs SiamTeX; calls Ollama over tailnet |
| **Home** (desktop, NAS, Bazzite, …) | Runs models; listens on tailnet IP only |

Tailscale uses `100.x.x.x` addresses on the tailnet — not your home WAN IP.

**Full install walkthrough:** [INSTALL_DO.md](../INSTALL_DO.md) (path A) · [ai-providers.md](./ai-providers.md) (all providers)

---

## 1. Droplet (this server)

As **root**:

```bash
cd /var/www/html/siamtex

# Interactive login (opens a URL):
bash scripts/setup-tailscale-droplet.sh

# Or with a one-time auth key from https://login.tailscale.com/admin/settings/keys :
# TS_AUTHKEY=tskey-auth-xxxxxxxx TS_HOSTNAME=siamtex-droplet bash scripts/setup-tailscale-droplet.sh
```

Note the droplet’s tailnet IP:

```bash
tailscale ip -4
```

---

## 2. Home machine

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --hostname=home-ollama
```

Bind Ollama to the **Tailscale interface only** (replace with your home tailnet IP):

```bash
# /etc/systemd/system/ollama.service.d/override.conf
[Service]
Environment="OLLAMA_HOST=100.x.x.x:11434"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Pull a model (example):

```bash
ollama pull qwythos:9b
```

Confirm from home:

```bash
curl -sS "http://100.x.x.x:11434/api/tags" | head
```

---

## 3. Tailscale ACL (admin console)

In [Access controls](https://login.tailscale.com/admin/acls), restrict Ollama to the droplet only. Example (adjust tag/hostnames to match your machines):

```json
{
  "tagOwners": {
    "tag:siamtex": ["your-email@example.com"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["tag:siamtex"],
      "dst": ["home-ollama:11434"]
    }
  ],
  "nodeAttrs": [
    {
      "target": ["tag:siamtex"],
      "attr": ["tag:siamtex"]
    }
  ]
}
```

Or by hostname after tagging the droplet:

```json
{
  "acls": [
    { "action": "accept", "src": ["siamtex-droplet"], "dst": ["home-ollama:11434"] }
  ]
}
```

Apply tags when bringing up the droplet:

```bash
tailscale up --hostname=siamtex-droplet --advertise-tags=tag:siamtex --auth-key=...
```

---

## 4. Test from droplet

```bash
curl -sS "http://home-ollama:11434/api/tags"
```

### Enable SiamTeX AI

```bash
sudo /var/www/html/siamtex/scripts/configure-ai-ollama.sh
sudo systemctl restart php8.3-fpm
```

Or add to `/etc/siamtex.env` manually:

```bash
SIAMTEX_AI_ENABLED=1
SIAMTEX_AI_BASE_URL=http://home-ollama:11434/v1
SIAMTEX_AI_MODEL=qwythos:9b
SIAMTEX_AI_TIMEOUT=180
SIAMTEX_AI_MAX_TOKENS=8192
SIAMTEX_AI_MAX_CONTEXT_CHARS=200000
```

In the app: open a project → **AI** → **Test connection** → run an instruction → **Accept**.

> AI features are **alpha / experimental**. Fix suggestions and edits depend on your model; always review before accepting.

Traffic path: **browser → SiamTeX PHP → Tailscale → Ollama** (never browser → home).

---

## 5. Do not

- Port-forward `:11434` on your home router to the internet
- Set `OLLAMA_HOST=0.0.0.0` without a host firewall limited to the tailnet
- Rely on home WAN IP allowlisting alone (Ollama has no built-in auth)

---

## Model tips

| Model class | Notes |
|-------------|--------|
| **7B–9B instruct** (e.g. `qwythos:9b`, Llama 3.2) | Good balance on 8 GB VRAM; fix-problems may take 1–3 minutes; **alpha quality varies** |
| **14B+** | Better reasoning; needs more VRAM/RAM and longer `SIAMTEX_AI_TIMEOUT` |
| **Cloud BYOK** | Set `SIAMTEX_AI_BASE_URL` to OpenAI-compatible endpoint if you skip home Ollama |
| **Any model** | SiamTeX AI is **experimental** — never skip human review before Accept |

Increase `SIAMTEX_AI_TIMEOUT` (e.g. `240`) if the progress bar reaches the limit before the model finishes.
