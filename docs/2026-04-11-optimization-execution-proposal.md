# 2026-04-11 Optimization Execution Proposal

**Status:** proposed  
**Primary input:** [docs/optimization-proposals.md](./optimization-proposals.md)  
**Secondary inputs:** [agents-todo.md](../agents-todo.md), [README.md](../README.md), [src/mainview/app/README.md](../src/mainview/app/README.md), [src/bun/README.md](../src/bun/README.md)

## Purpose

This document converts the broad suggestion set in [docs/optimization-proposals.md](./optimization-proposals.md) into a **slice-ready implementation proposal**.

The earlier document was intentionally wide and exploratory. This follow-up document is narrower. Its job is to answer a different question:

> Which of those suggestions are still worth doing in the current tree, what exact changes would they cause, and how should they be sliced for a future `agents-todo.md` backlog?

This document therefore:

1. cross-references the earlier optimization document,
2. checks those suggestions against the current codebase,
3. rejects suggestions that are already implemented or unlikely to pay off,
4. selects the suggestions that still look worthwhile,
5. describes the concrete code, test, doc, and rollout changes those selected suggestions would cause,
6. proposes a slice structure that can later be translated into `agents-todo.md` entries.

## Important current-state correction

The earlier optimization document correctly identified broad themes, but several of its proposed optimizations are already substantially present in the repository now.

That matters because this proposal should not create duplicate backlog work.

### Already present in the current tree

The following are already implemented enough that they should **not** become first-wave optimization backlog slices:

- **Transcript virtualization and row measurement reuse**
  - `src/mainview/app/chat-workspace.tsx`
  - `src/mainview/app/README.md`
- **Lazy markdown loading**
  - `src/mainview/app/message-markdown-loader.ts`
  - `src/mainview/app/message-ui.tsx`
- **Worker-backed markdown preprocessing with caching and request dedupe**
  - `src/mainview/app/message-preprocessing-client.ts`
  - `src/mainview/app/message-preprocessing-worker.ts`
- **Worker-backed diff parsing with caching and request dedupe**
  - `src/mainview/app/diff-parsing-client.ts`
  - `src/mainview/app/diff-parsing-worker.ts`
- **Git history caching, commit-diff coalescing, and invalidation batching**
  - `src/bun/project-procedures/git-history.ts`
  - `src/mainview/app/invalidation-events.ts`
  - `src/bun/README.md`
- **A substantial SQLite index baseline already exists**
  - `src/bun/db.ts`
- **`project-procedures.ts` is already partially decomposed into domain modules**
  - `src/bun/project-procedures/`

So the right move is not “implement the original document literally.” The right move is to **narrow it to the remaining gaps**.

## Backlog-scope note for `agents-todo.md`

The current [agents-todo.md](../agents-todo.md) explicitly says new slices should only be added when they map back to the Pi migration or Codex-via-Pi documents.

That means this optimization proposal cannot be copied into `agents-todo.md` unchanged unless one of these happens first:

1. the `agents-todo.md` rules are broadened to include approved optimization work, or
2. a separate optimization backlog file is created, or
3. the future `agents-todo.md` update explicitly states that this document is now an approved backlog source.

That is not a blocker for planning, but it **is** a precondition for generating the final backlog file.

---

## 1. Triage of the original suggestions

This section maps the main suggestion groups from [docs/optimization-proposals.md](./optimization-proposals.md) to a concrete decision: **accept**, **accept in narrowed form**, **defer**, or **do not backlog**.

