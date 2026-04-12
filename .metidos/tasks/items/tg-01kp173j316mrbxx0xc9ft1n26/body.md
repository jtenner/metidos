Turn the audit’s qualitative resource-control concerns into concrete budgets and protective behavior for the agent runtime.

## Scope

- add predictable limits around heavy tool usage and unsafe execution where practical
- extend queue protection ideas beyond the existing cron cap
- fail loudly and consistently when the runtime is saturated instead of silently degrading

## Acceptance

- high-risk or high-cost tool paths have clear limits or budgets
- cron and other long-running paths expose predictable backpressure behavior
- tests cover saturation and limit enforcement