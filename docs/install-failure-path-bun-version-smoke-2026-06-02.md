# Missing Bun / Bun version failure-path smoke — 2026-06-02

This smoke records the bounded install/setup failure-path slice for missing or wrong Bun version messaging before public release.

## Scope

- Workspace: `/home/jtenner/Projects/jt-ide`
- Date: 2026-06-02
- Host OS: Linux `eefe0b53020d` `6.12.90+deb13.1-amd64` x86_64
- Repository requirement source: `package.json` `packageManager`
- No private credentials, app data, browser sessions, or provider configuration were used.

## Commands and results

### Confirm repository-required Bun version

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
```

Result:

- `bun --version` printed `1.3.14`.
- `package.json` printed `bun@1.3.14`.
- The local runtime matches the repository requirement.

### Simulate missing Bun

```bash
env PATH=/usr/bin:/bin bun --version
```

Result:

- Exit status: `127`.
- Output: `env: 'bun': No such file or directory`.
- This is the shell/env failure before Metidos code can run, so the application cannot provide its own error message when `bun` itself is absent.

## Documentation check

`INSTALLATION.md` already tells contributors to verify the required Bun version by running:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
```

It also says to install the Bun version printed by `package.json` before debugging application behavior, and the install reference explicitly names Bun `1.3.14` when `packageManager` is `bun@1.3.14`.

## Outcome

- Missing Bun behavior was smoked with a restricted `PATH` and recorded.
- Wrong-version installation was not recreated by installing an alternate Bun in this workspace; the actionable version source is `package.json` `packageManager`, and the current environment matches it.
- The documented next step is contributor-friendly enough for this slice: install the Bun version declared by `package.json` before running Metidos commands.

## Follow-up

No code change is required for this slice because missing `bun` fails before repository scripts can execute. Future install smoke runs should continue with the remaining failure paths: missing/minimal `.env`, unwritable `METIDOS_APP_DATA_DIR`, and stale/missing Mainview asset recovery.
