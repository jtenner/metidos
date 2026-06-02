# Package Script Reference Audit

Summary: On 2026-06-01, repository documentation, workflows, templates, and checked-in package manifests were scanned for `bun run`, `npm run`, `pnpm run`, and `yarn run` script references. All current script-like references resolve to a package script in the relevant package, except references that intentionally execute a file path such as `bun run src/bun/start.ts` or `bun run native/.../build.ts`.

## Scope

Scanned text files with `.md`, `.yml`, `.yaml`, and `.json` extensions, excluding ignored or derived local state such as `.git`, `node_modules`, `.metidos`, `.metidos-build`, and `.tmp`.

Relevant package manifests:

- Root `package.json`
- `src/mainview/getdown/package.json`

## Observed current state

Root documentation and workflow references resolve to existing root scripts including:

- `dev`
- `start`
- `start:telemetry`
- `start:tls`
- `start:tls:telemetry`
- `validate`
- `format`
- `typecheck`
- `test`
- `style:check`
- `style:check:strict`
- `a11y:check`
- `a11y:check:strict`
- `toml:check`
- `toml:format`
- `tailwind:build`
- `sync:core-plugins`
- `auth:reset`
- `audit:log`
- `harness:starvation`
- `benchmark:metidos-tools`
- `build:dev`
- `build:prod`
- `website:build`
- `website:watch`

The nested Getdown package documentation resolves to existing scripts in `src/mainview/getdown/package.json`:

- `test`
- `typecheck`
- `perf:baseline`
- `perf:baseline:save`

## Not treated as missing package scripts

Several matches are direct Bun file execution rather than package script references, for example:

- `bun run src/bun/start.ts`
- `bun run src/bun/index.ts`
- `bun run native/sqlite-security-extension/build.ts`
- `bun run deploy/podman/migrate-app-data.ts`
- `bun run perf/baseline.tsx`

A historical wiki-log sentence mentions that `bun run test:a11y` does not exist. That sentence is not an instruction to run the missing script; it records the prior documentation correction.

## Validation performed

- Parsed `package.json` script names.
- Parsed `src/mainview/getdown/package.json` script names.
- Searched documentation, workflows, templates, and package manifests for package-manager `run` references.
- Re-ran the scanner with ignored/derived directories excluded and found 233 script-like references with 0 unresolved package-script names.
- Manually reviewed apparent missing matches and classified path executions separately from package script names.

## Remaining follow-up

This audit verified that referenced package-script names exist. It did not execute every referenced script, because scripts such as `dev`, `start`, watch modes, TLS startup, native builds, and migration commands are environment-dependent or long-running. The remaining open-source readiness work should smoke-run representative documented commands in a clean setup and record exact outcomes.
