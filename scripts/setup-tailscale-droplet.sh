#!/usr/bin/env bash
# Install and bring up Tailscale on this droplet (Ubuntu/Debian).
# Run as root:  sudo bash scripts/setup-tailscale-droplet.sh
#
# Optional env:
#   TS_AUTHKEY=tskey-auth-...   non-interactive join (from https://login.tailscale.com/admin/settings/keys)
#   TS_HOSTNAME=siamtex-droplet  MagicDNS short name (default)

set -euo pipefail

TS_HOSTNAME="${TS_HOSTNAME:-siamtex-droplet}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $0" >&2
  exit 1
fi

if ! command -v tailscale >/dev/null 2>&1; then
  echo "Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
fi

systemctl enable --now tailscaled

UP_ARGS=(--hostname="$TS_HOSTNAME" --accept-routes --ssh=false)

if [[ -n "${TS_AUTHKEY:-}" ]]; then
  UP_ARGS+=(--auth-key="$TS_AUTHKEY")
  tailscale up "${UP_ARGS[@]}"
else
  echo ""
  echo "No TS_AUTHKEY set — open this URL in a browser to authorize this droplet:"
  echo ""
  tailscale up "${UP_ARGS[@]}"
fi

echo ""
echo "=== Tailscale status ==="
tailscale status
echo ""
echo "Droplet tailnet IP (use from home / SiamTeX for peer routing):"
tailscale ip -4
echo ""
echo "Next steps:"
echo "  1. Install Tailscale on your home Ollama machine (Bazzite)."
echo "  2. On home: OLLAMA_HOST=<home-tailnet-ip>:11434  (not 0.0.0.0)"
echo "  3. In Tailscale admin → Access controls, restrict who can reach home:11434."
echo "     Example ACL snippet is in docs/tailscale-ollama.md"
