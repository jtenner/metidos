#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
  echo "ERROR: Run this script as root (for example: sudo ./scripts/fix-jolt-nginx-tls.sh)." >&2
  exit 1
fi

SITE_FILE="/etc/nginx/sites-available/node-app.conf"
if [[ ! -f "$SITE_FILE" && -L "/etc/nginx/sites-enabled/node-app.conf" ]]; then
  SITE_FILE="/etc/nginx/sites-enabled/node-app.conf"
fi
if [[ ! -f "$SITE_FILE" ]]; then
  echo "ERROR: node-app nginx config not found at /etc/nginx/sites-available/node-app.conf or /etc/nginx/sites-enabled/node-app.conf." >&2
  exit 1
fi

extract_directive() {
  local directive="$1"
  awk -v directive="$directive" '{
    if ($1 == directive) {
      print $2
      exit
    }
  }' "$SITE_FILE" | sed "s/;$//"
}

extract_upstream() {
  local upstream="$1"
  awk -v upstream="$upstream" '
    $1 == "upstream" && $2 == upstream { in_block = 1; next }
    in_block && $1 == "server" {
      gsub(/;$/, "", $2)
      print $2
      exit
    }
    in_block && $1 == "}" { in_block = 0 }
  ' "$SITE_FILE"
}

split_target() {
  local target="$1"
  local host="${target%:*}"
  local port="${target##*:}"
  printf "%s %s" "$host" "$port"
}

DOMAIN="$(extract_directive server_name)"
SSL_CERT="$(extract_directive ssl_certificate)"
SSL_KEY="$(extract_directive ssl_certificate_key)"
STATIC_TARGET="$(extract_upstream jt_ide_static)"
RPC_TARGET="$(extract_upstream jt_ide_rpc)"

if [[ -z "$DOMAIN" ]]; then
  DOMAIN="notwindows"
fi

if [[ -z "$SSL_CERT" || -z "$SSL_KEY" ]]; then
  echo "ERROR: Could not read ssl_certificate / ssl_certificate_key from $SITE_FILE." >&2
  echo "Set those in the current config first, then rerun this script." >&2
  exit 1
fi

read -r STATIC_HOST STATIC_PORT <<<"$(split_target "$STATIC_TARGET")"
read -r RPC_HOST RPC_PORT <<<"$(split_target "$RPC_TARGET")"
STATIC_HOST="${STATIC_HOST:-127.0.0.1}"
STATIC_PORT="${STATIC_PORT:-7599}"
RPC_HOST="${RPC_HOST:-$STATIC_HOST}"
RPC_PORT="${RPC_PORT:-7600}"

echo "Rewriting $SITE_FILE"
echo "  domain: $DOMAIN"
echo "  cert: $SSL_CERT"
echo "  key: $SSL_KEY"
echo "  / -> $STATIC_HOST:$STATIC_PORT"
echo "  /rpc -> $RPC_HOST:$RPC_PORT"

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

BACKUP_FILE="${SITE_FILE}.bak.$(date +%Y%m%d%H%M%S)"

cat > "$TMP_FILE" <<EOF
map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

upstream jolt_static {
    server ${STATIC_HOST}:${STATIC_PORT};
}

upstream jolt_rpc {
    server ${RPC_HOST}:${RPC_PORT};
}

server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${DOMAIN};

    ssl_certificate ${SSL_CERT};
    ssl_certificate_key ${SSL_KEY};

    client_max_body_size 20m;
    proxy_buffering off;

    location / {
        proxy_pass http://jolt_static;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
    }

    location /rpc {
        proxy_pass http://jolt_rpc;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Forwarded-Port \$server_port;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}
EOF

cp "$SITE_FILE" "$BACKUP_FILE"
mv "$TMP_FILE" "$SITE_FILE"
chmod 644 "$SITE_FILE"

if ! nginx -t; then
  echo "ERROR: nginx -t failed. Restoring $SITE_FILE from backup."
  mv "$BACKUP_FILE" "$SITE_FILE"
  exit 1
fi

if ! systemctl reload nginx; then
  echo "ERROR: nginx reload failed. Restoring $SITE_FILE from backup."
  mv "$BACKUP_FILE" "$SITE_FILE"
  exit 1
fi

echo "Updated $SITE_FILE and reloaded nginx."
