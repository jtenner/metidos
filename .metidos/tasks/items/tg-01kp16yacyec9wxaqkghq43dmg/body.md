Apply the bounded sandbox follow-up from the isolation spike, whether that means materially hardening the current vm2 path or replacing it with a safer approach.

The spike outcome is documented in `docs/2026-04-12-run-untrusted-js-isolation-audit.md`.

## Chosen Direction

- keep vm2 for the next slice instead of attempting an immediate replacement
- remove ambient network access from the sandbox
- remove unscoped Bun host APIs that bypass the worktree `fs` mock, especially `Bun.file`, `Bun.SQLite`, and `Bun.Glob`
- add regression coverage for the newly proven escape paths before widening the sandbox again

## Scope

- remove or reduce the riskiest exposed surface
- improve timeout, worker cleanup, and fs guard confidence where needed
- expand regression coverage around any newly identified attack or failure modes

## Acceptance

- the chosen plan from the spike is implemented rather than left as a note
- sandbox regressions are covered by targeted tests
- runtime behavior is measurable enough to tell whether the hardening changed failure or timeout characteristics
