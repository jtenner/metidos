Apply the bounded sandbox follow-up from the isolation spike, whether that means materially hardening the current vm2 path or replacing it with a safer approach.

## Scope

- remove or reduce the riskiest exposed surface
- improve timeout, worker cleanup, and fs guard confidence where needed
- expand regression coverage around any newly identified attack or failure modes

## Acceptance

- the chosen plan from the spike is implemented rather than left as a note
- sandbox regressions are covered by targeted tests
- runtime behavior is measurable enough to tell whether the hardening changed failure or timeout characteristics