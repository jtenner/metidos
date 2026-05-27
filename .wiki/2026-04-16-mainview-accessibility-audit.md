# 2026-04-16 Mainview Accessibility Audit

## Summary

On **2026-04-16**, an accessibility-focused static review of `src/mainview/` identified that Metidos has a solid base of native controls and some thoughtful ARIA usage, but is still below robust accessibility for custom floating UI and live chat workflow. The source audit was high-confidence about structural risks in transcripts, dialogs/menus, and target density, with several concrete correctness defects suitable for near-term correction.

- **Observed:** the app uses native controls in many core surfaces, but many power-user surfaces are still custom popovers, dialogs, and selectors with incomplete ARIA/keyboard contracts.
- **Observed:** no live-region transcript semantics (`aria-live`/`role="log"`) were found in the inspected `src/mainview/` pass.
- **Inferred:** without a dedicated accessibility primitive layer, future UI complexity will likely continue to grow the a11y debt with each optimization or model-control feature.
- **Recommended:** prioritize durable primitives over one-off fixes: modal/dialog, menu/listbox, and transcript-live semantics.

## Scope and review method

The source review is a **static code audit snapshot** dated 2026-04-16. It focused on `src/mainview/` files for:

- chat transcript and composer flow,
- dialogs, menus, popovers, action sheets, and overlays,
- settings and controls,
- status and tab-like navigational surfaces,
- and low-vision/motor usability signals.

It was **not** a runtime accessibility QA pass (no screen-reader runs, no axe/lighthouse runs, no keyboard-only manual session).

## Problem statement

The app already has some foundational accessibility behavior, but key interaction patterns are implemented as custom floating/visual components without the expected AT contracts. That creates a high gap between visual UX and reliable accessibility behavior for the two highest-value flows:

1. chat/transcript interaction, and
2. modal/menu/select surfaces that users reach frequently.

## Current state

### What is already working

- **Native element usage:** many interactive surfaces already use native `button`, `input`, `textarea`, and `select`-style controls instead of fully synthetic widgets.
- **Selective ARIA uptake:** several high-value controls already include `aria-label`, `aria-expanded`, and `aria-controls`.
- **Some semantic labels:** thread rows already compute rich labels (title/pin/error/working/time/branch/worktree), indicating an existing accessibility-first instinct that can be extended.
- **Structured status intent:** limited role usage (`status`) and a native meter in `ContextUsageMeter` exist in parts of the chat and message paths.
- **Auth shell quality:** `auth-shell.tsx` has comparatively good structure and readability.

### Structural gaps still present

- no dedicated transcript-live model,
- inconsistent dialog/menu semantics,
- inconsistent floating-surface focus policy,
- dense controls and very dense typography,
- weak explicit test/process enforcement.

## Findings by area

### 1) Transcript is not an accessibility-first surface (High)

**Observed:** In `app/chat-workspace.tsx` and `app/message-ui.tsx`, transcript rendering is highly optimized and virtualized (`@tanstack/react-virtual`) with no obvious `role="log"`, no `aria-live` region, and no semantic message list/group model for AT.

**Observed risk:** without a deliberate strategy, screen-reader users can miss message boundaries, updates, and completion state changes.

**Recommended durable change:** establish a dedicated transcript pattern with:

- a semantic conversation container (`role="log"` or a documented equivalent),
- a polite status region for completion/tool transitions,
- explicit message-group metadata (speaker/intent/state),
- and an AT-compatible fallback path if strict virtualization conflicts with announced completeness.

### 2) Dialog/popover surfaces are inconsistent (High)

**Observed:** components like `settings-panel.tsx`, `thread-access-control`, `action-menus.tsx`, `auth-step-up-dialog.tsx`, `thread-extension-ui-dialog.tsx`, and a large-thread-request overlay in `App.tsx` do not consistently guarantee modal labeling, focus return, Escape behavior, and background isolation.

**Observed concrete issue:** several custom dialog-like surfaces use non-standard labeling or miss `aria-labelledby`/`aria-describedby`; in at least one high-surface case (`App.tsx` new-thread overlay), the overlay is visually modal without semantic dialog contract.

**Recommended durable change:** introduce one shared floating-surface primitive with explicit modes:

- `modal-dialog`,
- `nonmodal-dialog`,
- `menu`,
- `tooltip`.