| Original suggestion | Source doc section | Decision | Why |
|---|---|---:|---|
| Split monolithic derived-state hook | `optimization-proposals.md` §2.1 | **Accept in narrowed form** | The real coupling problem is now more `src/mainview/App.tsx` than `use-mainview-derived-state.ts`. The hook is still worth trimming, but the work should target hot boundaries instead of a blanket rewrite. |
| Enhance virtualization and lazy rendering | §2.2 | **Do not backlog** | Already substantially implemented in `chat-workspace.tsx`, `message-ui.tsx`, and related worker paths. |
| React Compiler and memo audit | §2.3 | **Accept in narrowed form** | Worth doing, but as part of a targeted mainview decomposition and render-boundary cleanup, not as a standalone framework migration. |
| Optimize markdown, diffs, preprocessing | §2.4 | **Do not backlog** | Already implemented to a meaningful degree via lazy markdown, diff workerization, preprocessing workers, and caches. |
| Bundle size, code splitting, and load time | §2.5 | **Accept** | There is still clear remaining work: `build-mainview.ts` always builds unminified output with sourcemaps, and server asset serving is still single-bundle oriented. |
| Context and event system refinements | §2.6 | **Defer** | The repo already has coalesced invalidation for worktree history. More event abstraction should wait for actual telemetry. |
| Refactor monolithic `index.ts` and `project-procedures.ts` | §3.1 | **Defer** | This is mostly a maintainability/refactoring concern right now, not a first-wave measurable optimization win. |
| WebSocket and RPC efficiency | §3.2 | **Accept in narrowed form** | Payload measurement and targeted request/broadcast coalescing look worthwhile. Full binary transport does not. |
| Cron scheduler and sidecar improvements | §3.3 | **Accept in narrowed form** | A bounded global concurrency guard and better telemetry look worthwhile. A persistent DB queue does not yet. |
| Pi AI and model integration | §3.4 | **Defer** | The model-catalog path looks adequate. Cache and bypass work here should be measurement-led, not assumed. |
| Indexing, WAL, query tuning | §4.1 | **Accept in narrowed form** | Many indexes already exist, but WAL and some query-plan alignment still look worthwhile. Generic query caching should not be first wave. |
| Transaction and concurrency management | §4.2 | **Accept in narrowed form** | Good follow-on after WAL and metrics. Do not start with optimistic locking/version columns. |
| Persistent Git cache | §5.1 | **Do not backlog** | Current in-memory git caches, prefetching, and invalidation/coalescing are already nontrivial. On-disk cache complexity is probably not justified yet. |
| Filesystem and worktree handling | §5.2 | **Defer** | Maybe worth selective tuning later, but there is not enough evidence yet for a first-wave slice. |
| Memory management and leak prevention | §6.1 | **Defer** | Important, but should be driven by telemetry first. |
| Profiling and telemetry | §6.2 | **Accept** | This is foundational. Several other decisions should wait on measurement. |
| Sandbox and tool execution pooling | §6.3 | **Do not backlog** | VM pooling/isolation risk looks too high relative to likely gain at this stage. |
| Build pipeline enhancements | §7.1 | **Accept in narrowed form** | The meaningful parts are production build mode, sourcemap gating, and asset serving. Tool churn is unnecessary. |
| Perf regression tests/benchmarks | §7.2 | **Accept in narrowed form** | Worth doing, but through focused harness/reporting and a few targeted tests instead of a full benchmark framework up front. |
| Runtime performance flags | §7.3 | **Defer** | Do not expose tuning knobs until defaults are proven. |

### Net result

The broad document collapses into **six recommended implementation tracks**:

1. **OPT01 — Performance telemetry and benchmark baseline**
2. **OPT02 — SQLite runtime tuning and query-plan alignment**
3. **OPT03 — Mainview controller decomposition and targeted memo audit**
4. **OPT04 — Production mainview asset pipeline**
5. **OPT05 — RPC payload accounting and targeted refresh/broadcast coalescing**
6. **OPT06 — Cron execution guardrails and telemetry**

Everything else should either be deferred until those six produce evidence, or omitted entirely.

---

## 2. Recommended optimization tracks

## OPT01 — Add trustworthy performance telemetry and a repeatable benchmark baseline

**Cross-reference to original doc:** `optimization-proposals.md` §§6.2, 7.2, 3.2.

### Why this one is worth doing

Several of the other optimization ideas are plausible, but the repo does not yet have enough instrumentation to rank them confidently.

The codebase already has some useful runtime stats:

- `src/bun/project-procedures.ts` exposes `getProcedureRuntimeStats()`.
- `src/bun/index.ts` already tracks overload-related counters.
- `src/bun/starvation-harness.ts` already measures startup path timing and load-loop completion/failure counts.

That is a good start, but it is still not enough for slice planning. What is missing is:

- per-method latency distributions,
- coarse payload-size visibility,
- retry-count visibility for SQLite lock contention,
- memory snapshots during harness runs,
- a stable way to compare before/after changes.

### Changes this track would cause

#### Code changes

**Backend runtime stats**
- Extend `src/bun/index.ts` to accumulate:
  - per-RPC method call count,
  - total duration,
  - peak duration,
  - optional sampled payload-byte estimates,
  - websocket push counts by event type.
- Extend `src/bun/project-procedures.ts` runtime stats to include:
  - SQLite retry counts,
  - git-history cache hit/miss counters,
  - commit-diff cache hit/miss counters,
  - selected expensive procedure timings.

