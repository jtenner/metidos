# Metidos xmloxide WASM wrapper

This folder builds a narrow WebAssembly wrapper around the vendored `native/xmloxide` Rust parser for `metidos.xml.parse(..., { loose: true })`.

The wrapper exposes only an in-memory parse API. It does not expose filesystem, network, catalog, XInclude, or validation APIs.

## Build

```bash
bun run native/xmloxide-wasm/build.ts
```

The build requires Rust with the `wasm32-unknown-unknown` target installed. The generated runtime artifacts are ignored build outputs, and `bun run validate` builds them before running tests:

```text
native/xmloxide-wasm/dist/metidos_xmloxide_wasm.wasm
native/xmloxide-wasm/dist/metidos_xmloxide_wasm.cjs
```

The CommonJS bundle embeds the WASM bytes as base64 and is the preferred runtime path. The standalone `.wasm` is retained as a transparent build artifact and fallback.
