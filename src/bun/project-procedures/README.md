# src/bun/project-procedures

This folder contains the Bun backend procedure layer that powers most RPC behavior exposed to the UI.
It is organized by concern so each module has a narrow responsibility for data models, git orchestration, and thread rendering.

## Purpose of each file

- `auth-context.ts`
  - Carries authenticated-user and request-scoped authorization context into procedure helpers.

- `model-catalog.ts`
  - Defines the Pi-backed model catalog and reasoning effort options across providers exposed by Pi and plugins.
  - Keeps model provider setup out of the main app; plugin-backed providers are registered through Plugin System v1 sidecars.
  - Validates and normalizes selected model/reasoning-effort values so invalid persisted data cannot break runtime behavior.
  - Tracks provider metadata such as current provider availability and which model ids accept reasoning-effort overrides.
  - Resolves provider availability from Pi plus active Plugin System v1 model-provider configurations so missing setup or no-model plugin states are visible before a run starts.
  - Provides context-window and compaction-trigger helpers used when estimating token budgets.

- `pi-session-telemetry.ts`
  - Projects active Pi session telemetry into Metidos thread payloads without scraping external files.
  - Uses Pi `getContextUsage()` for live context-window hydration, session-branch `compaction` entries for observed compaction history, and runtime queue/streaming state for richer thread status overlays.
  - Keeps the Pi-to-Metidos telemetry mapping isolated so later UI work can consume new runtime fields without touching the persistence/rendering helpers.

- `command-normalization.ts`
  - Removes shell-wrapper noise from recorded command activity before it is persisted or shown in the UI.
  - Decodes wrapper-specific quoting for POSIX, `cmd.exe`, and PowerShell payloads so command cards display the original executable text instead of transport escaping.
  - Includes special handling for POSIX single-quote splice patterns used when shell commands embed literal single quotes.

- `model-catalog-cache.ts`
  - Caches model-catalog reads so repeated picker/runtime validation calls can share recent provider summaries.

- `calendar-procedures.ts`
  - Implements calendar, calendar-event, permission, ICS, and notification procedure helpers.

- `plugin-procedures.ts`
  - Implements plugin inventory, lifecycle, settings, log, notification, and local-operator-facing plugin procedure helpers.

- `plugin-ingress-procedures.ts`
  - Implements request-ingress identity binding, link-code, route, and external-message routing procedure helpers.

- `client-log.ts`
  - Accepts bounded browser/client diagnostics for backend-side logging and troubleshooting.

- `directory-suggestions.ts`
  - Implements directory autocomplete support used by project and worktree selectors.
  - Maintains an in-memory cache of directory entries keyed by path with TTL + LRU behavior.
  - Parses input queries (including `~` expansion patterns), normalizes path resolution, and refreshes hot entries on a timer.

- `project-skills.ts`
  - Lists project-local Pi skill descriptors available to the selected worktree.

- `project-worktrees.ts`
  - Contains the project/worktree read option type retained by procedure callers; lifecycle helpers now live in `work-context-lifecycle.ts`.

- `work-context-lifecycle.ts`
  - Defines the shared Project/Worktree/Thread lifecycle interface consumed by RPC, Pi-native tools, Cron, and Plugin ingress paths.
  - Owns lifecycle decisions such as worktree visibility/root fallback hydration, worktree creation/open sequencing, polling-state transitions, git-history warmup handoff, Thread creation/detail/turn queueing/stop/recovery ordering, caller-owned thread create/send sequencing, interrupted-thread recovery rules, and explicit cache-invalidation/listener-publication events while keeping database schemas and response shapes unchanged.

- `git-history.ts`
  - Encapsulates worktree commit-history caching and pagination mechanics.
  - Stores cached history entries/signatures and ensures callers only read requested windows.
  - Supports background prefetch and foreground escalation, with abortable fills to avoid blocking UI-critical paths.
  - Coalesces in-flight commit-diff reads so duplicate requests share work.

- `pi-event-projection.ts`
  - Projects Pi `AgentSessionEvent` updates into Metidos thread-activity writes without assuming Codex item types.
  - Tracks assistant thinking/text state, tool-call arguments, pre-write file snapshots, and final usage snapshots across a streamed run.
  - Synthesizes Metidos `file_change` rows for successful Pi `edit` and `write` calls so transcript diff cards stay useful after the Codex removal.
  - Carries plugin-provided image outputs on generic tool-call rows so browser plugins can show screenshots without native WebView transcript rows.
  - Keeps the Pi-to-Metidos transcript mapping explicit so later slices can extend remaining tool or custom-extension semantics cleanly.

- `pi-sdk-shapes.ts`
  - Shared Pi SDK payload-shape boundary used by turn settlement, event projection, and runtime telemetry.
  - Centralizes how Metidos reads assistant text, token usage, timestamps, and tool output from Pi-owned message/event payloads.
  - Keeps Bun-side Pi compatibility assumptions in one place so smoke tests can catch upstream SDK drift before it turns into projection bugs.
  - Works with the real Pi runtime smoke in `pi-thread-runtime.test.ts` to keep session resumption, projection, and telemetry coupling from drifting independently.

- `shared.ts`
  - Shared infrastructure for cache, concurrency, and cancellation primitives used by multiple procedure modules.
  - Exposes LRU helpers, abort normalization, abort-aware Promise awaiting, and bounded concurrency limiting.
  - Includes safe filesystem/path helpers (`safeIsDirectory`, `safeIsFile`, `normalizePath`, `shortName`) used across procedures.

