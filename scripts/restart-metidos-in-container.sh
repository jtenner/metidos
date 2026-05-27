#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f /run/.containerenv && ! -f /.dockerenv ]]; then
  printf 'This script is only for use inside the Metidos container.\n' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="${METIDOS_SOURCE_DIR:-$repo_root}"

if [[ ! -f "$source_dir/package.json" ]]; then
  printf 'METIDOS_SOURCE_DIR does not point to a Metidos checkout: %s\n' "$source_dir" >&2
  exit 1
fi

cd "$source_dir"

if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git status --short --branch
fi

if [[ "${METIDOS_INSTALL_DEPS_ON_START:-0}" == "1" ]]; then
  bun install --frozen-lockfile
fi

printf 'Restarting Metidos by terminating container PID 1. Podman restart policy will start it again.\n'
kill -TERM 1