**Optional read-only runtime stats endpoint or RPC**
- Add one read-only runtime-stats access path for harness and local diagnostics.
- This can be a small RPC or a dev-only HTTP endpoint. The exact transport is less important than keeping it explicit and bounded.

**Harness enhancements**
- Extend `src/bun/starvation-harness.ts` so it can report:
  - p50/p95/p99 per measured HTTP/RPC operation,
  - overall memory snapshots before and after warmup/pressure,
  - optional JSON output for repeatable comparisons,
  - a before/after-friendly summary format.

#### Test changes

- Add focused tests for the runtime-stats accumulator logic.
- Add at least one harness-format test if the harness gains structured JSON output.
- Keep the telemetry implementation intentionally simple enough to remain unit-testable.

#### Documentation changes

- Add a baseline-results section or a new companion doc once the first measurements exist.
- Update `README.md` only after there is a stable measurement story.

### What this track should **not** do

- Do **not** add full OpenTelemetry yet.
- Do **not** add a UI dashboard yet.
- Do **not** block other work on perfectly precise stats; “cheap and directionally reliable” is enough for the first pass.

### Candidate future backlog slices

#### OPT01.1 — Runtime stats collector
**Deliverables**
- add sampled per-RPC timing and payload counters
- expose SQLite retry counts and selected cache hit/miss counters
- keep stats cheap and resettable

**Primary files**
- `src/bun/index.ts`
- `src/bun/project-procedures.ts`
- `src/bun/rpc-schema.ts` or the chosen diagnostics endpoint

#### OPT01.2 — Harness percentile and memory reporting
**Deliverables**
- add p50/p95/p99 output
- add optional JSON report mode
- add memory snapshots during warmup and pressure phases

**Primary files**
- `src/bun/starvation-harness.ts`

#### OPT01.3 — First baseline write-up
**Deliverables**
- record one representative baseline run
- document how to repeat the run locally
- link the results back to this proposal and `optimization-proposals.md`

**Primary files**
- `docs/`
- optionally `README.md`

---

## OPT02 — SQLite runtime tuning and query-plan alignment

**Cross-reference to original doc:** `optimization-proposals.md` §§4.1 and 4.2.

### Why this one is worth doing

The earlier document overstated the “missing indexes everywhere” problem. `src/bun/db.ts` already creates a meaningful set of indexes.

However, two real gaps still stand out:

1. **`initAppDatabase()` only applies `foreign_keys` and `busy_timeout`; it does not enable WAL mode or related runtime pragmas.**
2. **Some hot ordering/query paths still do not obviously line up with the current index set.**

Examples:
- `listProjects()` orders by `last_opened_at DESC, name ASC`.
- `listOpenProjects()` filters by `is_open = 1` and orders by `last_opened_at DESC`.
- `listThreads()` orders by pin state and recency.
- `project-procedures.ts` still contains explicit retry logic for SQLite lock contention.

So the right change is **not** “add a generic cache layer to all DB reads.” The right change is:

- enable proven SQLite runtime tuning first,
- measure contention again,
- add only the specific missing indexes that the query plan actually justifies.

### Changes this track would cause

#### Code changes

**Database open/runtime tuning**
- Update `src/bun/db.ts` `initAppDatabase()` to evaluate a small, conservative pragma set such as:
  - `PRAGMA journal_mode=WAL`
  - `PRAGMA synchronous=NORMAL`
  - optionally a bounded cache-size pragma if measurement supports it
- Ensure the same runtime expectations are safe for sidecar/cron DB opens.

**Query-plan audit and targeted indexes**
- Audit hot read paths in `src/bun/db.ts`.
- Add only targeted indexes that match observed usage, likely around:
  - projects open/recent ordering,
  - threads ordering or filtering,
  - any thread-message ordering path found to be slow.
- Keep the index additions conservative and explain-plan-backed.

**Retry instrumentation**
- Extend the existing retry path in `src/bun/project-procedures.ts` so the app can report:
  - retry count,
  - retry exhaustion count,
  - last/peak retry delay totals.

#### Test changes

- Add DB-init coverage for the chosen pragma path.
- Make sure tests that create or delete DB files remain compatible with WAL mode. The repo already deletes `-wal` and `-shm` siblings, which is a good sign.
- Add focused query-plan assertions only if they can be kept stable; otherwise prefer integration notes over brittle tests.

