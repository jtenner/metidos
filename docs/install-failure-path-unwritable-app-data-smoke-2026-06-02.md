# Install failure-path smoke: unwritable App Data — 2026-06-02

This smoke covers the remaining install/setup failure-path slice for an unwritable `METIDOS_APP_DATA_DIR`.

## Environment

- Date: 2026-06-02
- Host OS: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64, Debian kernel build `6.12.90-2`.
- Bun: `1.3.14`, matching `package.json` `packageManager`.
- Source revision: `345d23f`.
- Checkout: `/home/jtenner/Projects/jt-ide`.
- Provider credentials: none used; the command ran with a minimal environment.

## Command

The runtime intentionally points both the configured App Data path and the XDG default App Data parent at `/proc` paths that cannot be created. Setting both values is important because Metidos intentionally falls back from an unwritable configured `METIDOS_APP_DATA_DIR` to the OS default App Data directory when the default is usable.

```bash
smoke_root="$(mktemp -d -p "$PWD" .metidos-unwritable-smoke-XXXXXX)"
trap 'rm -rf "$smoke_root"' EXIT

env -i \
  PATH="$PATH" \
  HOME="$smoke_root/home" \
  XDG_DATA_HOME="/proc/metidos-default-unwritable" \
  METIDOS_APP_DATA_DIR="/proc/metidos-configured-unwritable" \
  METIDOS_PORT=49733 \
  bun run start >"$smoke_root/stdout.log" 2>"$smoke_root/stderr.log"
```

A preliminary `chmod 0555` directory attempt was not used as final evidence because this smoke environment can still create files in that directory; the `/proc` path produced a deterministic unwritable-path failure without requiring private local state.

## Result

- `bun run start` exited with status `1`.
- Tailwind build completed before App Data resolution failed during core plugin sync.
- No provider credentials or private `.env` values were required.
- The actionable startup error was:

```text
Unable to find a writable application data directory. Checked METIDOS_APP_DATA_DIR=/proc/metidos-configured-unwritable and /proc/metidos-default-unwritable/.metidos. Set METIDOS_APP_DATA_DIR to an explicit writable application data directory if the default location is unavailable.
```

## Readability assessment

This path already provides a contributor-friendly recovery step. It names the configured `METIDOS_APP_DATA_DIR`, names the fallback default App Data path that was checked, and tells the operator to set `METIDOS_APP_DATA_DIR` to an explicit writable application data directory.

No code change is required for this slice.
