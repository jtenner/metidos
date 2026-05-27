# Metidos SQLite security extension

This directory builds a trusted native SQLite loadable extension for Metidos plugin database connections.

The extension installs a SQLite authorizer callback with `sqlite3_set_authorizer()` when loaded. It denies operations that plugin SQL must not perform directly:

- `SQLITE_ATTACH`
- `SQLITE_DETACH`
- SQL calls to the `load_extension(...)` function

SQLite reports `VACUUM INTO` through the authorizer as an attach-like operation, so denying `SQLITE_ATTACH` also blocks `VACUUM INTO` in the smoke test.

## Prerequisites

Install Zig. The build script uses `zig cc` to cross-compile a tiny C shared library.

The SQLite C headers are vendored in `src/sqlite3.h` and `src/sqlite3ext.h` so cross-compilation does not depend on host SQLite development packages.

## Build

Build every configured target:

```bash
bun run native/sqlite-security-extension/build.ts --clean
```

Build only the current host target:

```bash
bun run native/sqlite-security-extension/build.ts --target=host --clean
```

Build one target:

```bash
bun run native/sqlite-security-extension/build.ts --target=x86_64-linux-gnu
bun run native/sqlite-security-extension/build.ts --target=aarch64-linux-gnu
bun run native/sqlite-security-extension/build.ts --target=x86_64-macos
bun run native/sqlite-security-extension/build.ts --target=aarch64-macos
bun run native/sqlite-security-extension/build.ts --target=x86_64-windows-gnu
```

Outputs are written under `dist/<target>/` and are intentionally not committed.

## Smoke test

Build the host target, then load it through `bun:sqlite`:

```bash
bun run native/sqlite-security-extension/build.ts --target=host --clean
bun run native/sqlite-security-extension/smoke-test.ts
```

The smoke test verifies that normal `SELECT` statements still work and that `ATTACH`, `VACUUM INTO`, and `load_extension(...)` are denied.

## Trust model

This is host-owned native code, not an untrusted Metidos JavaScript plugin. It runs inside the process that loads the SQLite connection and should be treated like other trusted Metidos runtime code.

Do not expose `Database.loadExtension()` to untrusted plugins.
