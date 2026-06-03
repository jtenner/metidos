# Auth/session test gap audit (2026-06-02)

## Scope

This note identifies auth/session tests still worth adding before a public repository release. It is a repository-readiness audit, not a security incident report.

Reviewed implementation and existing test coverage in:

- `src/bun/auth/index.ts` and `src/bun/auth/index.test.ts`
- `src/bun/auth/service.ts`, `service-login.ts`, `service-session.ts`, and `service.test.ts`
- `src/bun/auth/reset.ts` and `reset.test.ts`
- `src/bun/auth/http-security.ts`, `json-body.ts`, `rate-limit.ts`, secret-related tests, and reset tests
- `src/bun/index.ts` auth HTTP route handling for `/auth/*`
- `src/bun/project-procedures/auth-context.test.ts`
- `src/bun/rpc-websocket-auth.test.ts` and `src/bun/terminal-websocket-auth.test.ts`
- `src/mainview/auth-shell-connect.test.ts`

## Existing coverage summary

Current tests already cover the core auth service helpers well: primary-factor policy, TOTP generation and verification, recovery codes, setup/login/recovery-login/step-up/logout flows, lockout behavior, cookie helpers, websocket tickets, reset helpers, HTTP security helpers, JSON body limits, rate limiting, secret encryption/migration/error handling, RPC websocket auth, terminal websocket auth, and mainview auth-shell retry/gating behavior.

## Remaining gaps to add as actionable tests

1. **Auth HTTP route integration tests**
   - Add request/response-level tests around the `/auth/*` routes in `src/bun/index.ts`, not only the lower-level auth service.
   - Cover `/auth/status`, `/auth/csrf`, `/auth/setup/start`, `/auth/setup`, `/auth/login`, `/auth/recovery-login`, `/auth/step-up`, `/auth/reset-pin`, `/auth/reset-password`, `/auth/logout`, and `/auth/ws-ticket` with fake in-memory state where practical.
   - Assert status codes, JSON error codes, session-cookie setting/clearing, websocket-ticket cookie clearing, and `Clear-Site-Data` on logout.
   - Include stale/expired session-cookie cases where `/auth/status` and mutation routes should clear auth cookies.

2. **Auth route CSRF/origin/fetch-metadata regression tests**
   - Extend beyond helper-level tests by exercising route behavior when mutation requests omit CSRF tokens, send mismatched CSRF cookie/header values, use disallowed origins, or send hostile Fetch Metadata headers.
   - Confirm `/auth/status` remains CSRF-token-free but still applies read-request security checks.
   - Confirm `/auth/csrf` remains unauthenticated and rate limited while setting only the CSRF cookie.

3. **Session revocation side-effect integration tests**
   - Current route tests prove browser reset routes clear session and websocket-ticket cookies, revoke the pre-reset browser session, and make its pending websocket ticket unusable.
   - Current route tests prove browser reset routes use injected side-effect hooks to close authenticated websocket/terminal contexts and request active thread-turn shutdown without spawning real terminals, providers, or thread turns.
   - Current route tests prove logout clears session and websocket-ticket cookies, revokes pending websocket tickets for the logged-out session, and uses injected side-effect hooks to close only the logged-out session's websocket contexts.

4. **Auth status privacy and multi-user/pending-user route tests**
   - Current route tests cover unauthenticated status reads, authenticated status reads exposing only the current singleton local-operator identity, pending setup-start usernames staying private, stale session cookies, and explicitly revoked session cookies.
   - True wrong-session `/auth/status` coverage is blocked until the auth persistence model has per-session user ownership or a test helper that can represent a session bound to a non-current user. Today `src/bun/db.ts` stores `auth_sessions` without a user id and resolves every session through the first configured auth user, so fabricating a second user would not produce a meaningful wrong-session case.
   - When multi-user session ownership exists, add route-level tests proving wrong-session `/auth/status` responses do not leak a global user list while authenticated responses expose only that session's username and intended known-usernames metadata.
   - Pending-user setup/login route tests are not currently actionable: `createPendingUser` is a disabled legacy provisioning entrypoint for the single-local-operator model, and the HTTP auth routes do not expose pending-user provisioning. Revisit this only if pending users become HTTP-visible again.
   - If pending or multi-user HTTP endpoints return, assert deterministic, contributor-friendly error text and codes for missing users, pending users, and deleted/revoked sessions.

## Validation notes

No implementation changed in this slice. This audit was based on repository inspection only; add the tests above with fake databases, fake clocks, and injected callbacks so they can run without private services, credentials, real repositories, or personal paths.
