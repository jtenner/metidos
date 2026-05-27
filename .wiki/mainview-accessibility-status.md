# Mainview Accessibility Status

Summary: Current maintained accessibility guidance lives in `mainview-accessibility-standards.md`; the April 2026 audit snapshots remain useful historical inputs. This page records the current documentation status so future accessibility work can distinguish maintained standards, older findings, and likely follow-up checks without rereading raw audit material first.

## Current maintained source of truth

- `STYLE.md` governs visual density, shared primitives, focus treatment, token use, and the no-card rule for `src/mainview/`.
- `.wiki/mainview-accessibility-standards.md` is the durable accessibility standard for controls, dialogs, choosers, transcripts, floating surfaces, and release checks.
- Inclusive-design skill files under `.pi/skills/inclusive-design-skills/` should be loaded for focused accessibility QA, screen-reader, keyboard, contrast, motion, cognitive-load, or mobile-assistive-technology reviews.

## Historical source material

- `.wiki/2026-04-16-mainview-accessibility-audit.md` is a time-bound audit snapshot.
- `.wiki/raw/2026-04-16-accessibility-audit.md` is raw source material and should not be treated as the maintained status page.
- Audit findings that mention placeholder-only labels, icon-only ambiguity, floating-surface semantics, and transcript structure are still useful checklists, but current implementation must be verified against source before filing new remediation work.

## Current review posture

Use these checks before accessibility-sensitive UI work is accepted:

1. Prefer shared controls from `src/mainview/controls/` over one-off button/input/list recipes.
2. Confirm interactive controls have visible labels or accessible names that do not rely on placeholder text alone.
3. Confirm dialogs, popovers, and dropdowns have keyboard dismissal, focus behavior, and stable semantics.
4. Confirm transcript messages, tool calls, errors, screenshots, and markdown content remain readable and navigable at zoom.
5. Confirm status changes are conveyed with text, not color alone.
6. Run `bun run style:check`; for accessibility-heavy UI changes, add focused manual keyboard and screen-reader checks.

## Known documentation gap

The repository does not yet maintain a pass/fail matrix that maps each April 2026 accessibility finding to current source-level remediation status. Create that matrix before claiming the audit is fully closed.

## Related pages

- [mainview-accessibility-standards](./mainview-accessibility-standards.md)
- [2026-04-16-mainview-accessibility-audit](./2026-04-16-mainview-accessibility-audit.md)
