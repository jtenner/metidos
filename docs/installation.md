# Installation

This is the canonical install entry point for Metidos. It covers local development, local production-style runs, container workflow expectations, first-run auth, provider setup, backup/restore, and safe remote access.

For the step-by-step interactive installer design, see the repository skill at [`../.pi/skills/metidos-installation/SKILL.md`](../.pi/skills/metidos-installation/SKILL.md). The skill should plan before mutating the host and should export an approved `metidos-config.md` without raw secrets.

## Supported install shapes

Metidos is intended to run as a local, operator-owned application.

| Shape | Use when | Command |
| --- | --- | --- |
| Local development | You are changing source or using a live checkout. | `bun run dev` (`METIDOS_DEV=1 bun run dev` for backend dev-mode reload/fallback behavior) |
| Local production-style | You want the normal built UI and server from a checkout. | `bun run start` |
| Reverse-proxy TLS | Metidos treats the public transport as HTTPS/wss while a trusted proxy handles certificates. Bun still listens on loopback HTTP. | `bun run start:tls` |
| Telemetry sidecar | You need local runtime diagnostics snapshots. | `bun run start:telemetry` or `bun run start:tls:telemetry` |
| Container | You want an isolated runtime with explicit mounts and env. | Use the checked-in deploy examples or the installer skill. |

## Required software

- Git.
- Bun matching `package.json` `packageManager`.
- A browser.
- Optional: Docker or Podman for container installs.
- Optional: provider CLIs or local model servers depending on selected providers.

Verify Bun:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
```

If the package manager says `bun@1.3.13`, use Bun `1.3.13` for reproducible installs and validation.

## Clean clone install

```bash
git clone https://github.com/YOUR_ORG_OR_USER/metidos.git
cd metidos
bun install --frozen-lockfile
cp .env.example .env
bun run dev
```

A clean clone must not depend on ignored local state. If the app works only after copying `.metidos/`, `.metidos-build/`, app databases, plugin data, or personal `.env` files from another machine, the install is not clean.

## Configuration files and app data

`.env.example` documents safe placeholder variables. Copy it to `.env` for private local values. Never commit `.env`.

Important variables:

```bash
# Optional explicit app-data root.
METIDOS_APP_DATA_DIR=/absolute/path/to/metidos-app-data

# Optional backend port.
METIDOS_PORT=7599

# Browser-facing origin for reverse-proxy/TLS deployments.
METIDOS_PUBLIC_ORIGIN=https://metidos.example.com

# Extra allowed browser origins for /rpc WebSocket upgrades.
METIDOS_ALLOWED_WS_ORIGINS=https://metidos.example.com

# Trust reverse-proxy forwarded headers only when the proxy is the only public path.
METIDOS_TRUST_PROXY=true

# Extra allowed forwarded origins when trust-proxy mode needs more than PUBLIC_ORIGIN.
METIDOS_ALLOWED_FORWARDED_ORIGINS=https://metidos.example.com

# Optional proxy peer IP/CIDR allowlist when the trusted proxy is not loopback.
METIDOS_TRUSTED_PROXY_PEERS=127.0.0.1

# Optional static web-server share bind host/port for thread-hosted sites.
METIDOS_WEB_SERVER_SHARE_HOST=127.0.0.1
METIDOS_WEB_SERVER_SHARE_PORT=7600
```

Use `.env.example` as the current reference for provider keys, plugin-specific variables, reverse-proxy settings, web-server share settings, and other common runtime knobs. Do not set reverse-proxy or public-host variables unless you are intentionally exposing Metidos through a trusted proxy or private network.

When `METIDOS_APP_DATA_DIR` is omitted, Metidos chooses an OS app-data location:

- macOS: `~/Library/Application Support/.metidos`
- Windows: `%APPDATA%/.metidos`
- Linux/Unix: `${XDG_DATA_HOME:-~/.local/share}/.metidos`

App Data stores SQLite databases, auth secrets, Pi session state, plugin installations, plugin `.data`, plugin `.logs`, settings, and optional telemetry sidecar data. Treat it as private.

## First-run auth setup

On first browser launch, complete Local Auth setup for the Local Operator:

1. Choose the primary factor requested by the UI.
2. Enroll TOTP when prompted.
3. Save recovery codes privately.
4. Sign in and confirm the Mainview opens.

Auth reset commands are documented in [Operator runbook](./operator-runbook.md). Password/PIN resets revoke auth sessions; they are not a substitute for terminating already-running OS processes.

## Provider setup

Metidos can use built-in Pi providers and plugin-backed providers.

Safe setup rules:

- Use `.env` or Plugin Settings for real secrets, never tracked docs.
- Prefer Plugin Settings when a plugin owns the credential lifecycle.
- Use placeholder values in examples and issue reports.
- Confirm local/private provider endpoints are reachable from the Metidos process or container.

See [Model providers](./model-providers.md).

## Local production workflow

```bash
bun install --frozen-lockfile
bun run start
```

Use this when you want a production bundle from the current checkout. `bun run start` builds the Tailwind/Mainview assets, syncs core plugins, and starts the Bun backend.

Use telemetry only when needed:

```bash
bun run start:telemetry
```

Telemetry data is local runtime diagnostics output. Do not commit telemetry databases or logs.

## Container workflow

Container support should be explicit and plan-driven. See [`deploy/podman/README.md`](../deploy/podman/README.md) for a complete rootless Podman example.

1. Choose Docker or Podman.
2. Mount a durable App Data directory.
3. Mount only project directories Metidos should access.
4. Pass secrets through env or secret-management facilities.
5. Bind the Bun port to loopback unless a trusted reverse proxy is in front.
6. Record the final plan in `metidos-config.md` without secret values.

Podman helpers and example commands are in [Operator runbook](./operator-runbook.md). If your local deployment uses a private compose file, keep it ignored and commit only sanitized examples/templates.

## Reverse proxy, TLS, and remote access

Remote access is advanced. Prefer localhost until local auth, providers, and project boundaries are understood.

When exposing through a reverse proxy:

- terminate TLS at the proxy,
- set `METIDOS_PUBLIC_ORIGIN` to the exact browser origin,
- set `METIDOS_ALLOWED_WS_ORIGINS` when additional origins are required,
- set `METIDOS_TRUST_PROXY=true` only if the proxy is the only public path to Bun and overwrites forwarded headers,
- forward WebSocket upgrades for `/rpc`,
- keep the backend bound to loopback where possible.

For Tailscale-style access, use the DNS name that matches `METIDOS_PUBLIC_ORIGIN`, not the raw private-network IP.

## Backup, restore, and reset

Back up:

- App Data directory,
- private `.env` or secret-manager configuration,
- any container deployment plan such as `metidos-config.md` with secrets omitted,
- project repositories through normal Git remotes or local backups.

Restore:

1. Stop Metidos.
2. Restore App Data to the same path or set `METIDOS_APP_DATA_DIR` to the restored path.
3. Restore private env/secret configuration.
4. Start Metidos and sign in.
5. Re-approve plugins if source or review hashes changed.

Reset options:

- Use auth reset commands for Local Auth recovery.
- Use Reset Plugin Data for corrupted plugin-owned derived state.
- Use `--wipe-user-data` only as a destructive local maintenance action after backup decisions are explicit.

## Validation after install

```bash
bun run validate
```

For a narrower smoke check:

```bash
bun run typecheck
bun run test
bun run style:check
bun run toml:check
```

Docs-only edits may not need full validation, but public install claims should be verified from a clean checkout before release.
