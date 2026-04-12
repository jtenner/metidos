Create repeatable load and benchmark coverage for the runtime paths that the audit flagged as likely to regress under real pressure.

## Scope

- run agent-heavy scenarios with telemetry enabled so counters and queue behavior can be inspected
- capture baseline measurements for safe versus unsafe flows where that comparison matters
- explicitly exercise time-sensitive cron and runtime paths so date assumptions are not left implicit

## Acceptance

- there is a documented and repeatable way to run the benchmark or load suite
- the resulting measurements are useful enough to compare future changes
- the suite validates the high-risk runtime changes linked through `tests_for`