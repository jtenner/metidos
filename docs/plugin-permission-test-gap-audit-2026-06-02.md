# Plugin Permission Test Gap Audit — 2026-06-02

Scope: identify missing plugin permission tests before public release, without changing runtime behavior.

## Coverage observed

Existing tests cover many Plugin System v1 permission seams:

- `src/bun/plugin/manifest.test.ts` covers permission enum validation, duplicate permissions, ingress permissions, file allowlist permission requirements, provider/notification provider permissions, terminal `unsafe` pairing, and unsafe all-domain network allowlists.
- `src/bun/plugin/startup-registrations.test.ts` covers tool, cron, ingress, model-provider, and notification-provider registration permission checks.
- `src/bun/plugin/quickjs-runtime.test.ts` covers runtime API permission failures for logging, fetch, notifications, calendar APIs, cron registration, model-provider registration, notification-provider registration, and terminal unsafe failures.
- Capability-specific tests cover filesystem, network fetch/websocket, LanceDB, SQLite, embeddings, terminal, notification sending, plugin access groups, and central capability gate behavior.

## Missing or under-specified public-release gaps

1. **OAuth provider registration permission checks**
   - Existing positive coverage registers OAuth providers in Python runtime and exercises OAuth provider capability helpers.
   - Missing negative coverage proving OAuth provider declarations/startup registrations fail without `oauth:register`, and that the JS/Python runtime surfaces a deterministic permission error when `metidos.oauth.registerProvider`/equivalent APIs are used without permission.
   - Suggested files: `src/bun/plugin/manifest.test.ts`, `src/bun/plugin/startup-registrations.test.ts`, `src/bun/plugin/quickjs-runtime.test.ts`, and/or `src/bun/plugin/plugin-runtime.test.ts`.

2. **Prompt injection registration permission checks**
   - Existing positive coverage exercises prompt injection runtime setup and thread filtering.
   - Missing negative coverage proving prompt-injection declarations/startup registrations fail without `metidos:prompt_inject`, and that runtime registration fails with a deterministic permission error when the permission is absent.
   - Suggested files: `src/bun/plugin/manifest.test.ts`, `src/bun/plugin/startup-registrations.test.ts`, `src/bun/plugin/quickjs-runtime.test.ts`, and `src/bun/plugin/prompt-injection-capability.test.ts`.

3. **Permission-reference/schema drift guard**
   - `docs/plugin-permissions.md` is the public permission reference, while schema/runtime tests independently list permission strings.
   - Missing a small test or lint-style assertion that every public permission in `docs/plugin-permissions.md` is represented in the manifest permission enum and every enum value has a public reference entry. This would catch stale public docs before release.
   - Suggested files: `src/bun/plugin/manifest.test.ts` or a focused docs/schema contract test.

4. **Integrated access-group-vs-permission regression**
   - Unit tests cover that thread access groups filter visible tools and that permissions gate host APIs.
   - Missing an integrated regression proving that enabling a plugin access group on a thread exposes only declared tools/prompt injections and cannot grant undeclared host permissions to the plugin sidecar.
   - Suggested files: `src/bun/plugin/sidecar-manager.test.ts`, `src/bun/plugin/tool-access.test.ts`, or a focused thread-runtime plugin fixture test.

These follow-up TODOs were added to `agent-todo.md` as actionable slices for future runs.
