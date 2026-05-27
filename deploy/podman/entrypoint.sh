#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data/plugins/codex/.data /data/pi-agent "${METIDOS_CONTAINER_PROJECTS_DIR:-${HOME:-/home/metidos}/Projects}"

ensure_default_bashrc() {
  local home_dir="${HOME:-/root}"
  local bashrc="$home_dir/.bashrc"

  mkdir -p "$home_dir"
  if [ -e "$bashrc" ]; then
    return
  fi

  cat >"$bashrc" <<'EOF'
# Metidos default interactive shell setup.
case $- in
  *i*) ;;
  *) return ;;
esac

if [ -n "${MOONBIT_BIN_DIR:-}" ] && [ -d "$MOONBIT_BIN_DIR" ]; then
  case ":$PATH:" in
    *":$MOONBIT_BIN_DIR:"*) ;;
    *) export PATH="$MOONBIT_BIN_DIR:$PATH" ;;
  esac
fi

export OPAMROOT="${OPAMROOT:-/opt/opam}"
export OPAMSWITCH="${OPAMSWITCH:-moonbit-proof}"
if command -v opam >/dev/null 2>&1 && [ -d "$OPAMROOT/$OPAMSWITCH" ]; then
  eval "$(opam env --switch="$OPAMSWITCH" --set-switch)"
fi

PS1='\u@\h:\w\$ '
EOF
}

ensure_default_bashrc

export OPAMROOT="${OPAMROOT:-/opt/opam}"
export OPAMSWITCH="${OPAMSWITCH:-moonbit-proof}"
if command -v opam >/dev/null 2>&1 && [ -d "$OPAMROOT/$OPAMSWITCH" ]; then
  eval "$(opam env --switch="$OPAMSWITCH" --set-switch)"
fi

if command -v why3 >/dev/null 2>&1 && [ ! -f "$HOME/.why3.conf" ]; then
  why3 config detect >/dev/null
fi

if command -v moon >/dev/null 2>&1 && [ -f moon.mod.json ] && [ ! -d "$HOME/.moon/registry/index" ]; then
  moon update >/dev/null
fi

start_chrome_debug() {
  local chrome_path="${BUN_CHROME_PATH:-}"
  local chrome_port="${METIDOS_CHROME_DEBUG_PORT:-}"
  local chrome_backend_port="${METIDOS_CHROME_DEBUG_BACKEND_PORT:-19222}"
  local chrome_user_data_dir="${METIDOS_CHROME_DEBUG_USER_DATA_DIR:-/data/chrome-debug}"

  if [ -z "$chrome_path" ] || [ -z "$chrome_port" ]; then
    return
  fi

  if [ ! -x "$chrome_path" ]; then
    printf 'BUN_CHROME_PATH is not executable: %s\n' "$chrome_path" >&2
    return
  fi

  mkdir -p "$chrome_user_data_dir"
  rm -f "$chrome_user_data_dir"/SingletonCookie "$chrome_user_data_dir"/SingletonLock "$chrome_user_data_dir"/SingletonSocket

  "$chrome_path" \
    --headless=new \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --remote-debugging-address=127.0.0.1 \
    --remote-debugging-port="$chrome_backend_port" \
    --remote-allow-origins='*' \
    --user-data-dir="$chrome_user_data_dir" \
    about:blank >/tmp/metidos-chrome-debug.log 2>&1 &

  METIDOS_CHROME_DEBUG_BACKEND_PORT="$chrome_backend_port" \
    bun run /app/deploy/podman/chrome-cdp-proxy.ts >/tmp/metidos-chrome-cdp-proxy.log 2>&1 &
}

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

: "${METIDOS_PUBLIC_ORIGIN:?METIDOS_PUBLIC_ORIGIN must match the Tailscale HTTPS URL opened in the browser}"
: "${METIDOS_PORT:=7599}"

source_dir="${METIDOS_SOURCE_DIR:-/app}"

if [ ! -f "$source_dir/package.json" ]; then
  printf 'METIDOS_SOURCE_DIR does not point to a Metidos checkout: %s\n' "$source_dir" >&2
  exit 1
fi

cd "$source_dir"

if [ "${METIDOS_INSTALL_DEPS_ON_START:-0}" = "1" ]; then
  bun install --frozen-lockfile
fi

start_chrome_debug

exec bun run start:tls