#### Documentation changes

- Update the optimization docs once the first before/after numbers exist.
- No need to document low-level pragmas in the user-facing README unless they affect operations.

### What this track should **not** do

- Do **not** add a blanket read-query cache yet.
- Do **not** split reads and writes across different databases.
- Do **not** add optimistic locking/version columns yet.
- Do **not** add speculative indexes without an explain-plan check.

### Candidate future backlog slices

#### OPT02.1 — Enable conservative WAL-mode tuning
**Deliverables**
- add WAL-mode startup pragmas
- validate cron/sidecar DB opens under the same runtime assumptions
- verify DB cleanup/deletion remains correct

**Primary files**
- `src/bun/db.ts`
- `src/bun/sidecar-cron-runner.ts`
- DB-related tests

#### OPT02.2 — Query-plan audit and missing composite indexes
**Deliverables**
- measure explain plans for `listProjects`, `listOpenProjects`, `listThreads`, and selected thread-message reads
- add only the indexes that materially improve those paths
- document the chosen indexes in the migration area

**Primary files**
- `src/bun/db.ts`
- supporting DB tests/docs

#### OPT02.3 — SQLite retry metrics
**Deliverables**
- count lock retries and retry exhaustion
- surface those metrics to OPT01 runtime stats
- use the numbers to decide whether transaction work needs a second slice

**Primary files**
- `src/bun/project-procedures.ts`
- `src/bun/index.ts` or diagnostics path

---

## OPT03 — Mainview controller decomposition and targeted memo audit

**Cross-reference to original doc:** `optimization-proposals.md` §§2.1 and 2.3.

### Why this one is worth doing

The current frontend has already implemented many of the obvious rendering optimizations from the earlier document.

The biggest remaining frontend smell is not actually transcript virtualization anymore. It is the size and coupling of the main shell controller:

- `src/mainview/App.tsx` is **6850 lines**.
- It contains **66 `useState` calls**, **46 `useEffect` calls**, **115 `useCallback` calls**, and many cross-cutting concerns.
- `src/mainview/app/use-mainview-derived-state.ts` is still meaningful, but at ~778 lines it is more manageable than `App.tsx`.

That suggests the best optimization move is **not** a store-library rewrite. It is a selective decomposition that reduces state fan-out, isolates hot polling/selection behavior, and makes memo boundaries easier to reason about.

### Changes this track would cause

#### Code changes

**Extract high-churn controllers out of `App.tsx`**
Likely extractions include:
- thread-status polling and detail refresh,
- project/worktree selection and refresh control,
- git-history fetch/load-more controller,
- thread action / model update / access update orchestration,
- startup restore orchestration.

Possible new modules:
- `src/mainview/app/use-thread-status-controller.ts`
- `src/mainview/app/use-project-worktree-controller.ts`
- `src/mainview/app/use-git-history-controller.ts`
- `src/mainview/app/use-thread-actions.ts`

**Narrow the derived-state work instead of rewriting it wholesale**
- Keep `use-mainview-derived-state.ts`, but move only the heaviest pure computations into helper modules where that improves testability.
- Add `useDeferredValue` for sidebar search only if profiling shows typing contention.
- Prefer stable controller outputs over giant prop bundles assembled inline in `App.tsx`.

**Memo audit at real boundaries**
- Audit the props passed from `App.tsx` into sidebar/workspace/chat shells.
- Ensure that unrelated state changes do not force expensive subtree rerenders.
- Keep the current React Compiler integration, but treat it as a tool, not the plan itself.

#### Test changes

- Extend existing tests around:
  - thread-status refresh behavior,
  - startup restore,
  - project/worktree refresh,
  - derived-state behavior.
- Add at least one focused render-behavior or selector benchmark test if the extracted helpers are pure enough.

#### Documentation changes

- Update `src/mainview/app/README.md` when the main controller responsibilities move into new hooks.

### What this track should **not** do

- Do **not** introduce Zustand, Jotai, Recoil, or a new global-store dependency in the first pass.
- Do **not** rewrite `state.ts` from scratch.
- Do **not** reopen already-solved transcript virtualization work.
- Do **not** let this become a “rename files for cleanliness” refactor without measurable rerender/boundary benefits.

### Candidate future backlog slices

#### OPT03.1 — Extract thread-status and selected-thread controller
**Deliverables**
- move thread-status polling/detail refresh logic out of `App.tsx`
- preserve current behavior for selected-thread updates and optimistic error-ack flow
- reduce unrelated rerenders from that controller path

