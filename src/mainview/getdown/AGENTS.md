# AGENTS.md

Compact guide for coding agents working in this repository.

## Project overview

`getdown` is a TypeScript/Bun package that exposes a React component API for rendering GitHub Flavored Markdown.

- Package entrypoint: `index.ts`
- Public exports: `src/index.tsx`
- Runtime target: Bun + React
- Module type: ESM
- TypeScript config: `tsconfig.json`

## Important paths

- `src/core/ast.ts` — Markdown AST types.
- `src/core/document.ts` — Block/document parser and structural sharing via `parseDocument(content, previous?)`.
- `src/core/inlines.ts` — Inline parser helpers, links, emphasis, code spans, entities, autolinks.
- `src/react/GetDown.tsx` — Public React renderer and HTML escaping/rendering helpers.
- `src/getdown.test.tsx` — Main GFM rendering test matrix.
- `src/core/document.test.ts` — Structural sharing tests.
- `perf/baseline.tsx` — Internal performance/GC baseline harness.
- `perf/README.md` — Perf run instructions and current baseline numbers.

## Commands

Run from `src/mainview/getdown/`, where this package's local `package.json` defines the typecheck and performance scripts:

```bash
bun test
bun run typecheck
bun run perf:baseline
```

Useful scripts in `package.json`:

- `test` — `bun test`
- `typecheck` — `tsc --noEmit`
- `perf:baseline` — print timing/heap baseline
- `perf:baseline:json` — print JSON baseline
- `perf:baseline:save` — save timestamped JSON under `perf/baselines/`

## Parser notes

- `parseDocument` normalizes CRLF/CR and NUL bytes before parsing.
- Passing a previous `ParsedDocument` enables block object reuse for unchanged blocks.
- Block reuse fingerprints are based on `kind`, `start`, and `raw`.
- Streaming callers should pass complete growing content plus the previous parsed document.
- Inline parsing is intentionally optimistic for incomplete streamed constructs.

## Development expectations

- Keep public API exports in `src/index.tsx` and root `index.ts` aligned.
- Prefer adding/adjusting rendering cases in `src/getdown.test.tsx` for Markdown behavior changes.
- Add focused parser tests in `src/core/*.test.ts` for structural or parser-internal behavior.
- After parser/rendering changes, run `bun test` and `bun run typecheck`.
- For streaming/performance-sensitive changes, run `bun run perf:baseline` and compare against `perf/README.md`.

## Style notes

- Strict TypeScript is enabled.
- Use immutable/read-only AST shapes where possible.
- Keep HTML output escaped unless a block/inline type explicitly represents allowed raw HTML.
- Avoid introducing broad dependencies; this package currently relies mainly on Bun, React, React DOM, and TypeScript.