Ownership should include focus entry/return, trap where needed, Escape handling, and background inerting for true modals.

### 3) Custom menus/selectors are partially implemented but keyboard-incomplete (High)

**Observed:** `DropdownControl`, `codex-model-selector`, `reasoning-effort-selector`, and thread-switcher interactions are visually complete but mix menu/listbox semantics with bespoke button-list behavior.

**Observed concrete bug risk:** selector search inputs call `stopPropagation` on keydown, which can interfere with global Escape handlers while typing in search fields.

**Recommended durable change:** for each chooser, pick one contract and fully implement it:

- real menu semantics with arrow-key + home/end support,
- listbox/select semantics where applicable,
- or controlled nonmodal dialog semantics.

### 4) Label and naming quality still uneven (Medium)

**Observed:** chat composer and some settings inputs rely on placeholder-as-label behavior; several icon-only actions are context-ambiguous.

**Recommended:** add explicit control labels/`aria-label` with concrete resource context where possible (for example, include thread/worktree names in repetitive action controls).

### 5) Tooltip and description wiring is inconsistent; one definite correctness defect (Medium→High)

**Observed (high-confidence defect):** `controls/thread-access-control.tsx` has an `aria-describedby` reference pointing to tooltip content rendered with `aria-hidden="true"`, which prevents that content from being announced.

**Observed:** similar “visual-only” tooltip usage appears in cron/help surfaces, reducing information parity between visual and AT paths.

**Recommended:** fix ARIA/description mismatches first; if description text is critical, do not hide it from the accessibility tree.

### 6) Tabs/segmented view controls are underspecified (Medium)

**Observed:** mainview switches in `App.tsx` (desktop and mobile patterns) do not expose `tablist/tab` semantics or equivalent navigation semantics such as `aria-current`.

**Recommended:** implement either a true tab pattern or explicit navigation-current labeling depending on product intent.

### 7) Semantic structure and low-vision ergonomics can be strengthened (Medium)

**Observed:** heading/region scaffolding is sparse for a full-pane app with many logically distinct sections. Additionally, typography size and target-size counts are high-density:

- `text-[9px]` (18) and `text-[10px]` (97) occurrences in mainview,
- several `h-5 w-5` controls,
- hidden-scrollbar patterns in key regions.

**Recommended:** adopt a lightweight naming policy for major panels, and incrementally reduce dense text/interaction targets in areas that remain core to main usage.

### 8) Process hardening still missing (High)

**Observed:** no evidence of dedicated a11y automation was found in this pass (for example axe smoke checks or jsx-a11y enforcement).

**Recommended:** add regression tooling around major screens before the next major mainview accessibility phase.

## Prioritized remediation themes (durable order)

### Priority 1: Build reliable primitives

- modal/dialog primitive with focus and return semantics,
- menu/listbox primitive with keyboard contract,
- transcript live-region/log model.

### Priority 2: Fix current high-confidence defects

- remove `aria-hidden` from `aria-describedby`-referenced tooltip content,
- make new-thread overlay in `App.tsx` truly modal or semantically non-modal,
- add composer label and explicit settings creation labels,
- wire active-view semantics for the main nav controls.

### Priority 3: Accessibility and ergonomics debt reduction

- reduce 9–10px usage in high-frequency controls,
- increase icon-only target minimums,
- unhide critical scroll regions,
- re-check contrast at the intended density.

### Priority 4: Add guardrails

- add jsx-a11y linting and a baseline of a11y regression smoke tests (auth shell, chat workspace, settings, action surfaces).

## Cross-page context

This audit is adjacent to the mainview simplification and controller tracks already captured in:

- [mainview-thread-status-controller](./mainview-thread-status-controller.md)
- [mainview-project-worktree-git-history-controllers](./mainview-project-worktree-git-history-controllers.md)
- [mainview-derived-state-memo-cleanup](./mainview-derived-state-memo-cleanup.md)
- [mainview-accessibility-standards](./mainview-accessibility-standards.md)

and should be treated as the pre-slice accessibility baseline before major next-phase mainview UX or interaction work.

## Open questions

- Should Metidos adopt native `<dialog>` for all modal use cases or keep layered custom primitives with explicit guarantees?
- Should the transcript surface prioritize reliability of live updates over virtualization performance, or provide a mode switch?
- What minimum contrast and target-size thresholds should be codified as explicit lint/check budgets rather than post-facto review?
