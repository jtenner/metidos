# Production Mainview Build Modes

## Summary

This page records the durable `OPT04.1` policy for Metidos mainview builds. **Observed:** `src/bun/build-mainview.ts` now resolves explicit development versus production modes. **Observed:** production builds are minified by default and do not emit sourcemaps unless they are explicitly requested. **Recommended durable rule:** keep development builds debug-friendly and keep production builds lean by default, with production sourcemaps treated as an explicit debugging override rather than the default output.

Related pages:

- [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)

## Problem

Before `OPT04.1`, the frontend build effectively behaved like a debug build in all modes. That left production with avoidable costs:

- unminified `/index.js`
- always-generated external sourcemaps
- no explicit development versus production policy
- no runtime distinction about whether `/index.js.map` should exist or be served

That made later asset-serving and cacheability work harder to reason about because build-mode policy and asset-path policy were mixed together.

## Current state

### Build policy

**Observed:** `src/bun/build-mainview.ts` exports a build-mode resolver and applies the resolved settings to the Bun build call.

Durable policy:

- development mode uses `mode: "development"`
- development mode keeps `minify: false`
- development mode uses `sourcemap: "external"`
- production mode uses `mode: "production"`
- production mode keeps `minify: true`
- production mode defaults to `sourcemap: "none"`
- production sourcemaps are enabled only by explicit opt-in

### Production sourcemap controls

**Observed:** production sourcemaps can be requested through either:

- `METIDOS_MAINVIEW_SOURCEMAP=1`
- `--sourcemap` when running `src/bun/build-mainview.ts` directly

**Observed:** `--no-sourcemap` is the explicit CLI override for disabling sourcemaps.

### Runtime serving behavior

**Observed:** `src/bun/index.ts` now retains the full mainview build result instead of only the bundle path. The server tracks:

- bundle path
- resolved build mode
- whether a sourcemap was emitted
- sourcemap path when present

**Observed:** `/index.js.map` is served only when the current build actually emitted a sourcemap.

That means:

- development builds expose the sourcemap for browser debugging
- default production builds do not expose one
- opt-in production sourcemaps are served only when intentionally enabled

### Cleanup rule

**Observed:** when a build runs without sourcemaps after a prior sourcemap-enabled build, `build-mainview.ts` removes the stale `.metidos-build/index.js.map` file.

This prevents disk leftovers from misrepresenting the current build output.

### Scripts and docs

**Observed:** `package.json` exposes explicit build-intent scripts:

- `bun run build:dev`
- `bun run build:prod`

**Observed:** `README.md` and `src/bun/README.md` document the dev/prod distinction and the production sourcemap opt-in.

## Why this design matters

**Inferred:** this slice intentionally separates build-mode policy from later asset-path work.

Benefits:

- production pays the lower-cost baseline before cacheability changes land
- later asset-path work can focus on cache headers and URL structure instead of also introducing minification policy
- debug affordances stay available in development without making production defaults heavier
- runtime asset serving reflects what the current build actually produced

## Validation

**Observed:** the slice added pure resolver coverage in `src/bun/build-mainview.test.ts`, including:

- production as the default mode
- development mode from CLI flags
- explicit production overriding dev environment settings
- production sourcemap opt-in
- explicit sourcemap opt-out

**Observed:** the source document recorded a local size comparison:

| Build | `index.js` bytes | `index.js.map` bytes |
|---|---:|---:|
| development | `3,265,301` | `5,941,329` |
| production | `1,671,679` | not emitted by default |

**Observed:** the reported production reduction versus the development build was `1,593,622` bytes, about `48.8%`.

**Observed:** validation for the slice included:

- `bun run format`
- `bun run validate`
- a local dev-versus-production build comparison

## Deferred scope

**Observed:** this slice intentionally did not:

- change the browser entrypoint away from `/index.js`
- add hashed asset names
- add cacheable asset subpaths
- enable chunk splitting
- migrate to a different bundler

**Recommended:** keep those concerns in later asset-path or bundling slices so the build-mode policy remains easy to reason about and validate. `OPT04.2` now records the durable versioned asset-path contract in [mainview-cacheable-asset-serving-path](./mainview-cacheable-asset-serving-path.md).

## Affected files

**Observed:** the source document identified these files as the implementation surface:

- `src/bun/build-mainview.ts`
- `src/bun/build-mainview.test.ts`
- `src/bun/index.ts`
- `package.json`
- `README.md`
- `src/bun/README.md`

## Open questions

- When later chunk splitting or hashed assets land, should the versioned asset-root contract stay path-based, shift to filename hashing, or combine both?- When chunk splitting or hashed assets land, should sourcemap serving stay route-based or move to a more general static-asset policy?
