# Development

This guide covers local development setup, validation, tests, code style, documentation workflow, and debugging for contributors.

## Setup

Use [`../INSTALLATION.md`](../INSTALLATION.md) for the clean-clone install path, first-run Local Auth, provider setup, and local run modes. This contributor guide starts after that environment exists.

Keep private values in `.env`. Do not commit `.env`, App Data, plugin runtime output, logs, or generated bundles.

## Repository orientation

- `src/bun/` — Backend, persistence, Git, RPC handlers, auth, plugins, cron, terminal, Pi runtime, and diagnostics.
- `src/mainview/` — React/Tailwind Mainview.
- `core_plugins/` — first-party plugin source synced into App Data on startup.
- `docs/` — public operator/contributor docs and design references.
- `.wiki/` — durable project knowledge and research notes.
- `.pi/skills/` — repo-local agent skills.
- `STYLE.md` — UI style source of truth.
- `UBIQUITOUS_LANGUAGE.md` — canonical terminology.

## Common commands

```bash
bun run dev                 # local development supervisor (Tailwind watch + backend)
METIDOS_DEV=1 bun run dev   # local development with backend dev-mode reload/fallback behavior
bun run start               # production-style local server
bun run build:dev           # development Mainview bundle
bun run build:prod          # production Mainview bundle
bun run tailwind:build      # rebuild generated CSS
bun run typecheck           # TypeScript checks
bun run test                # full test suite
bun run style:check         # Mainview style enforcement
bun run toml:check          # TOML format/lint checks
bun run format              # format code/TOML
bun run validate            # full validation gate
```

## Validation policy

Use the narrowest command while iterating, then run the broader command before handing off a behavior change.

Recommended gates:

- Docs only: inspect links and formatting; full validation may be unnecessary.
- Backend behavior: `bun run typecheck`, relevant `bun test ...`, then `bun run validate`.
- Mainview behavior: `bun run style:check`, relevant `bun test ...`, `bun run typecheck`, then `bun run validate`.
- Plugin system: manifest/schema tests, plugin-focused tests, relevant example validation, then `bun run validate`.
- Release/public docs: clean-clone install and `bun run validate`.

## Code style

- Use existing patterns before adding new abstractions.
- Keep Backend security decisions on Backend.
- Keep Mainview UI decisions aligned with `STYLE.md`.
- Use canonical terms from `UBIQUITOUS_LANGUAGE.md`.
- Prefer focused modules and pure helpers when extracting complex logic.
- Add telemetry or counters for new RPC/runtime features when practical.

## UI workflow

Before UI work:

1. Read `STYLE.md`.
2. Read `src/mainview/app/README.md` for the relevant module.
3. Identify the controller/hook/state seam that should own the change.
4. Add focused tests for pure state and controller helpers where feasible.
5. Run `bun run style:check`.

## Backend workflow

Before Backend work:

1. Identify the owning module under `src/bun/`.
2. Check `src/bun/README.md` for module responsibilities.
3. Keep auth/path/plugin/provider/unsafe checks server-side.
4. Add focused tests around validation, authorization, and failure paths.
5. Run relevant `bun test` files and `bun run typecheck`.

## Documentation workflow

When docs change:

- use generic placeholders instead of personal paths or hostnames,
- link to canonical docs rather than duplicating long procedures,
- keep examples secret-free,
- update `docs/README.md` when adding a new public doc,
- update `UBIQUITOUS_LANGUAGE.md` only when terminology changes,
- keep `.wiki/**` in sync when durable project knowledge changes,
- check links after adding or renaming docs.

## Debugging tips

### Backend startup

- Check Bun version.
- Check `.env` values and `METIDOS_APP_DATA_DIR` writability.
- Rebuild Mainview assets with `bun run build:dev`.
- Check terminal output for auth, RPC, plugin, or provider startup errors.

### RPC behavior

- Look for session expiration, origin mismatch, request timeout, cancellation, or pending-cap errors.
- Keep request/response shapes aligned with `src/bun/rpc-schema.ts`.
- Review [RPC](./rpc.md) and [Backend RPC transport invariants](./backend-rpc-transport-invariants.md).

### Plugins

- Use Settings -> Plugins inventory and diagnostics first.
- Confirm review hash state.
- Confirm required settings/env values.
- Read the plugin's `AGENTS.md` before data repair.
- Do not inspect or copy plugin data containing secrets unless necessary.

### Providers

- Confirm provider-qualified model IDs.
- Restart after env changes.
- Check plugin provider lifecycle if plugin-backed.
- Confirm local/private endpoints are reachable from the same process/container.

## Commit readiness checklist

- [ ] Change is scoped and reviewable.
- [ ] Tests or validation match the risk level.
- [ ] Docs are updated for user-visible behavior.
- [ ] No secrets, local paths, app data, plugin runtime output, screenshots with private data, or generated artifacts are included.
- [ ] Terminology matches `UBIQUITOUS_LANGUAGE.md`.
