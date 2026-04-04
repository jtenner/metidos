#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/fix-jolt-nginx-tls.sh \
    --site-file /etc/nginx/sites-available/<name> \
    --domain <public-domain-or-host> \
    --ssl-cert /path/to/fullchain.pem \
    --ssl-key /path/to/privkey.pem \
    [--upstream-host 127.0.0.1] \
    [--public-port 7599] \
    [--rpc-port 7600]

This script overwrites the full nginx site file with a TLS config that:
- serves the app from the static server on the public port
- routes /rpc to the RPC backend port with WebSocket upgrade headers
- forwards headers used by JOLT for proxy-aware secure behavior
EOF
  exit 1
}

die() {
  printf 'ERROR: %s\n' "$1" >&2
  exit 1
}

SITE_FILE=""
DOMAIN=""
SSL_CERT=""
SSL_KEY=""
UPSTREAM_HOST="127.0.0.1"
PUBLIC_PORT="7599"
RPC_PORT="7600"
BACKUP_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --site-file)
      SITE_FILE="${2:?Missing value for --site-file}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:?Missing value for --domain}"
      shift 2
      ;;
    --ssl-cert)
      SSL_CERT="${2:?Missing value for --ssl-cert}"
      shift 2
      ;;
    --ssl-key)
      SSL_KEY="${2:?Missing value for --ssl-key}"
      shift 2
      ;;
    --upstream-host)
      UPSTREAM_HOST="${2:?Missing value for --upstream-host}"
      shift 2
      ;;
    --public-port)
      PUBLIC_PORT="${2:?Missing value for --public-port}"
      shift 2
      ;;
    --rpc-port)
      RPC_PORT="${2:?Missing value for --rpc-port}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      ;;
  esac
done

if [[ -z "$SITE_FILE" || -z "$DOMAIN" || -z "$SSL_CERT" || -z "$SSL_KEY" ]]; then
  die "--site-file, --domain, --ssl-cert, and --ssl-key are required."
fi

if ! [[ "$PUBLIC_PORT" =~ ^[0-9]+$ ]] || (( PUBLIC_PORT < 1 || PUBLIC_PORT > 65535 )); then
  die "Public port must be an integer from 1 to 65535."
fi

if ! [[ "$RPC_PORT" =~ ^[0-9]+$ ]] || (( RPC_PORT < 1 || RPC_PORT > 65535 )); then
  die "RPC port must be an integer from 1 to 65535."
fi

if ! command -v nginx >/dev/null 2>&1; then
  die "nginx not found in PATH."
fi

if [[ ! -f "$SSL_CERT" || ! -f "$SSL_KEY" ]]; then
  die "SSL cert/key file not found."
fi

TMP_FILE="$(mktemp)"
trap 'rm -f "$TMP_FILE"' EXIT

BACKUP_SUFFIX="$(date +%Y%m%d%H%M%S)"
cat > "$TMP_FILE" <<EOF
server {
  listen 80;
  server_name ${DOMAIN};
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl;
  server_name ${DOMAIN};

  ssl_certificate ${SSL_CERT};
  ssl_certificate_key ${SSL_KEY};

  access_log /var/log/nginx/jolt_access.log;
  error_log /var/log/nginx/jolt_error.log;

  location / {
    proxy_http_version 1.1;
    proxy_set_header Host \$host:\$server_port;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_pass http://${UPSTREAM_HOST}:${PUBLIC_PORT};
  }

  location /rpc {
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host:\$server_port;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_pass http://${UPSTREAM_HOST}:${RPC_PORT};
  }
}
EOF

if [[ -f "$SITE_FILE" ]]; then
  BACKUP_FILE="${SITE_FILE}.bak.${BACKUP_SUFFIX}"
  echo "Backing up existing config to ${SITE_FILE}.bak.${BACKUP_SUFFIX}"
  sudo cp "$SITE_FILE" "$BACKUP_FILE"
fi

sudo mv "$TMP_FILE" "$SITE_FILE"
sudo chmod 644 "$SITE_FILE"

if ! sudo nginx -t; then
  echo "nginx config test failed."
  if [[ -n "$BACKUP_FILE" ]]; then
    echo "Restoring backup from $BACKUP_FILE."
    sudo mv "$BACKUP_FILE" "$SITE_FILE"
  else
    echo "Removing failed config at $SITE_FILE."
    sudo rm -f "$SITE_FILE"
  fi
  exit 1
fi

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl reload nginx
else
  sudo service nginx reload
fi

echo "Updated $SITE_FILE and reloaded nginx."
