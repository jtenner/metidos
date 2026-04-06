# Front-end Tree Sweep: Responsive Layout Primitives Split

Date: 2026-04-06

This sweep split the responsive layout primitives out of the broader information-hierarchy note so the docs tree can keep semantic structure separate from implementation mechanics.

## What Changed

- Trimmed `information-hierarchy-and-visual-structure.md` so it focuses on hierarchy, grouping, landmarks, and visual rhythm.
- Added a dedicated research note for `clamp()`, `text-wrap: balance`, container queries, and `subgrid`.
- Kept the responsive-layout note source-backed with primary documentation links instead of repeating the broader hierarchy guidance.

## What Stayed Consolidated

- The hierarchy note still owns headings, grouping, and page-region structure.
- The new layout-primitives note is still narrow enough to stay in `research/` instead of becoming a pattern or principle.
- No duplicate note was needed for the container-query or typography primitives.

## Follow-Up

- Move stable type-scale or container-query guidance into a principle only after the implementation conventions settle.
- Check whether any component-level layout notes should cross-link to the new responsive-layout research note.