**Primary files**
- `src/mainview/App.tsx`
- new `src/mainview/app/use-thread-status-controller.ts`
- `src/mainview/thread-status-refresh.ts`
- thread-status tests

#### OPT03.2 — Extract project/worktree and git-history controllers
**Deliverables**
- move worktree-open/refresh/history orchestration out of `App.tsx`
- keep existing invalidation subscriptions and pagination behavior
- narrow prop surfaces passed into project/history panels

**Primary files**
- `src/mainview/App.tsx`
- new controller hooks under `src/mainview/app/`
- project/worktree/history tests

#### OPT03.3 — Targeted derived-state and memo cleanup
**Deliverables**
- extract selected pure helper computations from `use-mainview-derived-state.ts`
- add `useDeferredValue` only where it measurably helps search typing
- document the chosen hot-path memo boundaries

**Primary files**
- `src/mainview/app/use-mainview-derived-state.ts`
- `src/mainview/app/state.ts`
- derived-state tests

---

## OPT04 — Production mainview asset pipeline

**Cross-reference to original doc:** `optimization-proposals.md` §§2.5 and 7.1.

### Why this one is worth doing

This is one of the clearest remaining wins.

Current facts from the repo:
- `src/bun/build-mainview.ts` always builds with `minify: false`.
- It always emits `sourcemap: "external"`.
- `src/bun/index.ts` serves only `/index.js` rather than a chunk-capable asset path.
- `src/mainview/index.html` directly references `/index.js`.
- The current built bundle in `.metidos-build/index.js` is **3,260,481 bytes**.
- The emitted sourcemap is **5,920,088 bytes**.

That does not mean Metidos needs a bundler migration. It does mean the current production asset story leaves performance on the table.

### Changes this track would cause

#### Code changes

**Phase A: build modes**
- Update `src/bun/build-mainview.ts` so dev and production builds differ intentionally.
- Likely behavior:
  - dev: sourcemaps on, unminified or lightly optimized
  - production: minified bundle, sourcemaps off or optional

**Phase B: asset-serving model**
- Extend `src/bun/index.ts` so the server can safely serve build assets from a small allowlisted path instead of hard-coding only `/index.js`.
- Keep HTML responses non-cacheable if desired, but allow hashed/static assets to use stronger cache headers.

**Phase C: optional chunk splitting**
- Only after A/B land and are measured:
  - enable build splitting if Bun’s current bundler behavior is stable enough for this app,
  - switch `index.html` or injected runtime HTML to point at the generated asset manifest/entrypoint path,
  - let existing lazy modules actually become separately served chunks.

#### Test changes

- Add or update build-output tests if available.
- Add lightweight server tests for asset-path serving if practical.
- Verify dev rebuild/watch behavior still works.

#### Documentation changes

- Update `README.md` startup/build notes if the build modes change.
- Document any asset-cache behavior that matters for reverse-proxy deployments.

### What this track should **not** do

- Do **not** migrate to Vite just to get code splitting.
- Do **not** change both bundler and frontend architecture at the same time.
- Do **not** start with chunk splitting before the build-mode basics land.

### Candidate future backlog slices

#### OPT04.1 — Production minify and sourcemap gating
**Deliverables**
- add explicit dev/prod build mode behavior
- minify production bundle
- stop always emitting production sourcemaps unless explicitly requested

**Primary files**
- `src/bun/build-mainview.ts`
- `src/bun/index.ts`
- possibly build scripts in `package.json`

#### OPT04.2 — Cacheable asset-serving path
**Deliverables**
- serve built frontend assets from a small asset path instead of only `/index.js`
- add cache headers appropriate for static versioned assets
- keep HTML bootstrap behavior correct

**Primary files**
- `src/bun/index.ts`
- `src/mainview/index.html`
- build-related docs/tests

#### OPT04.3 — Optional build splitting
**Deliverables**
- enable chunk-capable frontend output only if post-OPT04.1 metrics still justify it
- wire HTML/runtime asset resolution to generated chunk entrypoints
- confirm lazy markdown and related imports actually split out

**Primary files**
- `src/bun/build-mainview.ts`
- `src/bun/index.ts`
- `src/mainview/index.html` or injected runtime HTML logic

---

## OPT05 — RPC payload accounting and targeted refresh/broadcast coalescing

