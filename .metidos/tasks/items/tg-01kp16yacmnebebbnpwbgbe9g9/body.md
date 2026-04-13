Authentication and user management are thoughtfully designed, and the first hardening slice has now tightened setup/reset factor policy, fixed the lockout undercount race, and clarified the `auth-secret.key` lifecycle. The remaining auth risk is narrower: username edge cases, custom-TOTP drift/algorithm concerns, disruptive recovery when the key is truly gone, dev-bypass exposure, and the lack of network-level rate limiting.

## Signals

- auth still relies on a custom TOTP implementation and local clock health
- username normalization and migration edges still deserve scrutiny in multi-user upgrades
- losing the original auth-secret key remains disruptive even though the failure mode is now explicit
- no network-level rate limiting exists around the local auth surface

## Desired Outcome

Keep the current strong test coverage and audit trail, while reducing the residual operational and policy weaknesses.
