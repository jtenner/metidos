# 2026-04-16 Accessibility Audit

## Scope

This document is a source-level accessibility audit of the current main application UI in `src/mainview/` as inspected on **2026-04-16**.

It focuses on the browser app shell, chat workspace, transcript rendering, sidebars, custom popovers/dropdowns, dialogs, settings, diff views, auth flows, and cron/project/thread controls.

### What this audit is

- A **deep static review** of the code and UI structure.
- A **risk assessment** of likely accessibility issues.
- A **component-by-component map** of the main accessibility hotspots.
- A starting point for turning the work into a prioritized remediation backlog.

### What this audit is not

This was **not** a runtime audit with:

- NVDA / VoiceOver / TalkBack testing
- keyboard-only manual interaction in a browser
- axe-core or Lighthouse scans
- zoom / high-contrast / forced-colors validation
- switch-control or speech-input validation

Because of that, some findings below are framed as **high-confidence code risks** rather than claims that a specific behavior was observed live.

---

## Executive summary

The app already has some strong accessibility foundations:

- it generally prefers **native `button`, `input`, `textarea`, `select`, and `label` elements** over `div`-click patterns,
- several important toggles already use **`aria-expanded`**, **`aria-controls`**, or **`aria-label`**,
- `ContextUsageMeter` exposes a real **`<meter>`**,
- thread rows compute unusually rich **screen-reader labels**,
- some feedback surfaces use **`role="status"`**,
- the auth shell is comparatively structured and readable.

That said, the app currently has a **meaningful accessibility gap** between “basic semantic care” and “robust assistive-technology support.” The biggest issues are architectural rather than cosmetic:

1. **Dialog, popover, and menu behavior is not yet accessibility-grade.**
   The app has many custom floating surfaces, but focus containment, naming, escape behavior, focus return, and true modal behavior are inconsistent.

2. **The chat/transcript experience is not exposed as an accessible live conversation surface.**
   There is no `aria-live`, no `role="log"`, and heavy virtualization means assistive tech may not see the full transcript or ongoing updates reliably.

3. **Several custom selectors use menu/dialog semantics without the expected keyboard model.**
   The model selector and related popovers look usable visually, but they do not yet behave like fully accessible menus/listboxes/dialogs.

4. **The UI leans heavily on micro text, dense layouts, tiny action targets, and hidden scrollbars.**
   That is survivable for many power users, but it materially increases friction for low-vision users, users with tremor or fine-motor difficulty, and users who rely on zoom.

5. **A few specific AT bugs are already visible in code.**
   The most concrete example is the `ThreadAccessControl` tooltip pattern: the trigger uses `aria-describedby`, but the referenced tooltip is rendered with `aria-hidden="true"`, which defeats the description for assistive tech.

### Overall assessment

My current assessment is:

- **Base semantic discipline:** fair to good
- **Keyboard accessibility:** fair in simple cases, weak in custom floating UI
- **Screen reader support:** weak to fair overall
- **Dialog / focus management:** weak
- **Low-vision / zoom / dense UI support:** fair at best
- **Accessibility process maturity:** low

If the goal is to make the app “plenty more accessible,” the highest-leverage work is **not** a long tail of one-off aria patches. The biggest return will come from building a small set of **reliable accessibility primitives**:

- a real modal/dialog primitive,
- a real menu/listbox/select primitive,
- a real live-region/log strategy for chat and status updates,
- a consistent labeling/focus policy,
- and a compact but stricter typography/target-size baseline.

---

## Quick evidence snapshot

From a quick codewide pass over `src/mainview/`:

- **113** mainview source files (`.ts`, `.tsx`, `.css`) inspected at a high level
- **0** `aria-live` occurrences
- **0** `role="log"` occurrences
- **0** `role="tab"` occurrences
- **0** `aria-current` occurrences
- **18** uses of `text-[9px]`
- **97** uses of `text-[10px]`
- **7** uses of `h-5 w-5` target sizing (20x20 px controls)
- **7** uses of `hide-scrollbar`
- **3** `<dialog>` usages
- **2** `panelRole="dialog"` usages
- **2** explicit `role="dialog"` usages

