Change the default operating posture so new threads and crons stay in safe mode unless a user explicitly escalates to unsafe execution.

## Scope

- make unsafe creation or escalation an explicit choice with strong copy and audit coverage
- review thread and cron entrypoints so the safe path is the path of least surprise
- keep step-up requirements aligned with the new defaults

## Acceptance

- new thread and cron flows default to safe mode
- unsafe escalation is obvious, auditable, and covered by tests
- safe-thread restrictions remain enforced end-to-end