**Cross-reference to original doc:** `optimization-proposals.md` §§3.2, 2.6, and 6.2.

### Why this one is worth doing

The earlier document suggested large transport changes, including binary websocket payloads. That is too aggressive for a first pass.

The current repo already has some transport discipline:
- typed request envelopes,
- priorities,
- cancellation,
- reconnect logic,
- coalesced worktree invalidation events.

The remaining likely gains are more tactical:
- find which calls actually move a lot of data,
- dedupe or batch the noisy ones,
- avoid introducing transport complexity unless the measurements demand it.

A likely hot path is thread-status refresh:
- `src/mainview/App.tsx` polls thread statuses on an interval,
- the refresh path can also fetch selected-thread detail when needed,
- the transport is still purely JSON.

### Changes this track would cause

#### Code changes

**Payload accounting**
- Record coarse serialized size estimates for selected RPC responses and websocket pushes.
- Use that data to identify the highest-volume endpoints/events before changing behavior.

**Client-side dedupe/coalescing**
- Tighten `listThreadStatuses` refresh behavior so repeated equivalent refreshes can share or skip work when one is already in flight.
- Reduce overlap between visibility-triggered refreshes, poll refreshes, and selected-thread detail refreshes where possible.

**Server-side event coalescing where justified**
- Reuse the pattern already present in `src/mainview/app/invalidation-events.ts` and corresponding backend invalidation handling.
- If telemetry shows repeated thread-status pushes or closely spaced redundant events, batch them or reduce them to “dirty thread ids” style invalidations.

#### Test changes

- Add tests for deduped refresh behavior.
- Add tests for any new batch/invalidation envelope format.
- Keep the transport shape conservative and easy to reason about.

#### Documentation changes

- Minimal. Most of this should stay internal unless it changes public behavior.

### What this track should **not** do

- Do **not** switch to MessagePack or CBOR yet.
- Do **not** redesign the websocket protocol in the first pass.
- Do **not** batch everything indiscriminately; target only demonstrated hot paths.

### Candidate future backlog slices

#### OPT05.1 — RPC payload measurement
**Deliverables**
- add per-method coarse payload accounting
- identify the top response and push-volume paths
- feed those numbers into the runtime stats output

**Primary files**
- `src/bun/index.ts`
- diagnostics/reporting files

#### OPT05.2 — Thread-status refresh dedupe
**Deliverables**
- reduce redundant `listThreadStatuses` work on the client
- preserve selected-thread detail correctness
- keep visibility-triggered refresh behavior correct

**Primary files**
- `src/mainview/App.tsx`
- `src/mainview/thread-status-refresh.ts`
- related tests

#### OPT05.3 — Targeted status/invalidation batching
**Deliverables**
- batch or coalesce only the event streams proven noisy by OPT05.1
- keep payload contracts simple
- avoid protocol churn outside the selected hot path

**Primary files**
- `src/bun/index.ts`
- any frontend invalidation subscribers

---

## OPT06 — Cron execution guardrails and telemetry

**Cross-reference to original doc:** `optimization-proposals.md` §§3.3 and 6.2.

### Why this one is worth doing

`src/bun/sidecar-cron-runner.ts` is already disciplined in some ways:
- it claims due cron rows from the DB,
- it runs jobs sequentially within one schedule fire,
- it monitors thread completion and updates run status.

But there is still a practical gap:

- separate schedule fires can still overlap globally,
- there is no explicit global concurrency cap for spawned cron work,
- there is not much telemetry about queue pressure or run duration.

That is enough to justify a focused slice, especially because the repo already has a reusable concurrency limiter in `src/bun/project-procedures/shared.ts`.

### Changes this track would cause

#### Code changes

**Global or scheduler-scoped concurrency limit**
- Introduce a bounded concurrency limit for cron execution.
- Prefer reusing existing queue/concurrency primitives rather than inventing a new scheduler abstraction.

**Telemetry**
- Record:
  - active cron-run count,
  - pending queue count,
  - run duration,
  - timeout count,
  - saturation events if jobs had to wait.
- Feed selected counters into the same diagnostic story as OPT01.

**Optional persistence enhancement**
- If the telemetry is operationally useful, add a small persisted duration field or derived reporting path for cron runs.
- Keep schema changes minimal and justified.

#### Test changes

- Add tests around the concurrency cap behavior.
- Add tests around run-duration/timeout telemetry if persisted or surfaced.
- Confirm manual `runCronJobById()` behavior remains predictable.