Those counts do not prove a problem by themselves, but together they strongly suggest:

- little to no assistive announcement infrastructure,
- very sparse tab/selection semantics,
- an unusually dense micro-type system,
- and a lot of custom, floating UI that will need focused accessibility hardening.

---

## What is already working well

This app is not starting from zero. Several patterns are already good and worth preserving.

### 1. Native controls are used much more often than fake controls

Examples:

- thread rows in `app/thread-list-row.tsx`
- project/worktree rows in `app/projects-panel.tsx`
- git history rows in `app/git-history-panel.tsx`
- many action buttons throughout `App.tsx`, `settings-panel.tsx`, `action-menus.tsx`, and `cronjob-workspace.tsx`

That matters because native controls bring:

- keyboard focusability,
- default interaction behavior,
- better browser/AT compatibility,
- and lower ongoing accessibility maintenance cost.

### 2. Some high-value labels are already present

Good examples:

- settings trigger uses `aria-controls`, `aria-expanded`, and `aria-label` in `app/settings-panel.tsx`
- mobile drawer trigger uses `aria-controls` and `aria-expanded` in `App.tsx`
- many icon-only controls have explicit `aria-label`
- thread rows in `app/thread-list-row.tsx` compute rich labels that include title, pin state, error/working state, timestamp, branch, and worktree

That thread-row labeling work is especially strong and should be treated as a model for other dense rows.

### 3. Decorative icons are mostly hidden from assistive tech

`controls/icons.tsx` sets `aria-hidden="true"` on decorative SVG icons, which is the right default for the icon system.

### 4. There is at least some structured status feedback

Examples:

- copy-confirmation popovers use `role="status"` in `app/message-ui.tsx` and `app/chat-workspace.tsx`
- `ContextUsageMeter` exposes a real `<meter>` in `controls/ContextUsageMeter.tsx`

These are small but important signs that the codebase is already thinking about AT in some places.

### 5. Auth shell structure is comparatively strong

`auth-shell.tsx` is one of the better accessibility surfaces in the repo:

- clear headings,
- explicit labels,
- a real `main` landmark,
- readable spacing,
- QR image alt text,
- and broadly straightforward form structure.

It is not perfect, but it is a better baseline than many of the app’s popover-heavy tool surfaces.

---

## Detailed findings

## 1. Chat and transcript accessibility is the biggest structural gap

### Where

- `app/chat-workspace.tsx`
- `app/message-ui.tsx`

### Why this matters

The app’s primary interaction model is a live chat / transcript surface. If that surface is not accessible, the rest of the app is hard to use regardless of how good the surrounding controls are.

### Findings

#### 1.1 No transcript live-region semantics

I found:

- no `aria-live`,
- no `role="log"`,
- no explicit “new message” announcement strategy.

That means screen-reader users are unlikely to get reliable announcement behavior for:

- new assistant responses,
- tool activity changes,
- status transitions,
- or completion/error notifications.

#### 1.2 The transcript is virtualized

`chat-workspace.tsx` renders transcript rows through `@tanstack/react-virtual` and only mounts the currently visible rows.

That is excellent for performance, but it creates a high accessibility risk:

- screen readers may only “see” a subset of the conversation,
- browse mode and structural navigation may be incomplete,
- find-in-page behavior can become unreliable,
- and the DOM order exists only for visible rows rather than the full logical transcript.

This does not automatically make virtualization inaccessible, but it means the app needs an explicit strategy for AT compatibility. I did not find one.

#### 1.3 Message groups are visual, not semantic

`DesktopMessageGroups` and `MobileMessageGroups` in `app/message-ui.tsx` are built mostly from `div` wrappers. They read visually like a conversation, but they are not exposed as:

- a log,
- a list of messages,
- or a collection of articles/items with speaker metadata.

That weakens screen-reader navigation and makes the transcript feel like a generic page of text rather than a structured conversation.

#### 1.4 Dynamic status items are not centrally announced

Examples include:

- “Processing” messages,
- loading states,
- thread activity notifications,
- diff loading,
- tool-call state changes,
- and app-level toasts in `App.tsx`.

