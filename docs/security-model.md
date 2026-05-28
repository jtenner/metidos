# Security model

Metidos is a local, operator-owned application that can run agent code, inspect projects, call providers, run approved plugins, and schedule future work. Treat it as powerful local development software, not as a multi-tenant hosted service.

## Core principles

- The Local Operator is the single authenticated owner of one installation.
- Backend is authoritative for auth, path scope, plugin lifecycle, provider auth, and unsafe permissions.
- Mainview presents choices but does not grant security-sensitive capabilities by itself.
- Safe Mode is the default posture for Threads and Cron Jobs.
- Unsafe Mode, plugin approval, private network access, and code execution require explicit local-operator intent.
- Secrets and private runtime state live outside tracked source.

## Local Auth

Local Auth protects browser access to one installation. It includes:

- first-run setup,
- primary factor verification,
- TOTP enrollment,
- recovery codes,
- authenticated Sessions,
- WebSocket Tickets for `/rpc`,
- step-up authentication for selected sensitive actions.

A WebSocket Ticket is short-lived and is consumed during `/rpc` upgrade. The Backend revalidates the Session for each non-terminal RPC message.

Step-up authentication is required before plugin actions that approve or execute plugin code, such as Enable, Re-approve, Retry Plugin, and Run Plugin GC.

## Secrets

Secrets may include:

- provider API keys,
- OAuth access/refresh tokens,
- TOTP secrets,
- recovery codes,
- browser cookies,
- WebSocket tickets,
- `.env` contents,
- plugin secret settings,
- private repo URLs,
- local database files,
- unredacted logs.

Storage rules:

- Real values belong in private `.env`, Plugin Settings, provider auth stores, or App Data.
- `.env.example` and docs must use placeholders only.
- Diagnostics and logs should redact known sensitive values where Backend controls the output.
- Plugin-authored logs/tool results are not automatically safe; review plugin behavior before sharing.
- Do not paste secrets or raw App Data into GitHub issues.

## Safe issue reporting

When filing issues, include:

- OS and version,
- Bun version,
- Metidos version or commit,
- command you ran,
- expected behavior,
- actual behavior,
- sanitized logs,
- screenshots with fake/demo data or redacted sensitive parts.

Never include:

- API keys or OAuth tokens,
- recovery codes or TOTP secrets,
- cookies, session ids, or WebSocket tickets,
- full `.env` files,
- private repository URLs,
- local database files,
- plugin `.data` or `.logs` with unknown contents,
- screenshots showing usernames, hostnames, internal repos, local absolute paths, branch names, customer data, or tokens.

## Plugins

Plugin System v1 is local and review-first. Security controls include:

- side-effect-free discovery,
- required manifest and `AGENTS.md`,
- deterministic review hash,
- operator approval before activation,
- step-up for approval/execution-sensitive actions,
- manifest-declared permissions,
- access groups for thread-visible tools,
- per-plugin sidecars,
- settings validation and secret redaction,
- storage quotas,
- lifecycle states for failed/degraded/disabled/missing plugins.

Review plugin permissions, file/network allowlists, settings, environment declarations, and `AGENTS.md` before approval. Re-review after source changes.

## Filesystem boundaries

Backend owns Workspace Path Scope. It normalizes paths, opens Projects and Worktrees, and constrains worktree-bound tools.

Plugin filesystem APIs use virtual roots:

- `~/` for plugin-owned `.data`,
- `./` for current worktree access when allowed.

Protections include traversal rejection, symlink escape checks, realpath containment, hard denies for sensitive paths such as `.git` and `.ssh`, and plugin-visible sanitized errors.

Unsafe Mode can broaden runtime capabilities. Enable it only for Threads or Cron Jobs that truly require shell or unsafe escalation.

## Network boundaries

Network access depends on the capability:

- Model provider calls use configured Provider Auth and provider endpoints.
- Plugin fetch/websocket calls require manifest permissions and allowlists.
- Reverse proxy access must pass origin and WebSocket checks.
- Thread-hosted web servers are project-scoped and mediated by share-worker behavior.

Prefer HTTPS/WSS. Treat localhost/private-network endpoints as sensitive because they may expose internal services. Allow broad or private network access only for plugins and providers you trust.

## Remote access, reverse proxy, and TLS

Remote access is advanced. For reverse-proxy deployments:

- terminate TLS at the proxy,
- forward WebSocket upgrades for `/rpc`,
- set `METIDOS_PUBLIC_ORIGIN` exactly to the browser-facing origin,
- set `METIDOS_ALLOWED_WS_ORIGINS` only for additional legitimate origins,
- set `METIDOS_TRUST_PROXY=true` only when a trusted proxy is the only public path to Bun and overwrites forwarded headers,
- keep Bun bound to loopback where possible,
- prefer Tailscale or equivalent private access over public exposure for early deployments.

`bun run start:tls` tells Metidos it is operating behind TLS termination; it does not itself terminate TLS.

## Cron safety

Cron Jobs run future agent work. Use conservative defaults:

- choose specific Project and Worktree targets,
- keep prompts narrow and idempotent,
- start in Safe Mode,
- use Run now before relying on a schedule,
- disable jobs before changing provider or plugin assumptions,
- inspect failures and child Threads.

Safe Cron Jobs cannot create unsafe child Threads or unsafe Cron Jobs unless explicitly authorized through the unsafe flow.

## Backups and restore

Back up App Data and private config before destructive actions. Protect backups as sensitive because they may contain auth material, provider credentials, plugin data, logs, and thread history.

Do not publish backups or attach them to issues. If a maintainer needs a reproduction, create a small fake-data fixture instead.

## Security-sensitive errors

Good errors are actionable without exposing secrets. Prefer messages that state:

- what failed,
- which high-level resource was involved,
- what the operator can do next,
- whether reauth, provider config, plugin review, or path selection is needed.

Avoid raw keys, tokens, absolute private paths, full request headers, unredacted environment variables, or database contents.

## More detail

See [Security threat model](./security/threat-model.md) for assets, trust boundaries, attacker capabilities, abuse cases, and mitigations.
