# 2026-04-11 OPT04.1 Production Mainview Build Modes

**Status:** completed on 2026-04-11  
**Slice:** [OPT04.1](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)

## Summary

`OPT04.1` adds an explicit mainview build-mode policy instead of letting every frontend build behave like a debug build.

After this slice:

- **development** builds stay readable and keep external sourcemaps,
- **production** builds are minified by default,
- **production** no longer emits sourcemaps unless they are explicitly requested,
- the Bun server now serves `/index.js.map` only when the current build actually emitted one.

This lands the first half of the `OPT04` track without changing the asset path or introducing code splitting yet.

## Scope of the slice

Per the execution plan, this slice needed to:

- add explicit dev/prod build mode behavior,
- minify the production bundle,
- stop always emitting production sourcemaps unless explicitly requested.

This slice intentionally did **not**:

- change the browser entrypoint away from `/index.js`,
- add hashed asset names,
- add cacheable asset subpaths,
- turn on chunk splitting,
- migrate the build to another bundler.

Those remain `OPT04.2` and `OPT04.3` work.

## What changed

## 1. `build-mainview.ts` now resolves explicit build modes

Updated file:

- [src/bun/build-mainview.ts](../src/bun/build-mainview.ts)

The module now exports a small build-mode resolver:

- `resolveMainviewBuildOptions(...)`

and applies that resolution to the Bun build call.

### Current policy

#### Development mode

- `mode: "development"`
- `minify: false`
- `sourcemap: "external"`

#### Production mode

- `mode: "production"`
- `minify: true`
- `sourcemap: "none"` by default
- `sourcemap: "external"` only when explicitly requested

### Sourcemap opt-in

Production sourcemaps can now be enabled intentionally through:

- `METIDOS_MAINVIEW_SOURCEMAP=1`
- or `--sourcemap` when running `src/bun/build-mainview.ts` directly

There is also a matching `--no-sourcemap` override for explicit CLI opt-out.

## 2. The runtime server now tracks whether a sourcemap exists

Updated file:

- [src/bun/index.ts](../src/bun/index.ts)

The server previously always served `/index.js`, but it did not distinguish whether the current build emitted a sourcemap.

Now the startup and rebuild path keeps the full mainview build result, including:

- bundle path,
- build mode,
- whether a sourcemap was emitted,
- sourcemap path when present.

That allowed the server to add a narrow new route:

- `/index.js.map`

served **only** when the current build emitted a sourcemap.

That means:

- dev builds expose the sourcemap for real browser debugging,
- production defaults do not expose one,
- production opt-in sourcemaps are served only when intentionally enabled.

## 3. Production builds now clean up stale sourcemaps

When a non-sourcemap build runs after a previous sourcemap-enabled build, `build-mainview.ts` now deletes the old `index.js.map` file from `.metidos-build/`.

That matters because otherwise a stale development sourcemap could remain on disk and confuse later inspection even though the current production build did not emit one.

## 4. Package scripts now expose explicit build intent

Updated file:

- [package.json](../package.json)

The relevant scripts are now:

- `bun run build:dev`
- `bun run build:prod`

with `build:dev` explicitly passing `--dev` and `build:prod` explicitly passing `--production`.

That makes the frontend build mode obvious instead of implicit.

## 5. Documentation was updated for the new build policy

Updated files:

- [README.md](../README.md)
- [src/bun/README.md](../src/bun/README.md)

These now document:

- the new `build:prod` script,
- the fact that development and production builds differ intentionally,
- the `METIDOS_MAINVIEW_SOURCEMAP=1` opt-in for production debugging.

## Test coverage added

New file:

- [src/bun/build-mainview.test.ts](../src/bun/build-mainview.test.ts)

This covers the new pure build-mode resolver, including:

- production as the default,
- development mode from CLI flags,
- explicit production overriding dev env,
- production sourcemap opt-in,
- explicit sourcemap opt-out even in development mode.

## Measured result

A local bundle comparison was run after this slice using the current app entrypoint.

### Commands used

```bash
bun run src/bun/build-mainview.ts --dev
bun run src/bun/build-mainview.ts --production
```

### Observed bundle sizes

| Build | `index.js` bytes | `index.js.map` bytes |
|---|---:|---:|
| development | `3,265,301` | `5,941,329` |
| production | `1,671,679` | not emitted by default |

### Production reduction versus development build

- JavaScript bundle reduction: `1,593,622` bytes
- Relative reduction: about `48.8%`

### Additional validation point

After the default production build, `.metidos-build/index.js.map` no longer existed, confirming that:

- production sourcemaps are no longer emitted by default,
- stale sourcemaps are removed when switching from a sourcemap-enabled build to the default production mode.

## Why this slice was worth doing before asset-path work

The repo previously paid the production cost of:

- an unminified bundle,
- an always-generated external sourcemap,
- extra build output on disk,
- no intentional dev/prod distinction.

`OPT04.1` fixes those basics first, which keeps `OPT04.2` narrower:

- asset-path work can now focus on cacheability and serving behavior,
- not on also introducing minification policy at the same time.

## What stayed intentionally unchanged

To keep the slice atomic and evidence-led, this change does **not**:

- alter `src/mainview/index.html`,
- move assets under a new allowlisted prefix,
- add immutable-cache headers,
- enable chunk splitting,
- change the browser bootstrap contract away from `/index.js`.

Those are explicitly deferred to later `OPT04` slices.

## Files changed by the slice

- [src/bun/build-mainview.ts](../src/bun/build-mainview.ts)
- [src/bun/build-mainview.test.ts](../src/bun/build-mainview.test.ts)
- [src/bun/index.ts](../src/bun/index.ts)
- [package.json](../package.json)
- [README.md](../README.md)
- [src/bun/README.md](../src/bun/README.md)

## Validation performed

- `bun run format`
- `bun run validate`
- local build comparison for dev vs production bundle output

## Completion note

`OPT04.1` is complete.

Metidos now has an explicit frontend build-mode policy: development stays debug-friendly, production is minified by default, and production sourcemaps are opt-in instead of always being generated.