A few copy actions use `role="status"`, but there is no app-wide live region strategy.

### Risk

**High**

This is the app’s core workflow. A robust transcript accessibility model is foundational.

### Recommended direction

- Introduce a dedicated transcript container with **`role="log"`** or another deliberate pattern.
- Add a **polite live region** for new assistant/tool status updates.
- Consider an accessibility-mode fallback that **disables transcript virtualization** when AT compatibility is more important than performance.
- Expose each visible message/group as a semantic unit with speaker and status context.

---

## 2. Dialog and modal accessibility is inconsistent and often incomplete

### Where

- `app/settings-panel.tsx`
- `controls/thread-access-control.tsx`
- `app/action-menus.tsx`
- `app/auth-step-up-dialog.tsx`
- `app/thread-extension-ui-dialog.tsx`
- `app/message-ui.tsx` (`GitHistoryDiffModal`)
- `App.tsx` (`currentThreadStartRequest` overlay)

### Why this matters

Dialogs are where focus bugs, screen-reader ambiguity, and keyboard traps usually show up. This app uses many custom floating surfaces, so dialog behavior needs to be especially strong.

### Findings

#### 2.1 Several dialog-like surfaces are unnamed or only partially named

Examples:

- `SettingsPanel` uses `panelRole="dialog"` but does not provide `aria-labelledby` or `aria-describedby`.
- `ThreadAccessControl` also uses `panelRole="dialog"` without explicit dialog naming.
- `ProjectActionMenu` and `ThreadActionMenu` open popover surfaces that do not expose dialog/menu semantics at all.
- `AuthStepUpDialog` and `ThreadExtensionUiDialog` render `<dialog open>` with `aria-modal="true"`, but they do not wire explicit labels/descriptions to the dialog element.

`GitHistoryDiffModal` is better here: it uses `aria-labelledby` and `aria-describedby`.

#### 2.2 I did not find a shared focus-trap / modal primitive

The code shows layered overlays and `aria-modal` in some places, but I did not find a shared abstraction that guarantees:

- initial focus,
- trapped focus while the modal is open,
- inert background content,
- Escape-to-close behavior,
- and focus return to the opener.

Some dialogs use `autoFocus` on a button or field, but that is not the same as full modal management.

#### 2.3 `App.tsx` has at least one overlay that is visually modal but not semantically modal

The **New Thread Request** overlay in `App.tsx` is a strong example. It is rendered as a fixed overlay and visually behaves like a dialog, but it does not expose an explicit dialog role or name, and there is no visible focus-management code around it.

That is a high-confidence accessibility bug for keyboard and screen-reader users.

#### 2.4 Settings and action popovers sit in a gray zone between popover and dialog

Several floating surfaces are complex enough to act like dialogs:

- settings panel,
- thread access control,
- project actions,
- thread actions,
- desktop thread switcher.

But they do not all consistently behave like accessible dialogs or accessible menus.

### Risk

**High**

This will affect keyboard users immediately and screen-reader users substantially.

### Recommended direction

Create one shared **floating-surface accessibility primitive** with modes like:

- `modal-dialog`
- `nonmodal-dialog`
- `menu`
- `tooltip`

And make that primitive own:

- focus entry,
- focus trap when appropriate,
- focus return,
- Escape handling,
- outside-click behavior,
- labelledby/describedby wiring,
- and background inerting for real modals.

---

## 3. Custom menus and selectors are visually polished but not yet keyboard-complete

### Where

- `controls/dropdown.tsx`
- `controls/codex-model-selector.tsx`
- `controls/reasoning-effort-selector.tsx`
- `app/desktop-thread-switcher.tsx`

### Findings

#### 3.1 “Menu” semantics are declared without the expected menu keyboard model

`DropdownControl` is used with `panelRole="menu"` in selectors, and triggers use `aria-haspopup="menu"`.

However, I did not find support for the normal menu/listbox keyboard expectations such as:

- arrow-key movement between items,
- roving tab index or active descendant management,
- Home/End navigation,
- consistent Enter/Space behavior for selection,
- and selection state semantics.