#### Documentation changes

- Update cron docs only if operator-visible behavior changes, such as explicit queueing or saturation semantics.

### What this track should **not** do

- Do **not** build a persistent DB-backed cron queue yet.
- Do **not** pool VM2 sandboxes yet.
- Do **not** redesign the cron UX before runtime guardrails exist.

### Candidate future backlog slices

#### OPT06.1 — Cron concurrency cap
**Deliverables**
- add a bounded concurrency limit for cron-executed thread launches
- preserve current success/failure semantics
- make saturation behavior explicit and testable

**Primary files**
- `src/bun/sidecar-cron-runner.ts`
- `src/bun/project-procedures/shared.ts`
- cron tests

#### OPT06.2 — Cron duration and saturation telemetry
**Deliverables**
- record run duration and queue-pressure counters
- expose them through diagnostics or run records
- use the data to decide whether deeper scheduler changes are needed

**Primary files**
- `src/bun/sidecar-cron-runner.ts`
- `src/bun/db.ts` if persistence changes are needed
- diagnostics/reporting files

---

## 3. Suggestions intentionally not selected for the first backlog

These suggestions from [docs/optimization-proposals.md](./optimization-proposals.md) should **not** become first-wave optimization backlog items.

### Already implemented enough to skip

#### Virtualization and lazy rendering
**Original reference:** §§2.2 and 2.4.

Why not selected:
- transcript virtualization is already in `chat-workspace.tsx`
- markdown loading is already lazy
- large-message preprocessing is already workerized and cached
- diff parsing is already workerized and cached

If a later profile still points at message rendering, it should be a **small follow-up audit**, not a re-opened “virtualize everything” project.

#### Persistent Git cache
**Original reference:** §5.1.

Why not selected:
- backend git history already has cache envelopes, prefetching, and diff request coalescing
- frontend already caches selected git history and commit diffs
- on-disk git caches would add invalidation complexity around branch movement, gc, and worktree churn

This should only return if telemetry proves git subprocess cost is still dominant after the first-wave slices.

### Deferred until telemetry exists

#### Event-system abstraction
**Original reference:** §2.6.

Why deferred:
- there is already coalesced worktree invalidation machinery
- more abstraction is easy to add and hard to remove
- this should follow measured event storms, not precede them

#### Backend monolith refactor for performance
**Original reference:** §3.1.

Why deferred:
- `project-procedures.ts` and `index.ts` are large, but that alone does not prove runtime gain from decomposition
- there is value here for maintainability, but it should not outrank clearer performance work

#### Pi/model-catalog tuning
**Original reference:** §3.4.

Why deferred:
- current model-catalog and provider-auth behavior appears adequate
- transport, DB, and mainview state coupling look like better first targets

#### Filesystem/worktree-path tuning
**Original reference:** §5.2.

Why deferred:
- may be worth revisiting later
- not enough evidence yet that this outranks DB/build/RPC work

#### Memory and leak-prevention sweep
**Original reference:** §6.1.

Why deferred:
- broad memory work without telemetry often turns into guesswork
- small memory counters should come in through OPT01 first

#### Runtime tuning flags and settings
**Original reference:** §7.3.

Why deferred:
- the repo should prefer better defaults before surfacing more knobs
- user-tunable perf flags tend to multiply support complexity

### Rejected for now because cost/risk looks too high

#### Binary websocket protocol
**Original reference:** §3.2.

Why rejected now:
- would increase protocol complexity on both sides
- measurement has not shown a need strong enough to justify it
- targeted coalescing should come first

#### VM2 pooling / sandbox reuse
**Original reference:** §6.3.

Why rejected now:
- isolation guarantees are more important than a speculative speedup
- the risk/reward ratio is poor without evidence of sandbox setup dominating runtime

#### Full scheduler rewrite with persistent queue
**Original reference:** §3.3.

Why rejected now:
- too much machinery for a first pass
- concurrency guardrails and telemetry should land first

---

## 4. Recommended execution order

The slices should not all start at once.

### Phase A — establish measurement and obvious infrastructure wins
1. **OPT01 — telemetry and benchmark baseline**
2. **OPT02 — SQLite tuning and targeted query-plan fixes**
3. **OPT04.1 — production minify and sourcemap gating**

### Phase B — use the new numbers to narrow hot paths
4. **OPT03 — mainview controller decomposition and memo audit**
5. **OPT05 — RPC payload accounting and targeted coalescing**

