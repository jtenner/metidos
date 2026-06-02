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

## Script execution smoke run on current checkout

On 2026-06-02, the following root package scripts were smoke-run from the existing workspace checkout with a 120-second per-script timeout:

- `bun run tailwind:build` passed; Tailwind CSS v4.3.0 reported completion in 207ms.
- `bun run website:build` passed; Tailwind CSS v4.3.0 reported completion in 185ms.
- `bun run sync:core-plugins` passed and synced the checked-in core plugins into the local app-data plugin directory.
- `bun run toml:check` passed; Taplo found 11 TOML files and 2 excluded files for both format-check and lint phases.
- `bun run style:check` passed with `STYLE.md enforcement: no violations found.`
- `bun run a11y:check` passed after scanning 154 files with 0 errors and 0 warnings.
- `bun run typecheck` initially failed on two strict test typing errors in `src/bun/domain-stores.test.ts` and `src/bun/plugin/quickjs-runtime.test.ts`; those test typings were tightened and a rerun passed.
- `bun run test` passed after the typing fixes: 2416 tests passed across 287 files with 0 failures.

This was not a clean-clone validation. It is a preflight smoke run from the active development checkout to identify immediate blockers before doing the clean setup pass.

## Long-running script validation decision

For clean-clone validation, the repository should not treat indefinitely running scripts as pass/fail commands that must terminate naturally. Instead, validate them with bounded smoke checks or explicitly exclude them when they require local state that is outside the clean-clone contract.

Recommended clean-clone handling:

- `bun run dev`: smoke-run with a short timeout and count it as passing only if the development supervisor reaches its normal startup/watch state without an immediate error. Capture the timeout used and the first readiness/error lines.
- `bun run start`: smoke-run with a short timeout and count it as passing only if the production-style server reaches its normal listening state without an immediate error. Capture the timeout used, port/config prerequisites, and readiness/error lines.
- `bun run start:telemetry`: exclude from routine clean-clone validation unless telemetry prerequisites and consent/configuration are intentionally part of the test environment; document it as covered by the same startup path as `start` plus telemetry configuration review.
- `bun run start:tls` and `bun run start:tls:telemetry`: exclude from routine clean-clone validation unless disposable TLS credentials are generated during the test. If tested, record the certificate-generation command, environment variables, timeout, and readiness/error lines.
- `bun run tailwind:watch` and `bun run website:watch`: smoke-run with a short timeout and count them as passing only if the watcher starts and performs the initial build without an immediate error. Capture the timeout and initial build output.
- `bun run dev:watch`: do not validate separately because it aliases `bun run dev`; reference the `dev` smoke result.

The clean-clone result log should state that watch/start scripts are long-running by design and that a timeout is expected after readiness is observed. A timeout before readiness, or any startup error, should be recorded as a failure with the observed logs.

## Clean checkout Getdown script smoke run

On 2026-06-02, the documented nested Getdown package scripts were smoke-run from a disposable detached Git worktree at `.tmp/getdown-smoke`, with dependencies installed only inside `src/mainview/getdown/` from its checked-in `bun.lock`.

Environment:

- OS: Debian GNU/Linux 13 (trixie)
- Kernel: Linux 6.12.90+deb13.1-amd64 x86_64 GNU/Linux
- Bun: 1.3.13
- Checkout: detached `HEAD` at `c013a07`
- Working directory for commands: `src/mainview/getdown/`

Commands and outcomes:

- `bun install --frozen-lockfile` passed and installed 11 package dependencies from the nested lockfile.
- `bun test` passed: 341 tests across 2 files, 0 failures, 427 assertions.
- `bun run typecheck` passed: `tsc --noEmit` completed without diagnostics.
- `bun run perf:baseline` passed and printed the bounded Getdown internal performance baseline table. No baseline artifact was saved.

This covered the documented `bun test`, `bun run typecheck`, and bounded performance baseline path for the nested package from a disposable checkout. It did not run `bun run perf:baseline:save`, because that command intentionally creates a timestamped JSON snapshot under `perf/baselines/` and is only needed when updating stored performance data.

## Clean disposable checkout root script smoke run

On 2026-06-02, representative documented root package scripts were smoke-run from a disposable detached Git worktree at `.tmp/root-script-smoke`, with root dependencies installed from the checked-in `bun.lock`. `METIDOS_APP_DATA_DIR` was set to `.tmp/app-data` inside the disposable worktree before running scripts that write app data.

Environment:

- OS: Debian GNU/Linux 13 (trixie)
- Kernel: Linux 6.12.90+deb13.1-amd64 x86_64 GNU/Linux
- Bun: 1.3.13
- Checkout: detached `HEAD` at `4f144c1`
- Working directory for commands: repository root

Commands and outcomes:

- `bun install --frozen-lockfile` passed and installed 473 packages.
- `bun run tailwind:build` passed; Tailwind CSS v4.3.0 reported completion in 192ms.
- `bun run website:build` passed; Tailwind CSS v4.3.0 reported completion in 186ms.
- `bun run sync:core-plugins` passed and synced core plugins to the disposable `.tmp/app-data/plugins` directory.
- `bun run toml:check` passed; Taplo found 11 TOML files and 2 excluded files for both format-check and lint phases.
- `bun run style:check` passed with `STYLE.md enforcement: no violations found.`
- `bun run a11y:check` failed with 5 `input-name` errors in `src/mainview/controls/input.tsx`; the checker flagged shared `<input {...props}>` primitive definitions that do not declare a static `id`, `title`, `aria-label`, or `aria-labelledby` at the primitive site.
- `bun run typecheck` failed with strict test typing errors in `src/bun/project-procedures.cron.test.ts` where two `RpcRequestContext` fixtures were missing `priority` and `timeoutMs`, and in `src/bun/rpc-handlers/terminal.test.ts` where the `AuthServiceError` test fixture call omitted the required HTTP status argument.
- `bun run test` failed with 5 failures across 2471 tests. Four failures were caused by the missing generated xmloxide WASM bundle/artifact in a clean checkout; `bun run build:xmloxide-wasm` subsequently passed and a targeted rerun of the XML-dependent plugin runtime tests passed. One full-suite failure remained in `src/bun/plugin/sidecar-manager.test.ts` for the crash-loop degraded-status retry scenario.
- `bun run build:xmloxide-wasm` passed after the initial `test` failure and wrote `native/xmloxide-wasm/dist/metidos_xmloxide_wasm.wasm` and `.cjs` in the disposable checkout.

Follow-up work created from this smoke run:

- Decide whether `a11y:check` should understand shared form-control primitives with prop-spread naming, or whether the primitives should enforce/require names at their API boundary.
- Fix stale strict typings in the cron and terminal RPC test fixtures so a clean checkout passes `bun run typecheck`.
- Make the clean-checkout `test` path build or otherwise provide the xmloxide WASM artifact before XML-dependent tests run.
- Re-run the full test suite after the xmloxide prerequisite is satisfied and investigate the remaining sidecar crash-loop degraded-status failure.

## Remaining follow-up

This audit verified that referenced package-script names exist, includes a current-checkout smoke run for representative root scripts, includes a clean-checkout smoke run for the nested Getdown scripts, and now records a clean disposable checkout smoke run for representative root build/check/test scripts. It has not executed every referenced root script, because scripts such as `dev`, `start`, watch modes, TLS startup, native builds beyond `build:xmloxide-wasm`, and migration commands are environment-dependent or long-running. The remaining open-source readiness work should use the bounded handling above for long-running watch/start scripts.
