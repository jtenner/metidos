# Front-end memory leak audit — 2026-05-05

## Scope and method

This is a static audit of the Mainview front-end under `src/mainview/`. I focused on long-lived browser state: React state, module-level stores, WebSocket/RPC lifetimes, worker queues, interval/listener cleanup, virtualized transcript media, terminal rendering, and count-based caches that retain large strings.

I did not run a heap profile in this pass. Findings below are therefore categorized by static confidence and crash potential.

## Executive summary

The most plausible hour-to-crash paths are:

1. **Open terminals:** every terminal is mounted, connected, and writing output even when hidden. Each terminal has a 10,000-line scrollback. A few noisy terminals can grow renderer memory for the whole window.
2. **Transcript media:** screenshot/chat-image payloads are cached by item count, not bytes. Sixty-four large base64 payloads can be hundreds of MB before decoded image memory is considered.
3. **Hung/slow RPCs:** the shared RPC layer has no default timeout. Some content/media requests are not abortable on thread change, so pending maps can retain closures, params, and eventually large payloads.
4. **Unbounded per-thread composer state:** draft and attachment stores keep keys forever and can retain failed image attachments until explicitly cleared.
5. **Large diff/history caches:** git diff and history caches are bounded by entry count, not bytes, and history pages can grow inside each cached result.

## Findings

### 1. Inactive terminals remain fully mounted, connected, and accumulating scrollback

- **Severity:** P0 if any terminal emits steady output; otherwise P1.
- **Confidence:** High.
- **Files:**
  - `src/mainview/app/terminal-workspace.tsx:99`
  - `src/mainview/app/terminal-workspace.tsx:121-155`
  - `src/mainview/app/terminal-workspace.tsx:361-366`

`TerminalWorkspace` renders a `GhosttyTerminal` for every terminal in `terminals.map(...)`, not just the active terminal. Each `GhosttyTerminal` creates a Ghostty terminal instance with `scrollback: 10000`, opens a terminal WebSocket, and writes every `output` / `replay` frame into that terminal instance. Inactive terminals are only hidden with CSS; they are not suspended.

**Retention chain:**

`TerminalWorkspace` → one mounted `GhosttyTerminal` per terminal → Ghostty terminal instance → 10,000-line scrollback + rendering buffers → WebSocket `onmessage` closure → continuous `nextTerm.write(...)` calls.

Because inactive terminals continue to receive and process output, memory grows with every open terminal, not just the visible one. A terminal running a verbose process for an hour is a direct crash candidate.

**Suggested fix:** mount/connect only the active terminal, or explicitly suspend inactive terminal sockets. If inactive terminal replay is required, move scrollback retention to the backend and request a bounded replay on activation. Also consider a much smaller client scrollback default and a byte/line budget across all terminals.

### 2. Transcript media payload cache is count-bound, not byte-bound

- **Severity:** P0/P1 for media-heavy threads.
- **Confidence:** High.
- **Files:**
  - `src/mainview/App.tsx:279`
  - `src/mainview/App.tsx:530-531`
  - `src/mainview/App.tsx:1330-1342`
  - `src/mainview/App.tsx:3536-3541`
  - `src/mainview/app/message-ui.tsx:707-738`

`loadedTranscriptMediaPayloads` retains up to `TRANSCRIPT_MEDIA_PAYLOAD_CACHE_LIMIT = 64` payload strings. The limit is by payload count, not decoded byte size or base64 length. Screenshot and image payloads can be large; 64 large screenshots can retain hundreds of MB in JS strings alone.

The render path then turns those strings into `data:` URLs for `<img src=...>`, which can add additional string and decoded image memory pressure. The cache is cleared only when `selectedThreadId` changes.

**Retention chain:**

visible transcript row requests media → `getThreadMessageContent` returns base64 → `loadedTranscriptMediaPayloads` stores base64 in a `Map` → `transcriptMediaPayloads` combines it with visible payloads → `ScreenshotMessage` / user image rendering create `data:` URLs → browser image decoder allocates decoded surfaces.

Virtualizing transcript rows reduces mounted DOM, but it does not bound JS heap retained by this cache.

**Suggested fix:** use a byte-budgeted media cache, not a count budget. Prefer object URLs backed by `Blob`s and revoke them on eviction/thread change. Add thumbnails or lazy expansion for screenshots. Evict media tied to rows that are outside the virtual window unless explicitly expanded.

### 3. Thread message content requests are not abortable and have no timeout

- **Severity:** P1.
- **Confidence:** High.
- **Files:**
  - `src/mainview/App.tsx:1300-1364`

`requestThreadMessageContent()` adds a request key to `threadMessageContentRequestKeysRef`, calls `procedures.getThreadMessageContent({ threadId, messageId }, { priority: "foreground" })`, and removes the key only in `.finally(...)`.

There is no `AbortController`, no `timeoutMs`, and no cleanup on selected thread change. If the request stalls while the WebSocket remains open, the request key and RPC pending entry can live indefinitely. If many media/output rows are expanded or mounted, this can build up.

Even when the user switches threads, the response is merely ignored after it arrives; the full payload can still be transferred and allocated first.

**Retention chain:**

transcript row missing content → `threadMessageContentRequestKeysRef` stores key → shared RPC `pendingRequests` stores request → promise closure captures thread/message ids and state setters → stalled request never settles → key and pending request remain.

