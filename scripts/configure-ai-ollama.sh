#!/usr/bin/env bash
# Apply recommended Ollama AI settings to /etc/siamtex.env and reload PHP-FPM.
# Run as root on the SiamTeX server: sudo ./scripts/configure-ai-ollama.sh
set -euo pipefail

ENV_FILE="${SIAMTEX_ENV_FILE:-/etc/siamtex.env}"
MODEL="${SIAMTEX_AI_MODEL:-qwythos:9b}"
BASE_URL="${SIAMTEX_AI_BASE_URL:-http://home-ollama:11434/v1}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy config/siamtex.env.example first." >&2
  exit 1
fi

set_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_FILE"
  else
    echo "${key}=${val}" >> "$ENV_FILE"
  fi
}

set_kv SIAMTEX_AI_ENABLED 1
set_kv SIAMTEX_AI_PROVIDER ollama
set_kv SIAMTEX_AI_BASE_URL "$BASE_URL"
set_kv SIAMTEX_AI_MODEL "$MODEL"
set_kv SIAMTEX_AI_MAX_TOKENS 16384
set_kv SIAMTEX_AI_MAX_CONTEXT_CHARS 200000
set_kv SIAMTEX_AI_TIMEOUT 180

chmod 640 "$ENV_FILE"
chown root:www-data "$ENV_FILE" 2>/dev/null || true

PHP_VER="${PHP_VER:-8.3}"
if systemctl is-active --quiet "php${PHP_VER}-fpm"; then
  systemctl restart "php${PHP_VER}-fpm"
  echo "Restarted php${PHP_VER}-fpm"
else
  echo "php${PHP_VER}-fpm not active — restart the PHP-FPM service manually." >&2
fi

echo "AI config updated in $ENV_FILE:"
grep '^SIAMTEX_AI_' "$ENV_FILE" || true
