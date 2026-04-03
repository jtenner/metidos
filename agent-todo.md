# Agent TODO

- TLS: add HTTPS/WSS runtime support and guided TLS bootstrap.
  Reference: `docs/2026-04-03-security-remediation-plan.md` TLS Strategy. Add TLS listener/configuration support, require HTTPS/WSS outside explicit dev mode, and design the guided bootstrap flow so Codex can assist with certificate setup while still requiring explicit approval for trust-changing commands.

- Authorization: keep unsafe mode available after login, but make it explicit and auditable.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Explicit Product Decisions and Phase 2. Preserve `unsafeMode` as a normal post-login Codex configuration, but clearly label it in the UI and record its use in the audit trail.

- Verification: add end-to-end security regression coverage and keep the docs in sync.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Testing Plan. Add tests for setup, login, lockout, websocket auth, TLS-mode behavior, step-up-protected actions, CLI reset/regeneration flows, and update the security docs as implementation details settle.