Visually, the selectors work. Semantically and behaviorally, they are closer to “a custom popover full of buttons.”

That mismatch matters because users and assistive tech interpret `menu` differently than “dialog with buttons.”

#### 3.2 The Codex selector has a hover-driven submenu

`controls/codex-model-selector.tsx` opens a reasoning submenu on hover/focus.

That pattern is fragile for:

- keyboard users,
- switch users,
- high zoom,
- and assistive tech that expects linear, explicit focus movement.

#### 3.3 Escape behavior is likely broken while typing in selector search fields

The selector search inputs call `event.stopPropagation()` on `onKeyDown`.

Since `DropdownControl` listens for Escape on `document`, this likely prevents Escape from closing the selector while focus is in the search input.

That is a concrete keyboard bug risk, not just a theoretical preference.

#### 3.4 Desktop thread switcher is better, but still custom

`app/desktop-thread-switcher.tsx` is one of the stronger floating surfaces:

- it has `role="dialog"`,
- it has `aria-labelledby`,
- it focuses the search field on open.

But it still depends on custom blur/hover logic rather than a more canonical focus-managed pattern.

### Risk

**High** for the selectors, **medium** for the thread switcher.

### Recommended direction

For each floating chooser, decide what it really is:

- **menu**,
- **listbox/select**,
- or **nonmodal dialog**.

Then implement the full keyboard and ARIA contract for that pattern instead of mixing menu naming with generic button lists.

---

## 4. Some controls still rely on placeholders or context instead of explicit accessible labels

### Where

- `controls/chat-composer-control.tsx`
- `app/settings-panel.tsx`
- some icon-only row actions in `app/projects-panel.tsx`

### Findings

#### 4.1 Chat composer textarea has no explicit label

The chat composer textareas rely on placeholder text like:

- “Ask Metidos…”
- “Create a thread to start chatting…”

There is no visible label or `aria-label` on the textarea.

That is a common accessibility gap because placeholders:

- disappear once users type,
- are not as strong as labels for screen readers,
- and are low contrast in this code path (`placeholder:text-text-faint/50`).

#### 4.2 Create-user fields in settings are not explicitly labeled

In `app/settings-panel.tsx`, the “Create user” fields for username and PIN are rendered as plain inputs with placeholders, but not as explicitly associated labeled fields.

That is weaker than the rest of the form work in the app.

#### 4.3 Some icon actions are named too generically

Examples like the subproject pin control use labels such as:

- “Pin subproject”
- “Unpin subproject”

without including the specific project/worktree name.

That is not catastrophic, but it becomes ambiguous when keyboard users tab through a long list of similar icon buttons.

### Risk

**Medium**

### Recommended direction

- Give the chat composer a persistent label.
- Give settings “Create user” inputs real labels.
- Include target names in icon-only action labels where practical.

---

## 5. Tooltip accessibility is inconsistent, and one tooltip pattern is clearly broken

### Where

- `controls/thread-access-control.tsx`
- `app/cronjob-workspace.tsx`
- `controls/codex-model-selector.tsx`

### Findings

#### 5.1 `ThreadAccessControl` description tooltips are hidden from AT

In `controls/thread-access-control.tsx`:

- the `?` help button uses `aria-describedby={tooltipId}`
- but the referenced tooltip surface is rendered with `aria-hidden="true"`

That means the descriptive text is effectively removed from the accessibility tree, defeating the point of `aria-describedby`.

This is the most concrete, high-confidence accessibility defect I found in the code.

#### 5.2 Cron schedule tooltip is visual only

In `app/cronjob-workspace.tsx`, the cron schedule badge opens a tooltip with a human-readable explanation, but the tooltip is also `aria-hidden="true"`.

So a screen reader may only get the raw cron expression, not the readable schedule description.

#### 5.3 Tooltip patterns are not unified

Some tooltips are:

- purely visual,
- some are intended as descriptions,
- some are tied to focus,
- and some are only meaningful for pointer users.

This should be standardized.

### Risk

**Medium to high** depending on the tooltip’s importance.

