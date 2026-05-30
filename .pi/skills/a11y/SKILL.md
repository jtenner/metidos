---
name: a11y
description: Use for accessibility implementation, audits, remediation, validation, WCAG-oriented reviews, keyboard and screen-reader support, inclusive UI decisions, or when the user mentions a11y.
---

# Thorough Accessibility Skill

Use this skill whenever accessibility is part of the task. Treat accessibility as usability for disabled people first, and compliance second.

## Start with the user's journey

- Identify the user flow, UI states, and assistive technologies involved.
- Include keyboard-only, screen reader, zoom/reflow, contrast, reduced motion, mobile/touch, and error-state scenarios when relevant.
- Prefer native HTML semantics and platform behavior before ARIA or custom interaction code.
- When making UI changes in `src/mainview/`, also follow `STYLE.md`.

## Implementation checklist

### Structure and semantics

- Use headings, landmarks, lists, tables, buttons, links, labels, and form controls according to their native meaning.
- Do not use clickable `div`/`span` elements when a `button` or `a` is correct.
- Add ARIA only when native semantics are not enough; keep roles, states, and properties synchronized with visible state.
- Ensure icon-only controls have accessible names.

### Keyboard and focus

- Every interactive control must be reachable and operable by keyboard.
- Preserve logical focus order; avoid positive `tabIndex`.
- Provide visible focus indicators that meet contrast expectations.
- Manage focus for dialogs, popovers, route changes, async updates, and destructive confirmations.
- Never trap focus unless the interaction is modal, and always provide an escape path.

### Screen reader support

- Give controls clear programmatic names, roles, values, and states.
- Announce important async status, errors, and completion messages using appropriate live regions.
- Keep reading order aligned with visual order.
- Hide decorative content from assistive tech; do not hide meaningful or focusable content.

### Visual accessibility

- Check text and non-text contrast, including focus rings and disabled/selected states.
- Do not rely on color alone; pair color with text, icon shape, position, or state.
- Support zoom, text spacing, responsive layouts, and reduced motion.
- Avoid flashing, strobing, or high-intensity motion.

### Forms and errors

- Associate every input with a visible label or clear accessible name.
- Provide instructions before they are needed.
- Connect errors to fields with `aria-describedby` or equivalent relationships.
- Make errors specific, actionable, persistent until fixed, and available without color alone.

### Cognitive and inclusive design

- Use plain language and consistent terminology.
- Reduce memory load with visible context, examples, summaries, and reversible actions.
- Avoid unnecessary time pressure, surprise motion, or dense unchunked content.

## Validation workflow

1. Run the project a11y script when code changes affect `src/mainview`:
   - `bun run a11y:check`
   - `bun run a11y:check:strict` for warning-gated reviews.
2. Manually test the changed flow with:
   - keyboard only
   - screen reader behavior or semantic inspection
   - zoom/reflow
   - contrast/focus visibility
   - reduced motion where motion is involved
3. Report what was tested, what passed, what remains unverified, and the user impact of any remaining issue.

## Related installed specialist skills

Use these focused skills as needed:

- `accessibility-testing-validation` for audit and validation plans.
- `screen-reader-compatibility` for names, announcements, landmarks, and reading order.
- `semantic-html-implementation`, `interactive-element-semantics`, and `dynamic-content-accessibility` for implementation details.
- `color-contrast-visual`, `visual-accessibility-design`, and `photosensitivity-seizure-safety` for visual and motion safety.
- `inclusive-forms-input`, `error-prevention-recovery`, and `plain-language-design` for forms and flows.
- `mobile-assistive-technology`, `target-size-spacing`, and `gesture-touch-interactions` for mobile/touch work.
