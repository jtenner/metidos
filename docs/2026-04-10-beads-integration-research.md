# Research: Evaluating Beads For Jolt

Date: 2026-04-10  
Repository: `jt-ide`  
External target: `gastownhall/beads`  
Upstream snapshot inspected: `main` at `0ed8d0b27161e0ab712cd9b4a9fa27874d229d7a` (2026-04-09) and release `v1.0.0` (published 2026-04-03)

## Summary

- Beads is primarily a native Go CLI backed by Dolt. It is not a TypeScript or browser library.
- Beads can be used programmatically today through four real surfaces:
  - spawning `bd` and parsing `--json`
  - importing its Go package
  - talking directly to the Dolt backend in server mode
  - using its Python MCP server
- A WASM library path is not an upstream-supported integration shape. Embedded mode requires CGO, non-CGO builds only support server mode, and the repo ships no JS/WASM bindings.
- For `jt-ide`, the best fit is a backend integration that spawns `bd` from Bun and parses JSON. A Go sidecar is the next-best option if a longer-lived API boundary is needed.
- The current packaging story is uneven:
  - GitHub release `v1.0.0` exists.
  - PyPI package `beads-mcp` is at `1.0.0`.
  - On 2026-04-10, `npm view @beads/bd version` returned `0.63.3`, not `1.0.0`.
  - In this Linux environment, both `npm install @beads/bd` and `bun add @beads/bd` ultimately failed because the published binary expected `libicui18n.so.74`.
- A local source build did work here: `go build -tags gms_pure_go -o bd ./cmd/bd` produced a working `bd version 1.0.0` binary with no ICU runtime dependency beyond `libc`.

## Goal

Evaluate whether Jolt can add Beads as a structured task-memory feature, and determine the practical integration shape for a Bun/TypeScript application:

- what Beads requires
- whether it is usable programmatically
- whether it can realistically be compiled to WASM
- whether Jolt should instead treat it as a dependency and call it via process execution

## Problem Beads Solves

Beads is trying to solve the same class of problem that Jolt’s thread/session/project model only partially addresses today: persistent long-horizon task memory for agents.

Its core model is:

- issues as durable work items
- explicit dependency edges
- ready-work queries
- audit trail / comments / labels
- Dolt-backed storage for branching and sync

That makes it potentially useful for:

- persistent planning across agent sessions
- dependency-aware work queues
- agent-discovered follow-up work
- multi-agent coordination over a shared task graph

## Bottom Line

Beads looks usable for Jolt, but only as a backend-native integration.

It does **not** look like a good candidate for:

- an in-browser library
- a TS-native SDK
- a clean WASM module drop-in

It **does** look like a good candidate for:

- a Bun backend adapter that shells out to `bd --json`
- or a small Go sidecar process that wraps the Go API for Jolt

For this repository, the lowest-friction path is process execution from Bun.

## What Was Researched

### Upstream Beads sources

