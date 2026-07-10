#!/bin/sh
# Copy renewed chat.wsams.org certs into Prosody and reload.
# Install:
#   install -m 755 config/letsencrypt-deploy-prosody.example.sh \
#     /etc/letsencrypt/renewal-hooks/deploy/reload-prosody.sh

set -e

case "$RENEWED_LINEAGE" in
  */chat.wsams.org)
    ;;
  *)
    exit 0
    ;;
esac

CERT_DIR="/etc/prosody/certs"
install -o prosody -g prosody -m 640 \
  "$RENEWED_LINEAGE/fullchain.pem" "$CERT_DIR/chat.wsams.org.crt"
install -o prosody -g prosody -m 600 \
  "$RENEWED_LINEAGE/privkey.pem" "$CERT_DIR/chat.wsams.org.key"

if command -v prosodyctl >/dev/null 2>&1; then
  prosodyctl reload
fi
