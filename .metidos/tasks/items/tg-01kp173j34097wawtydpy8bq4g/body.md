Reduce the fragility of the Pi integration boundary by adding smoke coverage and simplifying the assumptions around projected runtime state.

## Scope

- add compatibility checks that fail early when upstream Pi behavior changes in relevant ways
- tighten or document the invariants for event projection and session resumption
- keep the runtime behavior legible even when upstream APIs evolve

## Acceptance

- compatibility coverage catches meaningful integration drift
- event projection assumptions are explicit and testable
- follow-up work can tell the difference between an upstream Pi regression and a local Metidos bug