- `thread-detail.ts`
  - Transforms raw DB thread/message records into the RPC shapes consumed by the frontend.
  - Computes thread run-state (`idle`, `working`, `failed`, etc.), unread-error flags, and compaction telemetry.
  - Converts persisted messages by kind (`chat`, `reasoning`, `command`, `file_change`, `tool_call`, `screenshot`, `web_search`, `error`) into stable UI types.

- `thread-activity-persistence.ts`
  - Persists projected Pi activity items and transcript-side effects in stable Metidos message records.

- `thread-runtime-lifecycle.ts`
  - Coordinates acquisition and cleanup of per-thread runtime handles around thread turns.

- `thread-turn-runner.ts`
  - Owns Thread Turn lifecycle ordering for runtime acquisition, user-message queueing, stop requests, and startup interruption recovery.
  - Keeps procedure code responsible for authorization and persistence adapters while the runner coordinates the shared lifecycle seam used by interactive and cron-owned threads.

## Project/Worktree/Thread procedure invariants

These invariants describe the current interface that callers must preserve while the large `src/bun/project-procedures.ts` implementation is deepened behind smaller modules.

### Project and worktree opening

- Request paths are normalized and checked against the caller's workspace scope before filesystem, git, or database side effects run.
- `openProjectProcedure` runs as foreground work: it suppresses background git warming, makes aborts observable as project-open failures, and only returns after the project poller has been hydrated.
- A project without git worktrees still returns a visible root workspace row; the row preserves any persisted pin metadata.
- Git-reported worktrees are visible only when they are the project root or persisted as tracked worktrees. Hidden worktrees are returned only to explicit include-hidden reads.
- The requested project root is accepted as a git workspace only when git reports the same path or an equivalent real path. The procedure does not fabricate git state for an unrelated worktree list.
- `openWorktreeProcedure` validates that the worktree belongs to the project, records non-root worktrees as visible, refreshes the listing, snapshots the worktree and first history page together under the worktree-open limit, then warms later history only after foreground pressure clears.

### Thread creation, detail, and turn queueing

- `createThreadProcedure` resolves the runnable model, reasoning effort, and access controls before creating the database row; it records cross-workspace audit metadata and then reads detail through the thread-detail cache.
- Full `getThreadProcedure` reads pass through the cached detail seam with live runtime telemetry applied to the expected thread. Cursor, message-limit, and light-content reads bypass the cache so pagination and heavy-content decisions stay explicit.
- A queued turn first verifies provider availability, then persists the user message, then marks lifecycle state `working`, installs the abort controller, starts background execution, records the completion promise, and finally reads fresh thread detail.
- Provider validation failures must not persist a user message, mark the thread working, or create a completion promise.
- Stop requests abort the active controller, best-effort abort the runtime session, persist the stopped state with the stop timestamp, publish lifecycle status, wait briefly for the active completion, and then read detail.
- Startup recovery writes metadata-only interrupted markers for in-progress messages before deciding whether each thread should be marked stopped; active-turn records that did not have in-progress messages are still recovered.

### Cache invalidation and callers

- Thread activity persistence invalidates the thread-detail cache on each persisted projection so `getThread` and turn-queue responses do not serve stale transcript rows; procedure-owned invalidations now flow through explicit lifecycle events before touching the runtime cache.
- Worktree snapshot, history, and poll-state updates mutate the per-project poller before publishing warm-background work, so RPC callers, Pi-native Metidos Tools, Cron Runner, and Plugin ingress all observe the same hydrated project/worktree state.
- Pi-native Thread tools, scheduled Cron execution, and Plugin ingress route initial turns through the lifecycle caller-turn seam so child-thread creation/reuse, optional caller bookkeeping, and first-message queueing share one ordering policy instead of duplicating create-then-send sequences.
- Worktree git-history refresh, Cron-list, context-focus, thread-start-request, and thread-status websocket/listener publication is routed through lifecycle event factories and a local dispatcher, keeping event payload names stable while removing direct listener sequencing from handler bodies.
- RPC handlers perform user/workspace authorization before crossing into these seams. Pi-native Metidos Tools, Cron Runner, and Plugin ingress call the same procedure functions with request contexts or pre-authorized inputs instead of duplicating lifecycle behavior.

## Notes

- This module family is the operational core behind `src/bun/project-procedures.ts`.
- Provider availability is enforced in the procedure layer before thread creation, queued runs, and cron mutations so missing plugin/Pi provider setup fails fast with actionable errors instead of reaching the runtime.
- Files here are intentionally separated to avoid a monolithic RPC implementation and to keep runtime responsibilities testable by boundary:
  - persistence mapping in `thread-detail.ts` and `thread-activity-persistence.ts`
  - metadata normalization in `model-catalog.ts`
  - async policy in `shared.ts`
  - focused procedure families in `calendar-procedures.ts`, `plugin-procedures.ts`, and `plugin-ingress-procedures.ts`
  - shared lifecycle decisions, Worktree open/polling sequencing, Thread creation/turn orchestration, and external caller-turn sequencing in `work-context-lifecycle.ts`
  - external data producers in `directory-suggestions.ts`, `project-skills.ts`, and `git-history.ts`.
