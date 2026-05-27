# Front-end memory leak audit — 2026-05-06

## Scope and method

Static follow-up audit of `src/mainview/` after the 2026-05-05 remediation work. I focused on the current long-lived crash report: an idle or mostly-idle Mainview window eventually exhausts browser memory. I inspected current frontend state retention, background pollers, media/data-url rendering, terminal lifecycle, markdown/highlighting dependencies, and dependency lock state.

This pass did not include a live heap profile. Findings below are ranked by static confidence and crash plausibility.

## Executive summary

`@streamdown/code` / Shiki remains a real retained-cache risk, but it is unlikely to be the whole idle-crash story by itself. If the window is truly idle with no new unique code blocks being rendered, its token cache should mostly plateau. That points the primary idle investigation back toward timers, background RPC/state churn, websocket push handling, and renderer surfaces that keep doing work without user interaction.

`react-syntax-highlighter`, Prism, and refractor are absent from runtime dependencies and lockfile. The likely idle contributors are repeated thread/plugin/model refresh work, retained large markdown/message strings, data URL image duplication, and any active terminal or stuck working-thread refresh loop.

## Findings

### 1. Idle pollers and refresh loops can grow or churn without user input

- **Severity:** P0/P1 for visible idle sessions with a stuck working thread, admin plugin refreshes, or large thread lists; otherwise P1/P2.
- **Confidence:** High.
- **Files:**
  - `src/mainview/app/use-thread-status-controller.ts:46-65`, `:383-430`, `:438-566`
  - `src/mainview/app/settings-panel.tsx:2394-2427`, `:2768-2796`
  - `src/mainview/App.tsx:2771-2845`
  - `src/mainview/app/frontend-memory-telemetry.ts:113-116`

Mainview still has recurring idle work. Visible tabs run thread discovery every 5 seconds, working-thread status polling every 3 seconds, project-skill refresh every 30 seconds, model refresh every 10 minutes, and view-specific cron/diff polling. Admin settings panels refresh plugin inventory every 30 seconds even while the settings modal is closed, and that path still refreshes plugin access groups.

This better matches a crash after the app is simply left open: memory growth can happen without new markdown/code content if a background call repeatedly allocates snapshots, a selected thread is stuck `working`, a plugin inventory/access-group result is large, or state commits cause repeated React work.

**Recommended mitigation:** add a true idle/quiescent mode for diagnosis, skip equivalent thread-store commits, gate closed-settings refreshes by visibility, skip plugin access-group refreshes unless inventory changed or settings is opened, and add counters for each background poll's bytes/commit count.

### 2. `@streamdown/code` keeps unbounded module-level Shiki caches

- **Severity:** P1 if long sessions render many distinct code blocks; less likely as the sole cause of a truly idle crash.
- **Confidence:** High for retained cache behavior; medium as the primary idle-crash mechanism.
- **Files:**
  - `src/mainview/app/message-markdown.tsx:6`, `:23-25`, `:143-149`, `:170-187`
  - `node_modules/@streamdown/code/dist/index.js:1`
  - `package.json` dependencies: `streamdown`, `@streamdown/code`, transitive `shiki`

Current app code installs `@streamdown/code` globally for static `Streamdown` renders. The installed `@streamdown/code@1.1.1` bundle declares module-level maps:

- `c = new Map` for highlighter promises keyed by language/theme.
- `p = new Map` for token results keyed by language/themes/code length/code prefix/code suffix.
- `s = new Map` for pending listeners keyed by the same token key.

There is no visible eviction, byte budget, max-entry cap, or public dispose hook in the installed bundle. Streamdown's own docs describe the plugin as Shiki-backed and explicitly advertise token caching. Shiki's performance guide says highlighter instances are expensive and should be reused, but also that `dispose()` is needed when no longer needed because resources cannot be GC'd automatically.

**Retention chain:**

`message-markdown.tsx` static render → `<Streamdown plugins={{ code }}>` → `@streamdown/code.highlight()` → module-level token cache `p` retains token arrays for every unique code block → module-level highlighter cache `c` retains language/theme highlighters → Shiki grammar/theme data remains live for the lifetime of the page.

