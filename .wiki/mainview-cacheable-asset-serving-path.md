# Mainview Cacheable Asset-Serving Path

## Summary

This page records the durable `OPT04.2` asset-serving design for Metidos mainview. **Observed:** `src/bun/index.ts` and `src/bun/mainview-assets.ts` now move the browser bootstrap onto a versioned asset root under `/assets/mainview/<version>/...` while keeping `index.html` itself fresh. **Observed:** versioned JS, CSS, fonts, and optional sourcemaps are served only from the current version token and use immutable cache headers. **Recommended durable rule:** keep HTML bootstrap `no-store`, keep versioned asset paths strongly cacheable, and retain compatibility aliases only as a transitional surface instead of the primary browser entrypoint.

Related pages:

- [production-mainview-build-modes](./production-mainview-build-modes.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)

## Problem

Before `OPT04.2`, the mainview browser entry still loaded from root-level non-versioned paths such as `/index.js`. That limited safe cacheability because:

- the HTML entrypoint decides which assets belong to the current server state,
- non-versioned asset URLs cannot safely use long-lived immutable caching,
- later bundling work such as chunk splitting would have had to change both the path model and the caching model at once.

The slice needed a narrow serving contract that improved caching without also requiring hashed output filenames, manifests, or a broader static-file server.

## Current state

### Versioned asset root

**Observed:** the runtime now injects a versioned asset root into HTML responses:

- `/assets/mainview/<version>/index.js`
- `/assets/mainview/<version>/index.css`
- `/assets/mainview/<version>/fonts/...`

**Observed:** `src/bun/mainview-assets.ts` owns the pure helper logic for:

- building the current asset snapshot,
- generating the version token from current bundle, CSS, and font metadata,
- replacing the HTML `__METIDOS_ASSET_ROOT__` placeholder,
- resolving only the allowlisted asset paths under the current version prefix.

### HTML bootstrap policy

**Observed:** `/` and `/index.html` remain `no-store` responses.

**Observed:** `src/mainview/index.html` now references `__METIDOS_ASSET_ROOT__/index.css`, `__METIDOS_ASSET_ROOT__/index.js`, and `__METIDOS_ASSET_ROOT__/fonts/...`, and `src/bun/index.ts` replaces that placeholder at response time.

**Recommended durable rule:** keep HTML non-cacheable so the server can always point the browser at the current asset version.

### Immutable versioned assets

**Observed:** the current versioned asset routes use:

- `cache-control: public, max-age=31536000, immutable`

**Observed:** the server resolves only the current version token and only for the explicit allowlisted mainview assets, including sourcemaps only when the current build emitted one.

That means cached assets stay safe because their URL changes whenever the underlying asset metadata changes.

### Relative font resolution

**Observed:** `src/mainview/input.css` now uses relative font URLs such as `./fonts/inter-latin-wght-normal.woff2` instead of root-absolute `/fonts/...` paths.

**Inferred:** this keeps the same generated CSS file valid from both the new versioned asset route and the retained compatibility alias route.

### Compatibility aliases

**Observed:** the root asset routes remain available as compatibility aliases:

- `/index.js`
- `/index.js.map` when emitted
- `/index.css`
- `/fonts/...`

**Observed:** those compatibility routes stay `no-store` and are no longer the intended browser bootstrap path.

**Recommended durable rule:** treat the aliases as transitional compatibility for diagnostics and tooling, not as the long-term frontend contract.

## Why this design was chosen

**Inferred:** the core design constraint was to satisfy two requirements at once:

1. HTML must stay fresh so it always points at the correct build output.
2. Asset URLs should become strongly cacheable once they encode the version.

Injecting the current asset root into the HTML response achieves both with limited scope:

- HTML remains the fresh bootstrap control plane.
- JS, CSS, fonts, and optional sourcemaps gain immutable cache semantics.
- The runtime can adopt a clearer serving contract before taking on chunk splitting or hashed filenames.

This was the narrowest slice that improved cacheability without changing the websocket bootstrap contract or introducing a generalized static asset server.

## Validation

**Observed:** the slice added `src/bun/mainview-assets.test.ts` to cover:

- stable version-token generation,
- current asset snapshot construction,
- sourcemap exclusion when no sourcemap exists,
- allowlisted current-version asset resolution,
- replacement of every HTML asset-root placeholder,
- the explicit immutable cache policy string.

**Observed:** the source document also recorded a local smoke check showing:

- HTML responses pointed at `/assets/mainview/<version>/index.js` and `/assets/mainview/<version>/index.css`
- versioned asset routes returned `public, max-age=31536000, immutable`
- compatibility `/index.js` remained `no-store`

**Observed:** validation for the slice included `bun run format`, `bun run validate`, and a local HTTP header/path smoke check.

## Deferred scope

**Observed:** `OPT04.2` intentionally did not:

- enable Bun chunk splitting,
- introduce hashed filenames,
- add a manifest-based asset server,
- move HTML onto a cacheable route,
- remove the root compatibility aliases yet.

**Recommended:** keep those follow-ups separate so future asset-shape work can build on the already-stable versioned-path contract.

## Affected files

**Observed:** the source document identified these files as the key implementation surface:

- `src/bun/index.ts`
- `src/bun/mainview-assets.ts`
- `src/bun/mainview-assets.test.ts`
- `src/mainview/index.html`
- `src/mainview/input.css`
- `README.md`
- `src/bun/README.md`

## Open questions

- When later chunk splitting or hashed output lands, should the current version-token path remain as the outer routing contract or collapse into filename-level versioning?
- When should the compatibility alias routes be removed, and which diagnostics or tooling still depend on them?
