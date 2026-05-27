#!/usr/bin/env bash
set -eu

mkdir -p /data/plugins/codex/.data

ensure_default_bashrc() {
  home_dir="${HOME:-/root}"
  bashrc="$home_dir/.bashrc"

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

PS1='\u@\h:\w\$ '
EOF
}

ensure_default_bashrc

: "${METIDOS_PUBLIC_ORIGIN:?METIDOS_PUBLIC_ORIGIN must be set to the browser-facing https origin}"
: "${METIDOS_PORT:=7599}"

caddy run --config /etc/caddy/Caddyfile --adapter caddyfile &
caddy_pid="$!"

bun run start:tls &
metidos_pid="$!"

term() {
  kill "$metidos_pid" "$caddy_pid" 2>/dev/null || true
  wait "$metidos_pid" "$caddy_pid" 2>/dev/null || true
}

trap term INT TERM

wait -n "$metidos_pid" "$caddy_pid"
status="$?"
term
exit "$status"
