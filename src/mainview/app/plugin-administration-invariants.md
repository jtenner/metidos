# Plugin administration workflow invariants

This note captures the current Mainview Plugin administration behavior before any larger move behind a dedicated workflow seam. It belongs near `settings-panel.tsx` and the existing `plugin-*-state.ts` helpers because those files currently split orchestration, view state, and rendering.

## Current owner boundaries

- `settings-panel.tsx` owns orchestration and side effects: RPC calls, loading/error state, step-up retries, refresh cascades, route persistence, folder creation prompts, and parent-provided callbacks such as model catalog and Plugin access group refreshes.
- `plugin-administration-panel.tsx` owns rendering for Plugin inventory, Plugin settings, diagnostics, lifecycle/data actions, ingress bindings, link codes, and local-operator ingress routes. It should stay presentational except for small local rendering state such as confirmation modals or list item UI state.
- `plugin-inventory-state.ts`, `plugin-lifecycle-action-state.ts`, `plugin-settings-form-state.ts`, and `plugin-ingress-route-state.ts` own deterministic view-state derivation that is safe to characterize in focused tests.
- A future Plugin administration seam should absorb workflow state and commands from `settings-panel.tsx`, but it should not reintroduce Plugin Settings scope or owner concepts. Settings are currently a single per-plugin settings map keyed by `directoryName` and setting key.

## Loading and partial-failure invariants

- Plugin inventory loads only when the settings panel is active, open, and the local operator has the app-management capability needed for Plugin administration.
- Ingress settings load when the settings panel is active and open; route and binding state is shown in the unified Plugin administration surface rather than a separate route-only settings surface.
- A full Plugin inventory load fetches inventory first, then details: sidecar diagnostics, operator-visible ingress bindings, Plugin settings snapshots, and Plugin access groups.
- Silent inventory refreshes are single-flight. A second silent refresh returns early while one is in flight.
- Sidecar diagnostics are best-effort: callers without Plugin administration capability receive an empty list, and diagnostic RPC failures clear diagnostics without surfacing an operator error.
- Ingress binding load failures surface through the shared Plugin action error channel.
- Plugin settings snapshot loading is per plugin. A failure for one plugin must not prevent successful snapshots for other plugins from rendering; the status line reports the number of failed Plugin settings loads.
- When no structurally valid Plugin declares settings, settings snapshots, form values, per-plugin errors, and status are cleared.

## Action and step-up invariants

- Lifecycle and data actions share one busy key and one action message/error channel so only one Plugin operation appears active at a time.
- Lifecycle actions refresh the inventory and sidecar diagnostics after completion. They also refresh Plugin access groups and the model catalog; enable, reapprove, and retry trigger an additional provider-refresh model catalog request.
- Data actions refresh the inventory and sidecar diagnostics after completion.
- Step-up-required errors do not lose the intended action. The pending retry payload preserves lifecycle action, data action plus optional confirmation, or settings save. Successful step-up reruns that saved operation without prompting again.
- Busy keys must be cleared only when they still match the completed action, preserving any newer operation that started before the older promise settled.

## Plugin settings invariants

- Settings snapshots and draft values are keyed by Plugin `directoryName`.
- Only structurally valid Plugins with settings declarations that include keys are included in settings snapshot loading and save patch construction.
- Unreadable stored secrets hydrate to an empty string so existing secret values are not exposed.
- An empty secret draft preserves an existing stored secret; `null` clears it; a non-empty string replaces it.
- List settings trim entries and drop empty values. Numeric list settings drop non-finite values.
- A save with no changed patches clears the settings status and performs no RPC.
- Saving changed settings updates both snapshots and form values from returned snapshots to normalize server-side values.

## Request Ingress and route invariants

- Link codes are keyed by `pluginId:sourceId`, update only the generated source, and report a shared Plugin action message.
- Route drafts are keyed by `pluginId:sourceId`. Draft reconciliation preserves edited drafts for still-present sources and drops drafts for removed sources.
- Missing route drafts fall back to the default model and the first open project path when available.
- Persisting a route opens the target project first, then upserts the route with sanitized permissions and the canonical project path returned by `openProject`.
- Route permissions always remove `metidos:unsafe`; when permission descriptors are known, unknown permissions are also removed. With no descriptors, legacy custom permissions are preserved except unsafe.
- A missing route folder prompts for folder creation instead of immediately surfacing an error. Confirming the prompt retries with `createIfMissing = true`.
- Folder suggestion failures are logged through client logging and do not overwrite the current draft.
- Binding enable/disable and delete update operator-visible binding lists from the RPC result and report through the shared Plugin action message/error channel.

## Characterization test coverage notes

- `plugin-inventory-state.test.ts` covers manage-app/open/active inventory loading gates, display fallbacks, issue priority, attention fingerprints, data summaries, deduplicated inventory rows, and the simplified settings-plugin filter that does not use Plugin Settings scope.
- `plugin-lifecycle-action-state.test.ts` covers stable lifecycle/data busy keys, status-aware labels, reapproval validation rules, button busy/disabled behavior, and action feedback normalization.
- `plugin-settings-form-state.test.ts` covers snapshot hydration, secret-safe clear and replacement semantics, control-value normalization, and changed patch construction.
- `plugin-ingress-route-state.test.ts` covers route folder display, binding grouping, link-code expiry text, ingress source summaries, poll interval formatting, draft construction/reconciliation, and permission sanitization.
- `plugin-administration-panel.test.tsx` covers rendering-sensitive settings behavior for list item keys and pending secret replacement feedback.