### Recommended direction

- Fix the broken `aria-describedby` + `aria-hidden` pattern first.
- Reserve tooltips for optional help.
- If text is essential, prefer inline help or an explicitly described dialog/field hint.

---

## 6. View-switching controls are not exposed as tabs or current-state navigation

### Where

- `App.tsx` desktop header view switcher
- `App.tsx` mobile bottom navigation

### Findings

The app has several sets of mutually exclusive view buttons:

- Chat
- Diff
- Cronjobs

Visually, they behave like tabs or a segmented control. Semantically, they are just buttons with styling.

I found:

- no `role="tablist"`
- no `role="tab"`
- no `aria-selected`
- no `aria-current`
- no `aria-controls` linking the selected button to the active panel

That means assistive tech users do not get a clear announcement of:

- which view is active,
- what the control set represents,
- or which region is being controlled.

### Risk

**Medium**

### Recommended direction

Either:

- implement a true tab pattern, or
- treat them as navigation and use `aria-current="page"` / `aria-current="true"` style semantics appropriately.

---

## 7. Semantic structure is thinner than the visual UI suggests

### Where

Across `src/mainview/**/*.tsx`

### Findings

The app looks highly structured visually, but much of that structure is built from styled `div`s rather than semantic headings and named regions.

A quick count across `src/mainview/**/*.tsx` found only:

- 4 `h1`s
- 1 `h2`
- 1 `h3`

for the entire mainview layer.

That is sparse for an app with:

- a large sidebar,
- multiple workspaces,
- dialogs,
- settings sections,
- transcript groups,
- diff panels,
- and grouped lists.

### Specific examples

- `SidebarSectionHeader` uses button text, but not heading elements.
- panel sections like Threads / Projects / Git History are visually important but not mapped to heading navigation.
- `DiffWorkspace` builds a visually obvious two-pane interface without exposing a strong semantic relationship between file navigator and selected diff content.

### Risk

**Medium**

### Recommended direction

Introduce a lightweight heading/region policy:

- important panel titles should usually be real headings,
- collapsible sections should point to named regions,
- major workspace panes should have accessible names.

---

## 8. Low-vision and motor accessibility are meaningfully affected by dense typography and tiny targets

### Where

Across the mainview UI, especially:

- `app/thread-list-row.tsx`
- `app/workspace-panel.tsx`
- `app/pinned-threads-panel.tsx`
- `app/diff-workspace.tsx`
- `controls/codex-model-selector.tsx`
- `controls/reasoning-effort-selector.tsx`
- `controls/sidebar-search-control.tsx`
- `app/projects-panel.tsx`

### Findings

#### 8.1 Micro text is used heavily

Counts found in `src/mainview/`:

- **18** uses of `text-[9px]`
- **97** uses of `text-[10px]`

A dense tool UI can absolutely use compact text, but the current amount of 9–10 px text is high enough to be a real accessibility concern, especially on:

- non-retina displays,
- browser zoom,
- laptop viewing distance,
- and mobile devices.

#### 8.2 Some target sizes are too small

There are multiple `h-5 w-5` controls (20x20 px), including clear buttons and row action buttons.

That is below common comfortable target-size guidance and will be difficult for:

- touch users,
- users with tremor,
- users with limited precision,
- and users at high zoom.

#### 8.3 Some low-contrast micro text likely fails or skirts WCAG AA

Representative contrast checks:

- `#6f7b83` on `#12181c` in `app/diff-workspace.tsx` is about **4.12:1**
- `--color-text-faint` (`#74818a`) on `--color-surface-1` (`#15191c`) is about **4.42:1**

Those are not terrible in isolation, but for **9–11 px text** they are at or below the normal-text AA threshold.

The app also uses many faint separators, helper labels, and tiny status chips where readability is already stressed by size.

#### 8.4 Placeholder-only patterns worsen low-vision usability

The chat composer placeholder is both:

- acting like the field label,
- and rendered with low-opacity faint text.

That is a bad combination for users who need persistent, high-confidence field cues.

### Risk

**Medium to high** depending on task frequency.

