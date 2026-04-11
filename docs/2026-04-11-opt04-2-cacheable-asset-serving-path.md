# 2026-04-11 OPT04.2 Cacheable Asset-Serving Path

**Status:** completed on 2026-04-11  
**Slice:** [OPT04.2](../agents-todo.md)  
**Primary planning references:**
- [docs/optimization-proposals.md](./optimization-proposals.md)
- [docs/2026-04-11-optimization-execution-proposal.md](./2026-04-11-optimization-execution-proposal.md)
- [docs/2026-04-11-opt04-1-production-mainview-build-modes.md](./2026-04-11-opt04-1-production-mainview-build-modes.md)

## Summary

`OPT04.2` moves the browser bootstrap onto an explicit versioned asset path so the server can apply strong caching to frontend assets without making the HTML bootstrap stale.

After this slice:

- `index.html` remains `no-store`,
- the browser loads frontend assets from `/assets/mainview/<version>/...`,
- those versioned asset routes use immutable cache headers,
- fonts now resolve relative to the versioned CSS path,
- legacy root asset routes remain available as compatibility aliases but are no longer the primary bootstrap path.

This lands the second `OPT04` slice without enabling chunk splitting yet.

## Scope of the slice

Per the execution plan, this slice needed to:

- serve built frontend assets from a small asset path instead of only `/index.js`,
- add cache headers appropriate for static versioned assets,
- keep HTML bootstrap behavior correct.

This slice intentionally did **not**:

- introduce hashed output filenames,
- enable Bun chunk splitting,
- migrate the bundler,
- change the websocket bootstrap contract,
- add a broader static-file server outside the small allowlisted mainview asset set.

## What changed

## 1. Added a dedicated versioned-mainview-asset helper

New files:

- [src/bun/mainview-assets.ts](../src/bun/mainview-assets.ts)
- [src/bun/mainview-assets.test.ts](../src/bun/mainview-assets.test.ts)

This helper owns the pure logic for:

- building the current versioned asset snapshot,
- generating an asset version token from the live bundle/CSS/font file metadata,
- replacing the HTML asset-root placeholder,
- resolving only the allowlisted asset paths under the versioned prefix.

The route prefix is now:

- `/assets/mainview/<version>/...`

and the current cache policy for those versioned assets is:

- `public, max-age=31536000, immutable`

## 2. `index.html` now uses an injected asset root placeholder

Updated file:

- [src/mainview/index.html](../src/mainview/index.html)

The HTML template now references:

- `__METIDOS_ASSET_ROOT__/index.css`
- `__METIDOS_ASSET_ROOT__/index.js`
- `__METIDOS_ASSET_ROOT__/fonts/...`

`src/bun/index.ts` replaces that placeholder at response time with the current versioned asset root.

That keeps the HTML bootstrap stable while allowing the asset URLs themselves to be versioned.

## 3. CSS font URLs are now relative to the CSS file

Updated file:

- [src/mainview/input.css](../src/mainview/input.css)

The `@font-face` URLs were changed from absolute root paths like:

- `/fonts/inter-latin-wght-normal.woff2`

to relative asset paths like:

- `./fonts/inter-latin-wght-normal.woff2`

That matters because the same generated CSS file can now work correctly from both:

- the new versioned asset route,
- the retained root compatibility alias route.

## 4. The Bun server now serves versioned assets with immutable caching

Updated file:

- [src/bun/index.ts](../src/bun/index.ts)

The server now does three distinct things:

### HTML bootstrap

- serves `/` and `/index.html` with `no-store`
- injects runtime config as before
- injects the current `/assets/mainview/<version>` asset root

### Versioned asset routes

- serves the allowlisted asset set under `/assets/mainview/<version>/...`
- applies `public, max-age=31536000, immutable`
- only resolves the current version token and only for the explicit asset files

### Compatibility aliases

The previous root routes remain available:

- `/index.js`
- `/index.js.map` when emitted
- `/index.css`
- `/fonts/...`

Those aliases stay `no-store` and exist only to preserve compatibility for existing diagnostics and tooling while the browser bootstrap moves onto the versioned route.

## Why versioned path injection was chosen

A cacheable asset path needs two properties at the same time:

1. **HTML must not go stale** because it decides which assets belong to the current server state.
2. **Assets should be strongly cacheable** once their URL is versioned.

Injecting the current asset root into the HTML response gives both:

- HTML stays fresh because it remains `no-store`.
- JS, CSS, fonts, and sourcemaps can be treated as immutable because the versioned path changes whenever the underlying asset metadata changes.

This was the narrowest path to better asset caching without also taking on hashed-file output or chunk manifest work in the same slice.

## Test coverage added

New file:

- [src/bun/mainview-assets.test.ts](../src/bun/mainview-assets.test.ts)

This covers:

- stable version-token generation,
- building the current asset snapshot,
- excluding sourcemap routes when no sourcemap exists,
- resolving only current-version allowlisted assets,
- replacing every HTML asset-root placeholder,
- keeping the immutable cache policy string explicit.

## Local smoke validation

A local server smoke check was run after this slice.

### Observed HTML bootstrap asset paths

Example HTML response paths:

- `/assets/mainview/7840d0d2a9ef/index.js`
- `/assets/mainview/7840d0d2a9ef/index.css`

### Observed cache headers

| Route | `cache-control` |
|---|---|
| versioned `/assets/mainview/<version>/index.js` | `public, max-age=31536000, immutable` |
| compatibility `/index.js` | `no-store` |

That confirmed the intended split:

- HTML/bootstrap aliases stay fresh,
- versioned asset URLs become cacheable.

## Why this slice was worth doing before chunk splitting

Before this change, the app still loaded its main frontend entry from root-level non-versioned asset routes, which limited how aggressively the server could cache them.

With this slice in place:

- the runtime now has a stable asset-path model,
- HTML bootstrap correctness stays simple,
- `OPT04.3` can decide about chunk splitting on top of a cleaner serving contract instead of changing both the path model and bundler output shape at once.

## What stayed intentionally unchanged

To keep the slice atomic and evidence-led, this change does **not**:

- enable Bun splitting,
- add a build manifest,
- add hashed filenames,
- move HTML onto a cacheable route,
- remove the root compatibility asset aliases yet.

Those are deferred until later measurements justify more change.

## Files changed by the slice

- [src/bun/index.ts](../src/bun/index.ts)
- [src/bun/mainview-assets.ts](../src/bun/mainview-assets.ts)
- [src/bun/mainview-assets.test.ts](../src/bun/mainview-assets.test.ts)
- [src/mainview/index.html](../src/mainview/index.html)
- [src/mainview/input.css](../src/mainview/input.css)
- [README.md](../README.md)
- [src/bun/README.md](../src/bun/README.md)

## Validation performed

- `bun run format`
- `bun run validate`
- local HTTP smoke check for versioned asset URLs and cache headers

## Completion note

`OPT04.2` is complete.

Metidos now serves its frontend bootstrap from a versioned asset path with immutable caching for JS/CSS/font assets while keeping the HTML entrypoint fresh and preserving compatibility aliases for existing tooling.
