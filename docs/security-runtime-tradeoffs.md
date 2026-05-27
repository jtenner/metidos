# Security runtime tradeoffs

Metidos intentionally exposes a few high-power local runtime features. These features are guarded, but they remain architectural security tradeoffs rather than fully removable risks.

## Plugin Python runtime

Python plugins run in Pyodide with Metidos-provided host modules and startup checks that verify direct access to host globals and host filesystem APIs is unavailable. Treat this as a compatibility and isolation layer, not as a complete OS security boundary. A future Pyodide or WebAssembly escape would execute with the Metidos process privileges.

Operational guidance:

- Only approve plugins from trusted authors.
- Prefer running Metidos under a dedicated OS user with least-privilege filesystem access.
- For hostile or unreviewed Python plugins, use an external container or VM boundary around the Metidos process.

## Plugin JavaScript runtime

JavaScript plugins run in QuickJS with memory, stack, startup timeout, and callback timeout limits. Host capabilities are exposed through permission-checked bridge functions rather than direct Node or Bun APIs. This limits accidental access, but QuickJS, bridge serialization, and host callback code remain part of the trusted computing base.

The generated plugin API runtime also best-effort installs compatibility helpers such as `atob` and `btoa` on `globalThis`. Assignment failures there are intentionally non-fatal: plugins can still use the returned local helper values, and the failure does not widen host access or bypass any capability gate.

Operational guidance:

- Review plugin manifests and requested permissions before approval.
- Keep plugin permissions narrowly scoped.
- Disable or remove plugins that are no longer needed.

## WebAssembly and CSP

The mainview Content Security Policy includes `script-src 'self' 'wasm-unsafe-eval'` because runtime dependencies use WebAssembly. This avoids enabling general inline script execution, but it does permit same-origin WebAssembly compilation. Dependency integrity and same-origin asset controls are therefore important parts of the browser security model.

A sandboxed iframe was considered as a stricter isolation boundary for WebAssembly-capable UI code. Metidos does not use that split today because the current mainview shell and terminal/UI runtime expect same-origin assets, shared RPC state, and direct component integration. Revisit iframe isolation if future work separates the WASM-dependent surface into a narrow, message-passing sub-application.

Operational guidance:

- Serve the mainview only from trusted built assets.
- Keep dependencies pinned and reviewed.
- Do not add `unsafe-inline` or general `unsafe-eval` to the mainview CSP.

## Typed JSON boundaries

Some runtime adapters use TypeScript casts such as `as unknown` or `as Record<string, unknown>` immediately after parsing provider or sidecar JSON. These casts are not treated as a security boundary. They preserve TypeScript ergonomics at integration edges while the consuming code validates concrete fields with explicit type checks, allowlists, bounded readers, and permission gates before making privileged decisions.

Operational guidance:

- Do not add privilege checks that rely on a cast alone.
- Keep parsed external data as `unknown` or `Record<string, unknown>` until each consumed field is validated.
- Prefer small field-level type guards near the decision point over broad trusted object casts.
