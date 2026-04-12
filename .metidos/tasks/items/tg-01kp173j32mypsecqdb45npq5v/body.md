Follow through on the auth-specific hardening opportunities highlighted by the audit after the auth service is easier to change safely.

## Scope

- evaluate stronger primary-factor requirements or make the current tradeoffs explicit
- tighten lockout and reset transitions where concurrency or partial updates are risky
- improve the operational story around `auth-secret.key`, recovery, and migration edge cases

## Acceptance

- auth factor policy is clearer and harder to misconfigure
- lockout semantics are backed by tests that cover concurrent or repeated failure paths
- secret-key lifecycle and migration expectations are documented and testable