### Phase C — operational guardrails and only-then optional deeper work
6. **OPT06 — cron concurrency guardrails and telemetry**
7. **OPT04.2 / OPT04.3 — cacheable asset serving and optional chunk splitting, if still justified**

---

## 5. Translation rules for the future `agents-todo.md`

When this proposal is eventually turned into backlog slices, each slice should follow these rules.

### Rule 1 — one slice, one optimization move
A single todo item should not mix multiple subsystems unless one clearly depends on the other.

Good:
- `OPT02.1 — Enable conservative WAL-mode tuning`

Bad:
- `Enable WAL, split App.tsx, add cron queue, and shrink bundle`

### Rule 2 — every slice must point back to both docs
Each todo entry should cite:
- this proposal document, and
- the originating section(s) in [docs/optimization-proposals.md](./optimization-proposals.md).

### Rule 3 — every slice must state its non-goals
This is especially important for optimization work, because scope creep is common.

### Rule 4 — every slice should include explicit verification
Examples:
- “run starvation harness before/after and record p95”
- “check `EXPLAIN QUERY PLAN` for `listThreads` and `listProjects`”
- “confirm selected-thread polling behavior remains correct”

### Rule 5 — backlog generation must address current scope rules
Before these items are copied into [agents-todo.md](../agents-todo.md), either:
- update the rules there to allow this optimization document as a valid source, or
- create a separate optimization backlog document.

---

## 6. Proposed future slice list

This is the condensed list that should eventually become backlog items.

| Slice ID | Title | Depends on | Primary source sections |
|---|---|---|---|
| OPT01.1 | Runtime stats collector | none | original §§6.2, 7.2; this doc OPT01 |
| OPT01.2 | Harness percentile and memory reporting | OPT01.1 | original §§6.2, 7.2; this doc OPT01 |
| OPT01.3 | First baseline write-up | OPT01.1, OPT01.2 | original §§6.2, 7.2; this doc OPT01 |
| OPT02.1 | Enable conservative WAL-mode tuning | OPT01.1 preferred, but not strictly required | original §§4.1, 4.2; this doc OPT02 |
| OPT02.2 | Query-plan audit and missing composite indexes | OPT02.1 | original §§4.1, 4.2; this doc OPT02 |
| OPT02.3 | SQLite retry metrics | OPT01.1 | original §§4.1, 4.2; this doc OPT02 |
| OPT03.1 | Extract thread-status and selected-thread controller | OPT01 baseline preferred | original §§2.1, 2.3; this doc OPT03 |
| OPT03.2 | Extract project/worktree and git-history controllers | OPT03.1 | original §§2.1, 2.3; this doc OPT03 |
| OPT03.3 | Targeted derived-state and memo cleanup | OPT03.1 | original §§2.1, 2.3; this doc OPT03 |
| OPT04.1 | Production minify and sourcemap gating | none | original §§2.5, 7.1; this doc OPT04 |
| OPT04.2 | Cacheable asset-serving path | OPT04.1 | original §§2.5, 7.1; this doc OPT04 |
| OPT04.3 | Optional build splitting | OPT04.1, OPT04.2, fresh measurements | original §§2.5, 7.1; this doc OPT04 |
| OPT05.1 | RPC payload measurement | OPT01.1 | original §§3.2, 2.6, 6.2; this doc OPT05 |
| OPT05.2 | Thread-status refresh dedupe | OPT05.1 | original §§3.2, 2.6; this doc OPT05 |
| OPT05.3 | Targeted status/invalidation batching | OPT05.1 | original §§3.2, 2.6; this doc OPT05 |
| OPT06.1 | Cron concurrency cap | OPT01 baseline preferred | original §§3.3, 6.2; this doc OPT06 |
| OPT06.2 | Cron duration and saturation telemetry | OPT01.1, OPT06.1 | original §§3.3, 6.2; this doc OPT06 |

---

## Conclusion

The right interpretation of the original optimization document is:

- **do not** backlog every idea,
- **do not** duplicate work already implemented,
- **do** convert the remaining believable opportunities into a small number of measurable, sliceable tracks.

The recommended first-wave work is therefore:

1. measurement,
2. DB tuning,
3. production bundle/build cleanup,
4. targeted frontend controller decomposition,
5. targeted RPC coalescing,
6. cron guardrails.

Everything else should wait for evidence.

That gives you a backlog plan that is much more likely to produce real gains and much less likely to create “optimization theater.”