### Recommended direction

- Reduce 9 px usage aggressively.
- Treat 10 px as a rare label size, not a default metadata size.
- Raise minimum icon-only target sizes.
- Recheck all small-text contrast after token cleanup.

---

## 9. Hidden scrollbars and nested scroll containers reduce discoverability and orientation

### Where

- `src/mainview/input.css`
- `app/chat-workspace.tsx`
- `app/git-history-panel.tsx`
- `controls/codex-model-selector.tsx`

### Findings

The app globally sets `body { overflow: hidden; }` and relies heavily on nested internal scroll regions.

It also uses `hide-scrollbar` in several places.

This is not automatically inaccessible, but it raises usability costs because users may not realize that:

- the transcript scrolls,
- the git history list scrolls,
- the model selector scrolls,
- or a particular inner panel, not the page, is the active scroll region.

For keyboard users and screen magnifier users, nested scroll regions are already hard. Hidden scrollbars make them harder.

### Risk

**Medium**

### Recommended direction

- Keep scrollbars visible on key task surfaces.
- Avoid hiding scrollbars on anything critical.
- Make major scroll regions explicitly named where appropriate.

---

## 10. Section toggles are usable but not fully described

### Where

- `controls/sidebar-section-header.tsx`
- `app/workspace-panel.tsx`
- `app/projects-panel.tsx`
- `app/git-history-panel.tsx`

### Findings

The app already uses `aria-expanded` in several collapse/expand controls, which is good.

But most of these toggles do **not** also provide:

- `aria-controls`
- a named controlled region
- or heading/region relationships that help screen-reader users understand what opened and what changed

This is not a severe bug, but it is a missed semantic improvement that would make the sidebar much easier to navigate.

### Risk

**Low to medium**

---

## 11. Some visual status indicators are not fully represented in accessible names

### Where

- `App.tsx` mobile navigation indicator
- some badge/dot patterns across thread and worktree surfaces

### Findings

A good example is the mobile navigation trigger in `App.tsx`:

- visually, it can show a status dot,
- but the accessible name only reflects open/close navigation state.

So a screen-reader user will not receive the same ambient status cue that a sighted user gets from the dot.

This is not as severe as transcript or dialog issues, but it is a recurring pattern worth watching: if status is visually encoded, it should either be announced or duplicated in text.

### Risk

**Low to medium**

---

## 12. Accessibility testing and enforcement do not appear to be built into the workflow yet

### Findings

From the current repo setup, I did **not** find obvious evidence of:

- `axe-core` integration,
- `eslint-plugin-jsx-a11y`,
- accessibility-specific test helpers,
- or dedicated a11y regression checks in UI tests.

That does not mean the team is ignoring accessibility; it just means the process is not yet instrumented to catch regressions automatically.

### Risk

**High as a process issue**

Without automation, custom floating UI and dense visual components will regress easily.

### Recommended direction

Add:

- lint rules for JSX a11y,
- a small axe smoke-test suite for major screens,
- and a manual keyboard / screen-reader checklist for high-risk surfaces.

---

## Component hotspot map

| File | Risk | Notes |
| --- | --- | --- |
| `src/mainview/app/chat-workspace.tsx` | High | Virtualized transcript; no log/live semantics; composer label gap |
| `src/mainview/app/message-ui.tsx` | High | Transcript grouping is visual; diff virtualization; many dynamic states not announced |
| `src/mainview/controls/dropdown.tsx` | High | Floating surface primitive lacks full keyboard/menu semantics |
| `src/mainview/controls/codex-model-selector.tsx` | High | Custom menu/search/submenu behavior; likely Escape bug while typing |
| `src/mainview/controls/thread-access-control.tsx` | High | Broken tooltip description pattern; dialog-like popover not fully named |
| `src/mainview/app/settings-panel.tsx` | High | Complex dialog-like panel without full naming/focus management; some unlabeled inputs |
| `src/mainview/app/action-menus.tsx` | High | Popover action menus lack strong semantics; delete modal only partially hardened |
| `src/mainview/App.tsx` | High | View switcher semantics; toast/live feedback; new-thread-request overlay lacks modal semantics |
| `src/mainview/app/desktop-thread-switcher.tsx` | Medium | Better than most popovers, but still custom and keyboard-fragile |
| `src/mainview/app/diff-workspace.tsx` | Medium | File navigator lacks stronger list/tree semantics; small low-contrast metadata |
| `src/mainview/app/git-history-panel.tsx` | Medium | Dense virtualized list with hidden scrollbar and minimal semantics |
| `src/mainview/app/cronjob-workspace.tsx` | Medium | Generally decent semantics, but schedule tooltip is visual-only |
| `src/mainview/app/auth-step-up-dialog.tsx` | Medium | Dialog naming/focus behavior incomplete |
| `src/mainview/app/thread-extension-ui-dialog.tsx` | Medium | Same dialog concerns as step-up flow |
| `src/mainview/auth-shell.tsx` | Low to medium | Best current baseline, but still missing live feedback roles in some places |

