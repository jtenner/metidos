The runtime depends heavily on the Pi SDK, sidecar behaviors, event projection, and Codex credential synchronization.

## Signals

- upstream Pi changes can ripple into session resumption, event mapping, or tool policies
- migration docs already record prior compatibility and billing-related surprises
- event projection synthesizes durable runtime state, so drift can become correctness bugs

## Desired Outcome

Reduce breakage risk by adding stronger compatibility coverage and making the integration boundaries easier to reason about.