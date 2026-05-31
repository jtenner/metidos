# Metidos installation and first-run tutorial

This is the canonical human setup guide for Metidos. Keep step-by-step install, first-run tutorial, and operator setup details here; keep the project README as a concise overview.

For the interactive, plan-first installer workflow, use [`.pi/skills/metidos-installation/SKILL.md`](.pi/skills/metidos-installation/SKILL.md). The wizard should ask questions, build a plan, export `metidos-config.md` without raw secrets, and apply host changes only after explicit approval.

## Choose your path

| Goal | Start here |
| --- | --- |
| Try Metidos from a clean checkout | [Quick start: clean clone to first Thread](#quick-start-clean-clone-to-first-thread) |
| Understand supported run modes | [Install reference](#install-reference) |
| Plan Docker, Podman, reverse proxy, Tailscale, providers, or integrations | [Installer skill](.pi/skills/metidos-installation/SKILL.md) plus the relevant reference sections below |
| Debug a broken setup | [Troubleshooting](docs/troubleshooting.md) |
| Operate an existing install | [Operator runbook](docs/operator-runbook.md) |

## Quick start: clean clone to first Thread

This tutorial gets you from a clean clone to a useful local session: install dependencies, start Metidos, finish first-run auth, add a Project, start a Thread, and review the resulting diff.

### Prerequisites

- Git.
- Bun matching the repository package-manager declaration.
- A modern browser.
- At least one model provider credential or a local/private provider such as Ollama. You can open the UI without a provider, but agent turns need a configured model.

Check the required Bun version from the repository:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
```

If the versions differ, install the Bun version printed by `package.json` before debugging application behavior.

### 1. Clone and install dependencies

```bash
git clone https://github.com/YOUR_ORG_OR_USER/metidos.git
cd metidos
bun install --frozen-lockfile
```

Do not copy local `.env`, App Data, app databases, plugin `.data`, logs, or other ignored runtime state from another machine. A clean clone should rely only on tracked source plus placeholder configuration.

### 2. Create safe local configuration

```bash
cp .env.example .env
```

Edit `.env` with values for your machine. For a localhost-only first run, leave reverse-proxy and public-origin settings unset or commented. Keep secrets out of screenshots, commits, logs, and issue reports.

Useful first-run values:

```bash
# Optional explicit app-data root. If omitted, Metidos uses the OS app-data location.
METIDOS_APP_DATA_DIR=/absolute/path/to/local/metidos-app-data

# Optional local port. If omitted, Metidos uses its default.
METIDOS_PORT=7599

# Optional provider keys. Use real values only in your private .env file.
OPENAI_API_KEY=replace-with-your-key
ANTHROPIC_API_KEY=replace-with-your-key
OPENROUTER_API_KEY=replace-with-your-key
```

`METIDOS_APP_DATA_DIR` stores local databases, auth material, Pi runtime sessions, plugin installations, plugin data, logs, and optional telemetry. Do not put it inside a repository you commit.

### 3. Start Metidos

Development supervisor:

```bash
bun run dev
```

Open the printed localhost URL in your browser. The default URL is `http://localhost:7599`.

For backend dev-mode reload/fallback behavior while developing Metidos itself:

```bash
METIDOS_DEV=1 bun run dev
```

For a production-style local run from the checkout:

```bash
bun run start
```

Use `bun run start:tls` only when a trusted reverse proxy terminates HTTPS and forwards to Bun.

### 4. Finish first-run Local Auth

On first launch, Metidos creates Local Auth for the Local Operator. Follow the browser prompts to configure:

- a primary factor, such as a PIN or password,
- TOTP enrollment when prompted,
- recovery codes.

Save recovery codes somewhere private. Do not paste primary factors, TOTP secrets, recovery codes, cookies, WebSocket tickets, or `.env` contents into GitHub issues or chat.

### 5. Configure a model provider

Open Settings and configure the provider or plugin-backed provider you want to use. Use placeholder examples in docs and real values only in your private local configuration.

If you added provider keys to `.env`, restart Metidos so they are picked up.

For local/private providers, confirm the provider endpoint is reachable from the Metidos process. For plugin-backed providers, approve the plugin before expecting it in the model catalog.

See [Model providers](docs/model-providers.md) for details.

### 6. Add your first Project

1. In Mainview, choose the Project/Worktree area and add a project folder.
2. Select a Git Worktree for that Project.
3. Confirm the displayed path is the intended working tree before starting agent work.

Metidos treats a **Project** as the high-level entry point and a **Worktree** as the concrete Git checkout context used by tools and Threads.

### 7. Start your first Thread

1. Select the Project and Worktree.
2. Choose a provider-qualified model from the model selector.
3. Leave **Unsafe Mode** off for the first run.
4. Type a small request, for example: "Inspect this repository and summarize the test commands. Do not edit files."
5. Send the message and watch the Thread status.

A **Thread** is a Pi-powered agent execution session attached to the selected Project and Worktree. Each response cycle is a **Turn**.

### 8. Review diffs before keeping changes

If the agent edits files:

1. Open the diff workspace.
2. Review changed, added, deleted, renamed, and binary-file entries.
3. Use normal Git commands outside Metidos, or Git tools inside an authorized Thread, to commit only what you intend to keep.

### 9. Try scheduled work later

After the first interactive Thread works, try a small Cron Job in the cron workspace:

- give it a clear title,
- select the Project and Worktree,
- use a conservative schedule,
- keep Unsafe Mode off unless the job truly needs it,
- use Run now once before relying on the schedule.

See [Cron jobs](docs/cron.md).

### First-run smoke checklist

- [ ] `bun --version` matches `package.json`.
- [ ] `bun install --frozen-lockfile` succeeds from a clean clone.
- [ ] `bun run dev` or `bun run start` prints a local URL.
- [ ] First-run auth completes and recovery codes are saved privately.
- [ ] A provider appears in the model catalog.
- [ ] A Project and Worktree can be opened.
- [ ] A safe Thread can run and settle.
- [ ] Diff review shows expected file changes.

## Install reference

Metidos is intended to run as a local, operator-owned application.

### Supported install shapes

| Shape | Use when | Command |
| --- | --- | --- |
| Local development | You are changing source or using a live checkout. | `bun run dev` (`METIDOS_DEV=1 bun run dev` for backend dev-mode reload/fallback behavior) |
| Local production-style | You want the normal built UI and server from a checkout. | `bun run start` |
| Reverse-proxy TLS | Metidos treats the public transport as HTTPS/wss while a trusted proxy handles certificates. Bun still listens on loopback HTTP. | `bun run start:tls` |
| Telemetry sidecar | You need local runtime diagnostics snapshots. | `bun run start:telemetry` or `bun run start:tls:telemetry` |
| Container | You want an isolated runtime with explicit mounts and env. | Use the checked-in deploy examples or the installer skill. |

### Required software

- Git.
- Bun matching `package.json` `packageManager`.
- A browser.
- Optional: Docker or Podman for container installs.
- Optional: provider CLIs or local model servers depending on selected providers.

If the package manager says `bun@1.3.13`, use Bun `1.3.13` for reproducible installs and validation.

### Configuration files and App Data

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

### Provider setup

Metidos can use built-in Pi providers and plugin-backed providers.

Safe setup rules:

- Use `.env` or Plugin Settings for real secrets, never tracked docs.
- Prefer Plugin Settings when a plugin owns the credential lifecycle.
- Use placeholder values in examples and issue reports.
- Confirm local/private provider endpoints are reachable from the Metidos process or container.

See [Model providers](docs/model-providers.md).

### Local production workflow

Use this when you want a production bundle from the current checkout:

```bash
bun install --frozen-lockfile
bun run start
```

`bun run start` builds the Tailwind/Mainview assets, syncs core plugins, and starts the Bun backend.

Use telemetry only when needed:

```bash
bun run start:telemetry
```

Telemetry data is local runtime diagnostics output. Do not commit telemetry databases or logs.

### Container workflow

Container support should be explicit and plan-driven. Use the installer skill for guided Docker/Podman decisions, or see [`deploy/podman/README.md`](deploy/podman/README.md) for a complete rootless Podman example.

1. Choose Docker or Podman.
2. Mount a durable App Data directory.
3. Mount only project directories Metidos should access.
4. Pass secrets through env or secret-management facilities.
5. Bind the Bun port to loopback unless a trusted reverse proxy is in front.
6. Record the final plan in `metidos-config.md` without secret values.

Podman helpers and example commands are in [Operator runbook](docs/operator-runbook.md). If your local deployment uses a private compose file, keep it ignored and commit only sanitized examples/templates.

### Reverse proxy, TLS, and remote access

Remote access is advanced. Prefer localhost until local auth, providers, and project boundaries are understood.

When exposing through a reverse proxy:

- terminate TLS at the proxy,
- set `METIDOS_PUBLIC_ORIGIN` to the exact browser origin,
- set `METIDOS_ALLOWED_WS_ORIGINS` when additional origins are required,
- set `METIDOS_TRUST_PROXY=true` only if the proxy is the only public path to Bun and overwrites forwarded headers,
- forward WebSocket upgrades for `/rpc`,
- keep the backend bound to loopback where possible.

For Tailscale-style access, use the DNS name that matches `METIDOS_PUBLIC_ORIGIN`, not the raw private-network IP.

### Backup, restore, and reset

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

Auth reset commands are documented in [Operator runbook](docs/operator-runbook.md). Password/PIN resets revoke auth sessions; they are not a substitute for terminating already-running OS processes.

### Validation after install

Full validation:

```bash
bun run validate
```

Narrower smoke checks:

```bash
bun run typecheck
bun run test
bun run style:check
bun run toml:check
```

Docs-only edits may not need full validation, but public install claims should be verified from a clean checkout before release.