**Suggested fix:** track an `AbortController` per content request, abort all content requests on selected thread change/unmount, and pass a method-specific `timeoutMs`. Add a small concurrency cap for media/content hydration.

### 4. Shared RPC requests have no default timeout

- **Severity:** P1, P0 if a large request is involved.
- **Confidence:** High.
- **Files:**
  - `src/mainview/index.ts:336`
  - `src/mainview/index.ts:779-1027`

The shared RPC client stores all in-flight calls in `pendingRequests`. A request only times out when the caller passes `options.timeoutMs`; otherwise it can remain pending until a response, abort signal, socket close, or transport disable.

Several calls pass no timeout. Some pass an abort signal but no time limit. This is especially risky when the WebSocket stays open but the backend drops, delays, or never completes one logical response.

**Retention chain:**

`sendRequest()` → `pendingRequests.set(id, ...)` → request params and promise callbacks retained → no timeout → no response → permanent entry. Call-specific request caches then wait on the same promise and may retain additional data.

The recently added `sendThreadMessage` timeout helps one large path, but the transport layer itself still has no default safety net.

**Suggested fix:** enforce a default RPC timeout in `sendRequest()` and allow explicit longer method-specific overrides. Add diagnostics that report pending request count, age, method, priority, and approximate param size.

### 5. Chat composer draft and image stores grow by thread key without pruning

- **Severity:** P2 normally, P1 with image-heavy failed drafts.
- **Confidence:** High.
- **Files:**
  - `src/mainview/controls/chat-composer-draft-store.ts:11-12`
  - `src/mainview/controls/chat-composer-draft-store.ts:93-107`
  - `src/mainview/controls/chat-composer-image-attachments.ts:12-17`
  - `src/mainview/controls/chat-composer-image-attachments.ts:90-153`
  - `src/mainview/thread-send.ts:299-309`

The draft store keeps `chatComposerDrafts` and `initializedDraftKeys` forever. The image attachment store keeps `chatComposerImageAttachmentsByKey`, `pendingImageAttachmentReadsByKey`, and resolver arrays forever. Clearing image attachments sets an empty array; it does not delete the key.

Successful sends clear the current draft/images, but failed sends restore text and image attachments. If a user visits many threads, creates drafts, or repeatedly fails image sends, these module-level stores retain per-thread state for the lifetime of the window.

**Suggested fix:** delete empty draft/image entries, add LRU/TTL pruning by draft key, and enforce a byte budget for image attachments across all drafts. When a thread is deleted or no longer reachable, remove its draft/image entries.

### 6. Git history and commit diff caches are entry-count bounded, not byte bounded

- **Severity:** P2, P1 when opening large diffs.
- **Confidence:** Medium-high.
- **Files:**
  - `src/mainview/app/git-history-state.ts:29-31`
  - `src/mainview/app/git-history-state.ts:96-121`
  - `src/mainview/app/use-git-history-controller.ts:132-141`
  - `src/mainview/app/use-git-history-controller.ts:194-239`

The commit diff cache keeps 24 full `diffText` strings. The git history result cache keeps 8 worktree history results. Each cached history result can grow as pagination appends entries; there is no per-result entry cap or byte cap.

This is not likely to crash an idle chat-only window, but it can retain large diffs after the modal closes and after the user switches worktrees.

**Suggested fix:** make both caches byte-budgeted. Cap history entries per cached worktree. Consider dropping commit diff text when closing the modal unless explicitly pinned/reopened recently.

### 7. Worker managers retain large source strings while jobs are pending and never idle-terminate

- **Severity:** P2.
- **Confidence:** Medium.
- **Files:**
  - `src/mainview/app/message-preprocessing-client.ts:81-93`
  - `src/mainview/app/message-preprocessing-client.ts:155-172`
  - `src/mainview/app/diff-parsing-client.ts:63-66`
  - `src/mainview/app/diff-parsing-client.ts:137-151`

The markdown preprocessing manager stores pending request text in `requestToText`. The diff parser stores full pending diff text in `pendingDiffTextByKey`. Listener cleanup does remove abandoned pending jobs when components unmount, and ready caches are count-bounded, so this is less severe than the terminal/media paths.

The remaining risk is a stalled worker or a long-running parse while the component stays mounted. There is no job timeout, queue limit, or idle worker termination.

**Suggested fix:** add worker job timeouts, queue limits, and idle termination/recreation. For diff parsing, avoid retaining more full diff strings than necessary.

## Areas audited that look properly cleaned up

- Window/document event listeners generally return cleanup functions.
- Polling intervals in thread status, cron jobs, diff polling, and model catalog refresh are cleared on effect cleanup.
- Dynamic CSS variable rules are removed on unmount; general dynamic rules have an eviction cap.
- `useVisibleMessages()` now prunes retired visible-message cache entries.
- Transcript measured-height state is pruned to active grouped message keys.

## Recommended triage order

1. Fix terminal mounting/streaming first. It is the clearest hour-to-crash mechanism.
2. Add byte-budgeted transcript media eviction and object URL revocation.
3. Add default RPC timeouts and content-request abort cleanup.
4. Prune composer draft/image stores by key and bytes.
5. Convert diff/history caches from count limits to byte limits.
6. Add worker timeouts/idle termination.
