# Install failure-path smoke: missing Mainview build assets — 2026-06-02

## Scope

This smoke covers the stale or missing Mainview build asset recovery slice from `agent-todo.md`. It verifies what happens when the generated `.metidos-build/` JavaScript bundle directory is absent before running the documented startup command.

## Environment

- Date: 2026-06-02
- OS/kernel: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64, Debian kernel build `6.12.90-2`.
- Bun version: `1.3.13`
- Workspace: `/home/jtenner/Projects/jt-ide`
- Disposable App Data: `/tmp/metidos-mainview-assets-smoke-UXQf70`
- Ports used to avoid the already-running local development instance: `METIDOS_PORT=17699`, `METIDOS_WEB_SERVER_SHARE_PORT=17700`

## Commands

The existing local `.metidos-build/` directory was moved aside before startup and restored after the smoke so the working tree's local build cache was not changed.

```bash
backup=".metidos-build.smoke-backup-$(date +%s)"
mv .metidos-build "$backup"
appdata=$(mktemp -d /tmp/metidos-mainview-assets-smoke-XXXXXX)
METIDOS_APP_DATA_DIR="$appdata" \
  METIDOS_PORT=17699 \
  METIDOS_WEB_SERVER_SHARE_PORT=17700 \
  timeout 20s bun run start
rm -rf .metidos-build
mv "$backup" .metidos-build
```

A first attempt without overriding `METIDOS_WEB_SERVER_SHARE_PORT` failed because this development environment already had port `7600` in use. That failure was expected for this host and is not part of the Mainview asset result.

## Observed result

- `bun run start` ran `tailwind:build`, synced core plugins into the disposable App Data directory, and started the Backend.
- The missing `.metidos-build/index.js` bundle was regenerated during startup before the server began serving the web app.
- Startup printed a local URL: `http://localhost:17699`.
- The process was stopped by the `timeout 20s` wrapper after successful startup. The log showed coordinated shutdown of the cron scheduler.
- No missing-asset error occurred, so there was no recovery error message to evaluate for this scenario.

Representative success log lines:

```text
$ bun run tailwind:build && bun run sync:core-plugins && bun run src/bun/start.ts
$ tailwindcss -i ./src/mainview/input.css -o ./src/mainview/index.css --minify
Done in 941ms
{"description":"Web server share worker listening on http://localhost:17700","level":"INFO","source":"Web Server Share"}
{"description":"{\"message\":\"Metidos web app listening\",\"backendOnly\":false,\"devServer\":false,\"liveReloadEnabled\":false,\"port\":17699,\"publicTlsExpected\":false,\"url\":\"http://localhost:17699\"}","level":"INFO","source":"Web Server"}
{"description":"Cron scheduler stopped.","level":"INFO","source":"Cron Scheduler"}
```

## Conclusion

The documented `bun run start` path recovers from missing generated Mainview bundle assets automatically because it runs the Tailwind build and Backend startup build path before serving the app. No docs or code change is required for missing `.metidos-build/` recovery in this scenario.

This smoke does not cover corrupted source assets such as a missing `src/mainview/index.ts` or missing dependencies; those would be source checkout or installation failures rather than stale generated-asset recovery.