---

## Prioritized remediation themes

This is not the final backlog, but these are the themes I would prioritize first.

### Priority 1: Build reliable accessibility primitives

1. **Modal/dialog primitive**
   - trap focus
   - initial focus
   - focus return
   - Escape
   - labelledby/describedby
   - inert background

2. **Menu/select/listbox primitive**
   - correct ARIA role per pattern
   - arrow-key behavior
   - Escape and Enter behavior
   - active-item semantics
   - search handling that does not swallow dismissal

3. **Live region / transcript primitive**
   - transcript `role="log"` or equivalent strategy
   - polite status announcements
   - explicit handling for new assistant output and execution-state transitions

### Priority 2: Fix current correctness bugs

1. Remove `aria-hidden="true"` from tooltips that are referenced via `aria-describedby`
2. Add a real modal pattern for the **New Thread Request** overlay
3. Give the chat composer a real label
4. Give settings “Create user” fields real labels
5. Expose active primary view semantics in `App.tsx`

### Priority 3: Improve low-vision and motor ergonomics

1. Reduce `text-[9px]` and `text-[10px]` usage
2. raise minimum action target sizes
3. re-evaluate faint text tokens on dark surfaces
4. stop hiding scrollbars on key task surfaces

### Priority 4: Add process safeguards

1. add JSX a11y linting
2. add axe smoke tests for:
   - auth shell
   - chat workspace
   - settings panel
   - thread/project action surfaces
3. maintain a manual accessibility checklist for releases

---

## Suggested validation plan after code changes

Once remediation starts, I would validate in this order:

### 1. Keyboard-only pass

Check:

- app load
- auth flow
- open/close settings
- model selector
- thread access control
- thread/project action menus
- transcript navigation
- diff workspace
- mobile nav drawer

### 2. Screen-reader pass

At minimum:

- VoiceOver + Safari or Chrome on macOS
- NVDA + Chrome or Firefox on Windows

Focus on:

- initial load
- transcript updates
- modal naming and focus
- row labels
- view switching
- status announcements

### 3. Zoom / low-vision pass

Check at:

- 200% browser zoom
- 400% browser zoom where practical
- reduced viewport widths
- touchpad-only and keyboard-only navigation through nested scrollers

### 4. Automated pass

Run axe against:

- auth shell
- main app shell
- settings panel open
- desktop thread switcher open
- thread access control open
- git history diff modal open

---

## Bottom line

The app already shows good instincts:

- it uses native controls often,
- it has some thoughtful aria usage,
- and it is not structurally hostile by default.

But it is still **far from robust accessibility**, mostly because the app now depends on a lot of **custom, dense, floating, stateful UI** and that layer has outgrown the current semantics/focus infrastructure.

If I had to summarize the current state in one sentence:

> The app is visually disciplined and partially keyboard-friendly, but it needs a dedicated accessibility architecture for dialogs, menus, transcript updates, and dense power-user controls.

The most effective next step is to treat accessibility as a **system design task**, not a pile of aria patches.

Once the floating-surface primitives, transcript semantics, and label/focus rules are fixed, the rest of the backlog will get dramatically smaller and easier to maintain.
