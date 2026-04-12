The audit identified `src/mainview/App.tsx` as a 5.8k-line shell that still owns too much UI orchestration, warning state, and derived controller logic.

## Signals

- hard-to-review changes and large merge surfaces
- warning and stale-state flows are spread across a very large file
- performance work has already had to target memoization and derived-state cleanup in this area

## Desired Outcome

Split the top-level shell into smaller modules so UI behavior can evolve without dragging the whole app through every change.