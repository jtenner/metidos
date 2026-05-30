# Mainview Accessibility Standards and QA Workflow

## Summary

This page is the maintained accessibility baseline for `src/mainview/` and `src/mainview/auth-shell.tsx` after the 2026-04-16 accessibility audit.

- **Observed:** the same high-signal risk clusters are concentrated in dialogs/popovers, choosers, transcript semantics, and dense controls.
- **Observed:** this repo currently has no dedicated `test:a11y` script in the root package; accessibility risk review relies on the main test suite plus manual checks. Biome jsx-a11y rules are still enforced through `bun run validate`.
- **Recommended:** treat this document as a durable review contract for every mainview UI change, not a one-time note.

## Scope and intent

Use this standard when:

- reviewing or implementing mainview UI changes,
- modifying dialogs, popovers, choosers, transcript rendering, or dense sidebar controls,
- preparing releases with accessibility-sensitive interaction work.

This standard is for both code review and PR acceptance.

## Current state snapshot (2026-04-19)

### What is currently in place

- `bun run test` is the standard automated test entrypoint; run focused mainview suites (for example `bun test src/mainview/auth-shell-connect.test.ts src/mainview/app/desktop-thread-switcher.test.ts src/mainview/app/diff-workspace.test.ts`) as needed for the touched surfaces, and use full validation for broader UI risk changes.
- `bun run validate` runs Biome checks, typechecking, and the main test suite.
- The repository has already completed a one-time accessibility audit and follow-up planning in these pages:
  - [2026-04-16-mainview-accessibility-audit](./2026-04-16-mainview-accessibility-audit.md)
  - [optimization-execution-proposal](./optimization-execution-proposal.md)

### What remains durable

- No explicit one-off remediation for all listed risks is considered complete yet.
- Mainview accessibility is expected to be protected through explicit standards, not by assuming component-level memory.

## Canonical implementation rules

### 1) Every interactive control has a usable name

**Required:**

- Controls must have visible text when practical.
- Icon-only actions require `aria-label`.
- Inputs/textarea need real labels or a stable accessible name.
- `aria-describedby` must reference non-hidden content that exists in the accessibility tree.
- Never rely on placeholder text alone as the only label.

**Rationale:** observed ambiguity in action buttons and row operations showed label quality is the first failure mode for AT users.

### 2) Floating surfaces match semantic behavior

Use the correct surface mode before adding ARIA glue.

#### Modal dialogs

Use shared modal behavior when background should be inert. Required:

- `role="dialog"`
- `aria-modal="true"`
- explicit `aria-labelledby`
- optional `aria-describedby` when useful
- focus enters the dialog,
- focus is trapped while open,
- `Escape` closes when dismissal is allowed,
- focus returns to invoker on close.

#### Non-modal dialogs / panels

Use non-modal semantics for overlays that preserve background context. Required:

- explicit label,
- predictable focus entry and return,
- outside-click dismissal only if the visual behavior warrants it,
- `Escape` closes unless there is a strong product reason not to.

#### Tooltips

- Tooltips are descriptive supplements only.
- do **not** place required interaction inside a tooltip,
- do not reference tooltip-only, visually hidden content via `aria-describedby`,
- prefer visible inline help for required task-critical details.

### 3) Choosers expose predictable keyboard behavior

Treat custom choosers as command surfaces, not ornamental popovers.

Required:

- `ArrowUp`/`ArrowDown` traversal between options,
- `Home`/`End` jump to first/last when the option list has focus,
- `Enter` and `Space` activate focused options via native button behavior,
- `Escape` closes chooser from all internal fields, including search,
- selected state must be semantically exposed (not color only).

### 4) Transcript and live updates remain visible to screen readers

Conversation content remains a primary task surface and must stay in the accessibility tree.

Required:

- maintain `role="log"` where possible and provide an accessible name,
- add a live-region announcement strategy that does not over-announce user-authored messages,
- keep speaker/state grouping readable for AT,
- avoid removing transcript messages from accessibility without a documented fallback.

### 5) Dense controls must stay readable/operable

- Avoid `text-[9px]` on interactive or frequently scanned UI.
- Use `text-[10px]` only for compact badges or low-priority metadata.
- Prefer `text-[11px]` and up for repeated labels and row metadata.
- Icon-only controls need an intentional hit target.
- keep critical helper/placeholder text readable on dark surfaces.
- do not hide core scrollers on transcript panes, chooser lists, and history lists.

### 6) Regions and sections must expose state explicitly

- collapse/accordion controls with `aria-expanded` should use `aria-controls` when tied to meaningful regions,
- section headings should have stable IDs and wiring via `aria-labelledby`,
- major-view state should be represented through semantic current-state signaling (`aria-current`/tab-like patterns), not color alone.

## QA workflow

### Automated pass

Run before shipping accessibility-sensitive UI work:

1. `bun run test` (or targeted `bun test` for touched mainview surfaces)
2. `bun run validate`

### Manual checklists

Run after meaningful UI changes even when automation passes:

- keyboard-only pass,
- screen-reader spot checks (minimum one macOS + one Windows configuration when feasible),
- zoom/low-vision pass at 200% and 400% where practical,
- critical-surface release checklist.

### Critical surfaces to recheck before release

- auth shell and login/setup flows,
- settings panel,
- desktop thread switcher,
- chat transcript + composer,
- thread access control,
- diff workspace,
- thread-start approval dialog,
- project and thread action menus/dialogs.

## Review questions

Before approving mainview UI changes, reviewers should ask:

1. Does every new control have a usable accessible name?
2. Does the chosen behavior use the correct dialog/tooltip/chooser primitive?
3. Does keyboard operation still work end-to-end?
4. Is state exposed semantically (not just by color/icon)?
5. Are typography and target sizes still operable at zoom and narrow widths?
6. Are core scroll regions discoverable and not hidden?
7. Were accessibility-sensitive mainview suites in `bun run test` and (for code changes) `bun run validate` run?

## Relationship to audit

This page is the maintained follow-on to the earlier audit and a direct acceptance reference for subsequent UI work.

Related pages:

- [2026-04-16-mainview-accessibility-audit](./2026-04-16-mainview-accessibility-audit.md)
- [execution-boundary-hardening](./execution-boundary-hardening.md)

## Source note

Ingested from the 2026-04-16 accessibility audit and maintained in this wiki page on 2026-04-19.
This file is now the canonical maintained wiki artifact for mainview accessibility standards.
