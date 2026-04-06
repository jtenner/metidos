# Front-end Tree Sweep: Validation Timing and `:user-invalid`

Date: 2026-04-06

This sweep split the timing and post-interaction styling guidance out of the broader forms note so the docs tree stays specific and searchable.

## What Changed

- Added a focused research note for validation timing and `:user-invalid` styling.
- Reduced overlap in the broader accessible forms note by cross-linking validation timing to the dedicated note.
- Updated the form validation pattern so submit-time behavior, blur-time exceptions, and `:user-invalid` use are called out in one place.
- Refreshed the goals backlog to remove stale validation questions and replace them with narrower follow-up items.

## What Stayed Consolidated

- The accessible forms note still owns labels, grouping, affordances, target sizes, and the baseline validation contract.
- The form validation pattern still owns implementation-ready guidance for forms, summaries, and invalid-state styling.
- No separate target-size note was needed; it remains part of the controls-and-affordances topic.

## Follow-Up

- Decide whether any shared input component needs a consistent JS fallback class for browsers that do not support `:user-invalid`.
- Revisit blur-time validation only when a specific field can show a deterministic, low-friction win.