**Why this still matters:** AI-agent transcripts commonly generate many one-off code blocks, stack traces, diffs, JSON snippets, and command output. Even if React virtualizes rows or the user switches threads, the dependency's module-level caches survive. However, with no new unique code being rendered, this cache should not keep growing quickly, so it should be treated as a contributor or baseline-retention risk rather than the only idle-crash explanation.

**Recommended mitigation:** Temporarily disable `@streamdown/code` in Mainview and use Streamdown's plain code rendering path, or replace it with a local bounded highlighter adapter. If syntax highlighting remains required, add an explicit LRU/byte budget around token results and a way to dispose highlighters on page unload/HMR.

### 3. Markdown preprocessing cache is count-bound, not byte-bound

- **Severity:** P1 for code-heavy or long-output threads.
- **Confidence:** High.
- **Files:**
  - `src/mainview/app/message-preprocessing-client.ts:18`, `:100-113`, `:400-420`
  - `src/mainview/app/message-preprocessing.ts`

`MessagePreprocessingRequestManager` keeps 16 cached render plans. Each plan can retain large `code` and `markdown` strings split from a long message. The cache has an entry count cap only; it has no byte budget and no awareness of code-heavy plans.

This is separate from the Streamdown/Shiki cache. A single 200 KB assistant response split into many prepared blocks can stay retained as a plan even after the visible transcript no longer needs it.

**Recommended mitigation:** make prepared-plan caching byte-budgeted, skip caching above a per-message size threshold, or cache only structural metadata while reusing the original message text.

### 4. Thread messages are retained by count, not bytes

- **Severity:** P1/P2 depending on transcript size.
- **Confidence:** High.
- **Files:**
  - `src/mainview/app/thread-message-retention.ts:3-12`
  - `src/mainview/App.tsx:1911-1924`

`MAX_RETAINED_THREAD_MESSAGES = 500` bounds message count, but 500 messages can still include very large assistant text, command output, tool output, and file diff strings. This can raise baseline heap substantially after a long run, even when the UI appears idle.

The visible-message cache now has a text-byte cap, but the source `threadMessages` array does not.

**Recommended mitigation:** introduce a byte-budgeted transcript state cap and/or replace large old message bodies with summary placeholders that can be rehydrated on demand.

### 5. Transcript media still creates large `data:` URL strings and decoded image surfaces

- **Severity:** P1 for screenshot/image-heavy threads.
- **Confidence:** Medium-high.
- **Files:**
  - `src/mainview/app/transcript-media-payload-cache.ts:3-4`, `:66-78`
  - `src/mainview/app/use-visible-messages.ts:656-667`
  - `src/mainview/app/chat-workspace.tsx:670-680`
  - `src/mainview/app/message-ui.tsx:707-739`

The loaded transcript media cache is now byte-bound at 8 MiB, which is good. However, rendering still converts base64 payloads to `data:` URL strings for each image/screenshot. That duplicates large strings and then lets the browser allocate decoded image surfaces. Also, `mergeTranscriptMediaPayloadData()` combines byte-bounded loaded payloads with any visible payloads already carried on `threadMessages`; those visible payloads are not byte-budgeted at this merge layer.

**Recommended mitigation:** use `Blob` + `URL.createObjectURL()` with revocation on eviction/unmount, and ensure all media sources pass through one byte-budgeted cache rather than mixing direct visible payloads with cached payloads.

### 6. Visible-tab thread discovery poll continuously allocates and commits new thread stores

- **Severity:** P2 alone; P1 as a GC-pressure amplifier.
- **Confidence:** High.
- **Files:**
  - `src/mainview/app/use-thread-status-controller.ts:46-65`, `:438-566`
  - `src/mainview/app/thread-store.ts`

