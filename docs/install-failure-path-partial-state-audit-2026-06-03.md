# Install failure-path partial-state audit — 2026-06-03

## Scope

This note closes the public-readiness slice: verify installation failure paths do not leave behind confusing or unsafe partial state.

It reviews the checked-in install failure-path smoke evidence from 2026-06-02 rather than re-running startup, because the current recurring TODO runtime reports Bun `1.3.13` while `package.json` requires `bun@1.3.14`. Fresh runtime smoke evidence should wait until Bun matches the repository requirement.

## Evidence reviewed

- `docs/install-failure-path-bun-version-smoke-2026-06-02.md`
- `docs/install-failure-path-missing-env-smoke-2026-06-02.md`
- `docs/install-failure-path-unwritable-app-data-smoke-2026-06-02.md`
- `docs/install-failure-path-port-conflict-smoke-2026-06-02.md`
- `docs/install-failure-path-mainview-assets-smoke-2026-06-02.md`

## Findings

### Missing or wrong Bun

Missing Bun fails in the shell before repository scripts run. The repository cannot clean up application state in that path because no application code starts. The install documentation points contributors at `package.json` `packageManager` as the version source of truth.

Partial-state risk: none from Metidos startup.

### Missing `.env`

The missing-`.env` smoke used a disposable checkout and disposable App Data directory. Startup advanced far enough to build generated assets and sync core plugins before the share-worker failure. That side effect is expected startup preparation work inside the selected App Data directory, not an unsafe write to the source checkout or a credential-bearing location.

The prior follow-up improved the share-worker startup error so future failures identify the resolved share host, share port, database path, and underlying startup error.

Partial-state risk: acceptable if contributors use the documented App Data location or an explicit disposable `METIDOS_APP_DATA_DIR`; no credential material is created by this path.

### Unwritable App Data

The unwritable-App-Data smoke forced both configured and fallback App Data paths under `/proc`. Startup exited with a direct error naming both checked paths and instructing the operator to set `METIDOS_APP_DATA_DIR` to a writable directory.

Partial-state risk: low. The failure occurs at App Data resolution/core-plugin sync and points at paths that could not be created.

### Main HTTP port conflict

The port-conflict smoke showed the fixed startup path prints an actionable port-in-use message and performs coordinated shutdown. The evidence specifically records the cron scheduler shutdown message before process exit.

Partial-state risk: low. Background startup work is stopped instead of being left running after the port conflict.

### Missing generated Mainview assets

The missing-Mainview-assets smoke temporarily moved the local `.metidos-build/` directory aside, used disposable App Data and ports, and restored the build directory after the smoke. The documented `bun run start` path regenerated missing generated assets and started successfully.

Partial-state risk: low. The expected source-tree side effect is regeneration of the ignored local build cache; no unsafe partial state remains when the smoke restores the cache.

## Conclusion

The currently documented install failure paths do not show confusing or unsafe partial state:

- failure-path writes are either absent, confined to the configured/disposable App Data directory, or confined to ignored generated build cache;
- the port-conflict path records coordinated background-work shutdown;
- missing Bun cannot create application state because repository scripts never start;
- the only remaining blocker is refreshing smoke evidence after the local runtime is updated to Bun `1.3.14`.

No code change is required for this slice.
