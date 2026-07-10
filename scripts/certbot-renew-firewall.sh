#!/usr/bin/env bash
# Renew Let's Encrypt certificates when UFW blocks port 80 by default.
# Opens 80/tcp, runs certbot renew, then blocks 80/tcp again.
#
# Certificates on this host (all renewed in one run):
#   - wsams.org              (Apache)
#   - atom.builders          (Apache, www.atom.builders)
#   - chat.wsams.org         (webroot; Prosody XMPP + subdomains)
#
# Install (as root):
#   install -m 755 scripts/certbot-renew-firewall.sh /usr/local/sbin/certbot-renew-firewall.sh
#   install -m 644 config/cron-certbot-firewall.example /etc/cron.d/certbot-firewall
#   systemctl disable --now certbot.timer
#
# Requires: certbot, ufw, flock

set -euo pipefail

LOG_FILE="${CERTBOT_FW_LOG:-/var/log/certbot-renew-firewall.log}"
LOCK_FILE="${CERTBOT_FW_LOCK:-/run/certbot-renew-firewall.lock}"
PORT80_OPENED=0

# Hostnames with renewal configs we expect on this server.
EXPECTED_CERTS=(
  wsams.org
  atom.builders
  chat.wsams.org
)

log() {
  printf '%s %s\n' "$(date -Is)" "$*" | tee -a "$LOG_FILE"
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "Run as root." >&2
    exit 1
  fi
}

check_expected_certs() {
  local cert missing=0
  log "Checking renewal configs for: ${EXPECTED_CERTS[*]}"
  for cert in "${EXPECTED_CERTS[@]}"; do
    if [[ -f "/etc/letsencrypt/renewal/${cert}.conf" ]]; then
      log "  OK  ${cert}"
    else
      log "  MISSING  ${cert} (no /etc/letsencrypt/renewal/${cert}.conf)"
      missing=1
    fi
  done
  if [[ "$missing" -ne 0 ]]; then
    log "WARNING: one or more expected certificates are not configured"
  fi
}

ufw_allows_port80() {
  ufw status 2>/dev/null | grep -qE '80/tcp[[:space:]]+ALLOW'
}

ufw_denies_port80() {
  ufw status 2>/dev/null | grep -qE '80/tcp[[:space:]]+DENY'
}

open_port80() {
  if ufw_allows_port80; then
    log "Port 80/tcp already allowed in UFW"
    return
  fi
  log "Allowing port 80/tcp in UFW for ACME HTTP-01"
  ufw allow 80/tcp >/dev/null
  PORT80_OPENED=1
}

close_port80() {
  if ! ufw status >/dev/null 2>&1; then
    return
  fi
  while ufw_allows_port80; do
    log "Removing UFW allow rule for port 80/tcp"
    ufw --force delete allow 80/tcp >/dev/null 2>&1 || break
  done
  if ! ufw_denies_port80; then
    log "Denying port 80/tcp in UFW"
    ufw deny 80/tcp >/dev/null
  fi
  PORT80_OPENED=0
}

on_exit() {
  local status=$?
  if [[ "$PORT80_OPENED" -eq 1 ]] || ufw_allows_port80; then
    close_port80
    log "Port 80/tcp blocked again"
  fi
  if [[ "$status" -ne 0 ]]; then
    log "Finished with errors (exit $status)"
  fi
  return "$status"
}

require_root

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Another renewal is already running; exiting"
  exit 0
fi

trap on_exit EXIT

log "Starting certificate renewal (firewall window)"

check_expected_certs

open_port80

set +e
certbot renew --no-random-sleep-on-renew --non-interactive "$@"
status=$?
set -e

if [[ "$status" -eq 0 ]]; then
  log "Certbot renew completed successfully"
else
  log "Certbot renew failed with exit code $status"
fi

exit "$status"
