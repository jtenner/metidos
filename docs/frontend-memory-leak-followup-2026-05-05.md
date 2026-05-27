# Front-end memory leak follow-up — 2026-05-05

## Context

The Mainview frontend still crashes after less than an hour of idle time after the earlier 2026-05-05 memory-remediation pass. This follow-up re-audits idle-time paths: mounted-but-hidden UI, background intervals, websocket event handlers, request caches, media retention, terminal streaming, and plugin/settings refresh work.

## New high-confidence idle finding

### Duplicate settings panels ran duplicate background plugin refresh loops

- **Severity:** P0/P1 for admin sessions with plugins or slow plugin sidecars.
- **Confidence:** High.
- **Files:**
  - `src/mainview/App.tsx`
  - `src/mainview/app/settings-panel.tsx`

`App.tsx` mounts both desktop and mobile header trees at the same time and hides one with responsive CSS. Each header mounted its own `SettingsPanel`. For local-operator sessions, each `SettingsPanel` started a closed-panel background interval every 30 seconds.

Before this follow-up, every closed-panel tick called `loadPluginInventory(...)`, which then fetched plugin inventory, sidecar diagnostics, plugin settings for every plugin, and plugin access groups. Because both panels were mounted, idle admin windows performed the work twice. Slow calls could overlap with the next interval, keeping response payloads, settings snapshots, diagnostics, promises, and state closures alive longer than necessary.

**Retention / churn chain:**

mounted desktop `SettingsPanel` + mounted mobile `SettingsPanel` → two 30s intervals → plugin inventory/details/settings/access-group RPCs → state updates in hidden and visible panels → retained plugin snapshots/diagnostics and repeated idle allocations.

## Remediation applied in this pass

- `SettingsPanel` now accepts an `active` prop.
- Desktop passes `active={isDesktopViewport}`; mobile passes `active={!isDesktopViewport}`.
- Inactive settings panels close themselves and do not run open-panel or background loading effects.
- Closed-panel background plugin refresh now skips details (`includeDetails: false`), so idle refreshes do not load sidecar diagnostics or per-plugin settings snapshots.
- Silent plugin inventory refreshes are deduped so a slow background tick cannot overlap with the next silent tick.

## Remaining suspects if the crash persists

1. **Active terminal output.** Only the active terminal is mounted now, but a noisy foreground terminal still streams indefinitely into Ghostty with 2,000 lines of client scrollback. A long-running verbose process can still grow renderer/decoded terminal memory while the app appears idle.
2. **Data URL image rendering.** Transcript media is byte-budgeted, but screenshot/user-image rendering still creates `data:` URL strings and decoded image surfaces. Large screenshots can create significant renderer memory even with a 16 MiB base64 cache.
3. **Message preprocessing and diff parse result caches.** Worker request queues are bounded and timed out, but ready caches remain count-bounded, not byte-bounded. Large prepared markdown/diff result objects can persist across thread switches.
4. **Extension UI editor/status state.** `append_editor_text` can grow per-thread extension editor text if a plugin keeps appending while the thread remains open.
5. **Thread store retention.** The thread store keeps discovered/opened thread summaries across pagination and project lifecycle changes. This is less likely to produce a one-hour idle crash alone, but it can raise the baseline heap.

## Suggested next verification

Use a browser heap timeline while idling as the local operator with settings closed. Watch for growth in:

- `RpcPluginInventory`, `RpcPluginSettingsSnapshot`, and diagnostics objects.
- `PreparedMessageRenderPlan` / `DiffParseResult` objects.
- large strings beginning with `data:image/` or terminal output fragments.
- Ghostty terminal structures if a terminal is active.
