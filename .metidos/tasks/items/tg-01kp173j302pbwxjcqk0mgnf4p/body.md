Fill the observability gaps called out by the audit so agent tool usage is easier to reason about in production-like runs.

## Scope

- count per-tool invocations where practical
- track unsafe-mode usage, sandbox failures/timeouts, and cron saturation in runtime stats
- make the resulting counters visible through the existing runtime stats surfaces

## Acceptance

- new counters exist for the high-risk tool paths highlighted in the audit
- tests verify the counters increment in representative paths
- the new telemetry is suitable for later load testing and capacity work