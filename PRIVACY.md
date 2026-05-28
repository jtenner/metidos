# Privacy

Metidos is designed as local, operator-owned developer software. It is not a hosted multi-tenant service.

## Local data

Metidos stores local application state in App Data, including SQLite databases, Local Auth material, Pi runtime sessions, plugin installations, plugin data, plugin logs, settings, and optional local telemetry sidecar data.

Treat App Data as private. Do not commit it, upload it to issues, or share it without review and redaction.

## Provider and plugin data flow

Metidos can send data to model providers, plugin-defined endpoints, browser helpers, notification providers, and other services you configure or approve. What is sent depends on your selected Provider, Thread access controls, plugin permissions, prompts, files, tools, and runtime actions.

Review provider settings, plugin manifests, network allowlists, filesystem allowlists, and Unsafe Mode prompts before enabling access.

## Telemetry and diagnostics

Runtime diagnostics are collected locally for operational visibility. Optional telemetry sidecar mode writes coarse runtime snapshots to a local SQLite sidecar database when started with a telemetry command such as `bun run start:telemetry`.

Telemetry and diagnostics should not include secrets, recovery codes, session tokens, provider keys, or private file contents. Plugin-authored logs and tool output are not automatically safe; review them before sharing.

## Issue reports

When reporting bugs, share only sanitized logs and screenshots. Do not include API keys, OAuth tokens, recovery codes, session cookies, full `.env` files, private repository URLs, local databases, plugin `.data`, plugin `.logs`, or screenshots containing private data.

## Remote access

If you expose Metidos through a reverse proxy, Tailscale-style access path, or other remote setup, you are responsible for protecting that endpoint and understanding what local development data may become reachable.

See [`docs/security-model.md`](docs/security-model.md) for more detail.