While the document is visible, thread discovery polls `listThreads({ offset: 0, limit: 100 })` every 5 seconds. The response objects are reduced into a new `ThreadStore`, and `setThreadStore(() => nextDiscoveredThreadStore)` runs even when the effective summaries did not change. This is not a classic retained leak, but it creates continuous allocation, React updates, and sidebar re-render pressure for an idle visible tab.

**Recommended mitigation:** compare a compact thread-list fingerprint before committing state; skip state updates when loaded summaries are equivalent. Longer term, prefer push invalidations plus targeted refresh over unconditional 5-second list snapshots.

### 7. Closed settings panel still refreshes plugin access groups every 30 seconds

- **Severity:** P2, P1 for large plugin/access-group state.
- **Confidence:** Medium-high.
- **Files:**
  - `src/mainview/app/settings-panel.tsx:2394-2427`, `:2768-2796`

The previous duplicate settings-panel interval was fixed. The remaining closed-panel silent refresh skips details/settings snapshots, but still calls `listPluginAccessGroups()` every 30 seconds through `loadPluginInventory()` when `onPluginAccessGroupsChange` exists. This can still allocate repeated access-group snapshots in admin sessions while settings is closed.

**Recommended mitigation:** only refresh access groups when inventory changes, settings opens, or a plugin/access event invalidates them. For silent closed-panel polling, skip access-group loading unless explicitly requested.

### 8. Active `ghostty-web` terminal remains a bounded but high-churn memory source

- **Severity:** P1 if a terminal is open and producing output; P2 otherwise.
- **Confidence:** Medium.
- **Files:**
  - `src/mainview/app/terminal-workspace.tsx:41`, `:92-160`, `:332-338`
  - `node_modules/ghostty-web/dist/ghostty-web.js`

The prior inactive-terminal leak is fixed: only the active terminal mounts. The active terminal still keeps `ghostty-web` WASM state, canvas renderer state, and 2,000 lines of scrollback. `ghostty-web` dispose appears to clean up the WASM terminal and observers, so I do not see clear evidence of a dependency leak here. But a foreground noisy terminal can still allocate steadily and should be excluded during reproduction.

**Recommended mitigation:** reproduce with no terminal open. If crashes stop, add terminal output throttling/backpressure, a smaller scrollback option, and telemetry for active terminal scrollback/output bytes.

## Areas that look improved or lower risk

- `react-syntax-highlighter`, Prism, and refractor are not present in runtime dependency manifests/lockfile.
- Inactive terminals are no longer mounted.
- RPC requests now have a default 120s timeout and key content requests have abort/timeout cleanup.
- Transcript media payload cache is now byte-bound, though rendering still duplicates payloads via data URLs.
- Worker managers now timeout jobs and idle-terminate workers.
- Dynamic CSS rules are capped and evicted.

## Recommended next actions

1. **Fast idle isolation test:** add a diagnostic quiescent mode that disables non-essential background pollers/refreshes while preserving the open UI. If the crash stops, re-enable pollers one by one.
2. **Check stuck work:** verify whether any thread remains in `working`; that forces selected detail refreshes and working-status polls while the user is idle.
3. **Reduce idle churn:** skip equivalent `ThreadStore` commits, gate closed-settings refreshes by visibility, and skip closed-settings access-group refreshes unless needed.
4. **Dependency isolation test:** run a build with `@streamdown/code` disabled while leaving Streamdown markdown rendering enabled. This isolates retained syntax-highlighting cache from true idle growth.
5. **Add telemetry:** include counts/approx bytes for background RPC response sizes, poll commit counts, prepared markdown cache bytes, thread message text bytes, data URL/object URL counts, and active terminal scrollback length.
6. **Bound retained text and media:** add byte budgets to `MessagePreprocessingRequestManager` and `retainRecentThreadMessages()`, and move transcript media to revocable object URLs.

## External references

- Streamdown `@streamdown/code` docs: Shiki-backed syntax highlighting and token caching: https://streamdown.ai/docs/plugins/code
- Shiki performance guide: cache highlighters, dispose highlighter resources when no longer needed, and prefer fine-grained bundles for web memory usage: https://shiki.style/guide/best-performance
