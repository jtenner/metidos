# Agent TODO

- TLS: add HTTPS/WSS runtime support and guided TLS bootstrap.
  Reference: `docs/2026-04-03-security-remediation-plan.md` TLS Strategy. Add TLS listener/configuration support, require HTTPS/WSS outside explicit dev mode, and design the guided bootstrap flow so Codex can assist with certificate setup while still requiring explicit approval for trust-changing commands.

- Verification: add end-to-end security regression coverage and keep the docs in sync.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Testing Plan. Add tests for setup, login, lockout, websocket auth, TLS-mode behavior, step-up-protected actions, CLI reset/regeneration flows, and update the security docs as implementation details settle.
