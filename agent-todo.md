# Agent TODO

- Phase 1: enforce login throttling and lockout rules.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Recommended Authentication Model and Phase 4. Apply the three-failed-attempt, 10-minute lockout behavior to PIN/password login attempts and cover it with tests for both primary-factor modes.

- TLS: add HTTPS/WSS runtime support and guided TLS bootstrap.
  Reference: `docs/2026-04-03-security-remediation-plan.md` TLS Strategy. Add TLS listener/configuration support, require HTTPS/WSS outside explicit dev mode, and design the guided bootstrap flow so Codex can assist with certificate setup while still requiring explicit approval for trust-changing commands.

- UI: gate the app behind authorization and add auth screens.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Default-Deny Policy and File-Level Implementation Plan. Update `src/mainview/App.tsx` and related UI files so the app stays locked until auth succeeds, then add setup, login, TOTP enrollment, step-up, and recovery-code views.

- Authorization: add step-up checks for selected high-risk actions.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Step-up auth and Phase 2. Require fresh primary-factor plus TOTP verification for package-script execution, cross-project or cross-worktree thread creation, project deletion, recovery-code operations, and reset flows.

- Authorization: keep unsafe mode available after login, but make it explicit and auditable.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Explicit Product Decisions and Phase 2. Preserve `unsafeMode` as a normal post-login Codex configuration, but clearly label it in the UI and record its use in the audit trail.

- Sidecar: enforce project/worktree scoping in the MCP layer.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Phase 2. Restrict `src/bun/codex-sidecar-mcp.ts` so the sidecar stays within the bound thread/project/worktree by default and only uses explicit privileged override paths for cross-project work.

- CLI recovery: add authenticated CLI reset and recovery-code regeneration.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Explicit Product Decisions and File-Level Implementation Plan. Implement `src/bun/auth-reset.ts` so command-line users can do password/PIN reset and recovery-code regeneration only after a fresh auth round with the configured primary factor plus TOTP.

- Dev flows: add explicit dev bypass and dev reset behavior.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Dev Reset Policy. Implement `JOLT_DEV_BYPASS=1` and `JOLT_DEV_RESET=1`, keep both off by default, and make dev reset wipe the full local database rather than trying to do partial auth/session cleanup.

- Persistence: reduce sensitive local storage and harden app data handling.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Phase 3. Remove risky browser persistence such as unsent chat text and `pendingThreadUnsafeMode`, tighten local DB location/permissions, and eliminate or heavily restrict the temp-directory fallback.

- Verification: add end-to-end security regression coverage and keep the docs in sync.
  Reference: `docs/2026-04-03-security-remediation-plan.md` Testing Plan. Add tests for setup, login, lockout, websocket auth, TLS-mode behavior, step-up-protected actions, CLI reset/regeneration flows, and update the security docs as implementation details settle.
