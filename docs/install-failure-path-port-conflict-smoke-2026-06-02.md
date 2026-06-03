# Install failure-path smoke: main HTTP port conflict — 2026-06-02

This smoke check covers the port-conflict slice of the public-readiness failure-path TODO.

## Environment

- OS/kernel: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64, Debian kernel build `6.12.90-2`.
- Bun: `1.3.14`, matching `package.json` `packageManager`.
- Checkout: `/home/jtenner/Projects/jt-ide`.
- App Data: disposable `/tmp/.../app-data` directory.
- Provider credentials: none used.

## Command

A Python socket listener occupied a disposable explicit main HTTP port while the Metidos backend started with a separate disposable web-server share port:

```bash
TMPDIR=$(mktemp -d)
PORT=7615
SHARE=17615
python3 - <<PY &
import socket, time
s=socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(('127.0.0.1', $PORT)); s.listen(1); print('bound', flush=True); time.sleep(15)
PY
PY_PID=$!
sleep 1
METIDOS_APP_DATA_DIR="$TMPDIR/app-data" \
  METIDOS_PORT=$PORT \
  METIDOS_WEB_SERVER_SHARE_PORT=$SHARE \
  timeout 20s bun run src/bun/start.ts
```

## Result

Before this slice, the process exited on the port conflict without a contributor-friendly console message and could leave startup side work running long enough for the smoke command to time out.

After the fix, startup prints a direct next-step message and exits with status `1` after coordinated shutdown:

```text
Metidos failed to start because 0.0.0.0:7615 is already in use.
Stop the process using that port, choose another port with --port <port> or METIDOS_PORT=<port>, or unset METIDOS_PORT during bun run dev to allow the development fallback port.
```

The output also showed the cron scheduler shutdown message before exit, confirming the startup-failure path cleaned up background work in this scenario.

## Validation

- `bun format` passed with no formatting fixes.
- `bun run validate` was attempted. It reached typecheck and failed on a pre-existing unrelated error in `src/bun/message-activity-store.test.ts(156,41)` where `number | undefined` is passed to `number | null`. Biome also reported pre-existing warnings in unrelated test files.
