Authentication and user management are thoughtfully designed, but the audit still found meaningful hardening gaps around lockout concurrency, factor policy, username edge cases, and the lifecycle of `auth-secret.key`.

## Signals

- `auth-service.ts` is itself a large orchestration file
- lockout updates and resets are not obviously wrapped in one consistent transaction boundary
- weak PINs and no network-level rate limiting limit the strength of step-up protection
- losing the auth secret key is disruptive and needs clearer lifecycle handling

## Desired Outcome

Keep the current strong test coverage and audit trail, while reducing the residual operational and policy weaknesses.