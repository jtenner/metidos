# Dependency Declaration Audit

Summary: On 2026-06-02, the checked-in package manifests and Bun lockfiles were audited for private packages, unpublished/local dependencies, private registry URLs, and machine-specific references. No blocking dependency declaration or lockfile references were found.

## Scope

Observed files:

- `package.json`
- `bun.lock`
- `src/mainview/getdown/package.json`
- `src/mainview/getdown/bun.lock`

Package-manager config files checked and not found:

- `.npmrc`
- `.yarnrc*`
- `pnpm-lock.yaml`
- `package-lock.json`
- `yarn.lock`

## Checks performed

The audit searched package manifests and Bun lockfiles for dependency forms and references that would be unsafe or non-reproducible for a public clone:

- local path dependencies: `file:`, `link:`, `workspace:`
- Git or GitHub dependency specs: `git+`, `github:`
- private registry hints: `registry`, `npm.pkg`
- machine-local host/path references: `localhost`, `127.0.0.1`, `/home/`
- private/internal package scopes likely to be non-public: `@jtenner`, `@metidos`

## Findings

- No local path, workspace, Git, GitHub, private registry, localhost, machine-local path, `@jtenner`, or `@metidos` references were found in the checked manifests or lockfiles.
- The root `package.json` has `"private": true`; this is expected for the application repository package and is not a private dependency declaration.
- `src/mainview/getdown/package.json` has `"private": false`; this package declaration does not reference private package sources.
- The root `patchedDependencies` entry for `@mariozechner/pi-coding-agent@0.73.1` points to a checked-in patch file under `patches/`, not a local machine path or private registry.

## Validation commands

Commands run from the workspace root:

```sh
find . -name package.json
find . -name 'bun.lock*'
grep -R -n -i -E 'file:|link:|workspace:|npm.pkg|github:|git\+|registry|localhost|127\.0\.0\.1|/home/|private|@jtenner|@metidos' -- package.json src/mainview/getdown/package.json
grep -R -n -i -E 'file:|link:|workspace:|npm.pkg|github:|git\+|registry|localhost|127\.0\.0\.1|/home/|@jtenner|@metidos' -- bun.lock src/mainview/getdown/bun.lock
find . -name .npmrc -o -name '.yarnrc*' -o -name pnpm-lock.yaml -o -name package-lock.json -o -name yarn.lock
```

The only manifest matches were expected `private` metadata fields. The lockfile and package-manager config checks found no private or machine-specific dependency sources.

## Follow-up

No dependency-declaration remediation is required from this audit. Future dependency additions should continue avoiding non-public registries, unpublished packages, and local path references unless they are intentionally documented and vendored for public use.