- [Repository](https://github.com/gastownhall/beads)
- [README](https://github.com/gastownhall/beads/blob/main/README.md)
- [Architecture](https://github.com/gastownhall/beads/blob/main/docs/ARCHITECTURE.md)
- [Installing](https://github.com/gastownhall/beads/blob/main/docs/INSTALLING.md)
- [Dolt backend](https://github.com/gastownhall/beads/blob/main/docs/DOLT-BACKEND.md)
- [FAQ](https://github.com/gastownhall/beads/blob/main/docs/FAQ.md)
- [Public Go API](https://github.com/gastownhall/beads/blob/main/beads.go)
- [CGO-backed open path](https://github.com/gastownhall/beads/blob/main/beads_cgo.go)
- [Non-CGO open path](https://github.com/gastownhall/beads/blob/main/beads_nocgo.go)
- [Library usage example](https://github.com/gastownhall/beads/blob/main/examples/library-usage/README.md)
- [npm package manifest](https://github.com/gastownhall/beads/blob/main/npm-package/package.json)
- [npm wrapper binary launcher](https://github.com/gastownhall/beads/blob/main/npm-package/bin/bd.js)
- [npm postinstall downloader](https://github.com/gastownhall/beads/blob/main/npm-package/scripts/postinstall.js)
- [Release `v1.0.0`](https://github.com/gastownhall/beads/releases/tag/v1.0.0)
- [PyPI `beads-mcp`](https://pypi.org/project/beads-mcp/)

### Local Jolt sources

- [package.json](../package.json)
- [src/bun/git.ts](../src/bun/git.ts)
- [src/bun/pi-github-tools.ts](../src/bun/pi-github-tools.ts)
- [src/bun/pi-runtime-probe.ts](../src/bun/pi-runtime-probe.ts)

### Validation experiments run locally

- cloned `https://github.com/gastownhall/beads`
- checked current tags and latest release metadata
- tested `bun add @beads/bd`
- tested `npm install @beads/bd`
- downloaded the `v1.0.0` Linux release asset directly and ran `ldd`
- built from source with `go build -tags gms_pure_go -o bd ./cmd/bd`

## What Beads Requires

### 1. Runtime shape

Beads is centered on the `bd` CLI:

- the top-level README presents Beads as a CLI tool installed system-wide
- the architecture doc describes the CLI as the primary interface
- the npm package is only a wrapper that downloads and executes a native `bd` binary

This is not a library-first JS project.

### 2. Storage requirements

Beads uses Dolt as its only supported backend.

Two modes exist:

- **Embedded mode**: default; Dolt runs in-process and data lives under `.beads/embeddeddolt/`
- **Server mode**: optional; connects to external `dolt sql-server`

Implications:

- using Beads introduces a generated `.beads/` directory inside the project unless Jolt redirects it elsewhere
- per this repository’s policy, that generated directory should stay out of version control
- embedded mode is single-writer and protected with file locking
- server mode is the multi-writer option

### 3. Build requirements

If you consume a prebuilt binary, build dependencies are mostly upstream’s problem.

If you build from source:

- Go toolchain is required
- embedded mode relies on CGO
- upstream docs say Linux/macOS source builds may need ICU and Zstd development packages
- upstream also uses the `gms_pure_go` build tag to avoid ICU runtime linkage in some builds

Observed locally on 2026-04-10:

- the published Linux release binary for `v1.0.0` still linked `libicui18n.so.74`
- a local `go build -tags gms_pure_go -o bd ./cmd/bd` build produced a working binary that linked only `libc`

So the source-build path is more robust than the current published Linux binary in this environment.

## Programmatic Use

### 1. CLI + JSON output

This is the most obvious and most mature programmatic surface.

Evidence:

- architecture docs say all commands support `--json`
- multiple docs and examples recommend `bd ... --json` for integrations
- the npm package README describes Beads as “agent-friendly” through JSON output

This surface is a good fit for Jolt because this repo already uses subprocess-backed tool adapters:

- [src/bun/git.ts](../src/bun/git.ts)
- [src/bun/pi-github-tools.ts](../src/bun/pi-github-tools.ts)
- [src/bun/pi-runtime-probe.ts](../src/bun/pi-runtime-probe.ts)

Practical shape:

```text
Jolt Bun backend
  -> Bun.spawn(["bd", "...", "--json"])
  -> parse stdout JSON
  -> surface errors/status to the UI
```

This is the lowest-risk integration path.

### 2. Go library API

Beads does have a real public Go package:

- `package beads` exports `Open`, `OpenFromConfig`, `OpenBestAvailable`, core types, and the `Storage` interface
- the repo includes a dedicated `examples/library-usage/` example showing external Go usage
- source at `v1.0.0` still declares `module github.com/steveyegge/beads`, even though the repository now lives at `gastownhall/beads`

This means Beads is programmatically embeddable, but primarily for Go.

Practical implication:

- if Jolt builds a Go sidecar, it should expect the legacy `github.com/steveyegge/beads` import path today unless upstream normalizes that module path later

For Jolt, this would only be practical through:

- a small Go helper binary
- a stdio/JSON-RPC sidecar
- or a custom local service

It is **not** directly useful from Bun/TypeScript without adding another process boundary anyway.

### 3. Direct SQL / Dolt server mode

Upstream docs explicitly say:

- use `bd query` for direct SQL access
- or talk to the Dolt backend in server mode

This is possible, but it is a lower-level integration:

- Jolt would need to understand Beads’ schema and migrations
- it would bypass the higher-level CLI semantics that Beads already stabilizes
- server mode requires managing `dolt sql-server`

I would treat this as an optimization path, not the first integration.

### 4. MCP server

Beads ships a separate Python MCP server (`beads-mcp`).

That surface is real, but it is mainly for:

- MCP-only environments
- tools like Claude Desktop or Copilot MCP setups

For Jolt, it is probably the wrong level:

- extra process
- extra protocol layer
- extra schema/context overhead
- less direct control than a backend adapter calling `bd` itself

### Current JS / Bun Reality

Beads does **not** currently provide a TS API for Jolt to import.

The published npm package is a native-binary wrapper:

- `bin/bd.js` simply spawns the downloaded `bd` executable
- `postinstall.js` downloads the matching archive from GitHub Releases and verifies it by running `bd version`

That means “use Beads from JS” currently means:

- install a native binary somehow
- call it as a child process

not:

- import a stable JS library and call functions in-process

## WASM Assessment

### Short answer

I do **not** think WASM is a good integration plan for Jolt.

### Why

#### 1. Embedded mode requires CGO

The public API is explicit:

- `beads_cgo.go` enables `OpenBestAvailable` for embedded mode when CGO is available
- `beads_nocgo.go` says non-CGO builds only support server mode and return an error for embedded mode
- internal `embeddeddolt` stubs also error when built without CGO

That matters because ordinary browser-targeted Go WASM builds do not support CGO.

#### 2. There is no upstream WASM target

I did not find any upstream:

- `syscall/js`
- `js/wasm`
- `wasip1/wasm`
- TinyGo
- C-shared wrapper
- JS binding layer

So even if a reduced build were technically possible, it is not an upstream-supported target.

#### 3. Upstream explicitly chose native binaries over WASM for npm

The npm package README says the package wraps a native binary rather than using WebAssembly. That is strong evidence that upstream’s intended JS integration surface is still process-based.

#### 4. Server-mode-only WASM would still be awkward

Even an experimental no-CGO WASM build would still have major problems:

- it would only support server mode
- it would still need a reachable external Dolt server
- browser environments do not provide the raw local process and filesystem model Beads assumes

Inference:

- a narrow WASI experiment might be possible for a custom host
- but it would be an unsupported experiment, not a sensible product plan

## Packaging And Distribution Findings

### 1. Version skew exists right now

Observed on 2026-04-10:

- GitHub release tag: `v1.0.0`
- PyPI `beads-mcp`: `1.0.0`
- npm `@beads/bd`: `0.63.3`

So the JS package ecosystem is currently behind the main release line.

### 2. Bun can install the package, but not use it automatically

Observed on 2026-04-10:

- `bun add @beads/bd` installed `@beads/bd@0.63.3`
- Bun blocked the `postinstall` script by default
- `bun pm trust @beads/bd` was required to run the downloader

That means Bun integration needs explicit trust for this package before any binary appears.

### 3. Current npm/Bun package failed on Linux here

Observed on 2026-04-10:

- after allowing the `postinstall`, the package downloaded `beads_0.63.3_linux_amd64.tar.gz`
- verification failed because the binary expected `libicui18n.so.74`
- `npm install @beads/bd` reproduced the same failure, so this was not just a Bun quirk

### 4. Current GitHub release binary failed the same way here

Observed on 2026-04-10:

- direct download of `beads_1.0.0_linux_amd64.tar.gz` also failed on this machine
- `ldd` showed `libicui18n.so.74 => not found`

So “just download the latest release binary” is also not fully portable for Linux in this environment.

### 5. Source build worked

Observed on 2026-04-10:

```bash
go build -tags gms_pure_go -o /tmp/beads-build/bd ./cmd/bd
/tmp/beads-build/bd version
ldd /tmp/beads-build/bd
```

Result:

- built successfully
- reported `bd version 1.0.0`
- linked only `libc`

This is the cleanest path I found for producing a usable Linux binary today.

## Fit For Jolt

### 1. Jolt already has the right backend shape

Jolt already shells out to local tools from Bun and normalizes the results. That means a Beads adapter would fit the existing architecture rather than forcing a new runtime model.

This is especially compatible with:

- project/worktree-scoped execution
- per-thread/backend tool access
- backend-owned subprocess error handling

### 2. A Beads integration should stay in the Bun backend

The browser should not talk to Beads directly.

The right separation looks like:

```text
React mainview
  -> Jolt RPC
  -> Bun backend Beads adapter
  -> bd CLI or Go helper
  -> .beads/ storage or Dolt server
```

### 3. Generated data needs repo-policy handling

If Jolt creates Beads databases inside worktrees, it will create `.beads/`.

Per this repo’s instructions, generated files should stay out of version control, so any Beads trial in this repo should ensure:

- `.beads/` is ignored
- temporary build artifacts stay ignored
- local test binaries are not checked in

## Recommendation

### Recommended path

Use Beads as a backend dependency invoked from a process boundary.

For Jolt, the best current plan is:

1. Add a Bun backend adapter that resolves a `bd` executable and always uses `--json`.
2. Keep the Beads surface behind Jolt RPC instead of exposing it in the browser directly.
3. Prefer one of these binary supply strategies:
   - operator-installed `bd`
   - app-managed native binary
   - CI-built binary from source with `go build -tags gms_pure_go`
4. Treat `.beads/` as generated local state.

### Not recommended

Do **not** plan around:

- a WASM library
- a TS-native SDK that does not exist
- direct browser integration
- the current npm package as the only deployment story for Linux

### Reasonable second step if CLI spawning becomes limiting

If Jolt eventually needs:

- lower latency
- connection reuse
- richer transactions
- tighter control than CLI flags provide

then the next step should be a small Go sidecar that imports the Beads Go package and exposes a narrow RPC surface to Jolt.

That would still be process-based, but it would avoid repeated CLI startup and JSON command parsing.

## Final Answer To The Specific Questions

### What does Beads require?

At minimum, it requires a native `bd` binary plus its project-local `.beads/` storage. For server mode it also requires `dolt sql-server`. If you build from source, it requires Go, and embedded mode depends on CGO; however a `gms_pure_go` source build worked cleanly here.

### Is it possible to use it programmatically?

Yes.

The practical options are:

- CLI + `--json` output
- Go library import
- direct Dolt/SQL access
- Python MCP server

For Jolt, CLI + `--json` is the best fit.

### Could it be compiled to a WASM library?

Not as a realistic upstream-supported plan. Embedded mode requires CGO, non-CGO builds only support server mode, and there is no upstream WASM binding surface.

### Do we need to add it as a dependency and use it from a process start?

For a Bun/TypeScript app like Jolt: yes, that is the realistic integration model today.

But I would **not** rely on the currently published npm package alone on Linux. A system-installed or CI-built native binary is a safer plan right now.
