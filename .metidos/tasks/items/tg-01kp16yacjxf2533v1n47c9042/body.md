The audit identified `src/mainview/App.tsx` as an oversized shell that still owns too much UI orchestration, warning state, and derived controller logic.

## Signals

- recent refactors extracted step-up auth, Pi extension UI, desktop thread-switcher state, and visible-message mapping into focused hooks, but `App.tsx` still sits at roughly 5.3k lines
- hard-to-review changes and large merge surfaces remain around the shell-level selection/workspace orchestration
- performance work has already had to target memoization and derived-state cleanup in this area

## Desired Outcome

Continue splitting the top-level shell into smaller modules so UI behavior can evolve without dragging the whole app through every change.

## Remaining Gap

The riskiest leftovers are the broad selection/workspace flows that still tie project navigation, thread opening, and view switching together inside one component.
