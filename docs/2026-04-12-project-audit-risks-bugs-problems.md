# 2026-04-12 Project Audit: Risks, Bugs, and Problems

## Review Process
- Explored project structure (src/bun/, src/mainview/, docs/, .tasks/, .metidos/)
- Grepped for TODO/FIXME/BUG/risk patterns (mostly in docs; none in src/)
- Ran `bunx biome check`, typecheck, and full test suite (`bun test`): **387 tests passed, 0 failures**
- Reviewed security audit logs (`bun run audit:log`), VM2 sandbox, auth, RPC, Git integration, Pi SDK wiring
- Analyzed architecture via README, AGENTS.md, optimization proposals, security modules
- Inspected key files: vm2-runner.ts, App.tsx (5813 LOC), security-audit.*, project-procedures/, db.ts, etc.
- Checked dependencies, .gitignore, test coverage patterns, dated artifacts

All static checks pass and tests are comprehensive (including deep security, sandbox, auth, Pi integration, and UI state tests). However, several architectural, operational, and potential security risks were surfaced.

## Surfaced Problems, Risks, and Bugs

### Critical / High Impact
1. **Monolithic Mainview (src/mainview/App.tsx - 5,813 lines)**
   - Core UI, state management, hooks, derived selectors, rendering logic, and many helpers all live in one massive file.
   - Violates separation of concerns; related code is split into src/mainview/app/* and controls/* but primary component is unwieldy.
   - **Risks**: High cognitive load, merge conflicts, difficult debugging, re-render bugs (explicitly called out in multiple optimization-proposals.md entries and OPT03/OPT04 docs). Large bundle potential despite React Compiler.
   - Related: `optimization-proposals.md` discusses memoization to catch "80% of current re-render bugs".

2. **Pervasive unsafeMode=true Across Threads**
   - Security audit log is dominated by `unsafe_mode_enabled` events (nearly every thread since early April 2026 uses it).
   - Bypasses VM2 sandbox, enables full bash access via tools, unsafe child threads/crons (see Metidos tools, sidecar-cron-runner).
   - **Risk**: Significantly expands attack surface. Agents can execute arbitrary commands, potentially escaping worktree restrictions or affecting host. Relies heavily on user discretion and step-up auth for "high-risk actions".
   - Documented in thread-tool-scope.ts, rpc-authz.ts, pi-metidos-tools.test.ts (which explicitly tests blocking unsafe escalation from safe threads).

3. **VM2 Sandbox Hardening Gaps and Historical Risks**
   - vm2 (^3.10.5) has a well-known history of sandbox escape CVEs. This project runs untrusted agent/LLM-generated JS.
   - Custom `buildVm2FsMock()` is extremely complex (50+ wrapped methods for path resolution, write guards, open flags parsing, symlink handling). `assertWritableResolvedPath`, `resolveWorktreePath`, and promise wrappers could have edge-case bypasses (TOCTOU, symlink races, Bun.Glob/Bun.file abuse).
   - Global `patchVm2SetupSandboxReadFileSync()` monkey-patches `fs.readFileSync` to workaround Bun + vm2 incompatibility. Fragile, affects entire process, only applied once but still a hack.
   - The first hardening slice has now removed ambient `fetch` plus unscoped `Bun.file`, `Bun.SQLite`, and `Bun.Glob` from the safe sandbox, but vm2 still exposes a reduced Bun helper subset and still relies on the process-wide Bun compatibility patch.
   - Tests now cover the removed Bun/global escape paths as well as the older Node `fs` and timeout constraints, but the runner still depends on vm2 and a large custom `fs` policy surface.
   - See `runUntrustedJavaScriptInVm2()`, worker communication, timeout handling.

### Medium Impact
4. **Persistent Performance, Concurrency, and Reliability Issues**
   - `docs/optimization-proposals.md` + 15+ dated OPT* docs detail past bugs:
     - UI re-render storms (memoization, derived state cleanup).
     - SQLite contention (WAL tuning, query plans, indexes, retry metrics, sidecar telemetry DB to avoid polluting main DB).
     - RPC payload bloat, thread status refresh deduping, cron concurrency caps, starvation detection.
     - Mainview build modes, cacheable assets, sourcemaps.
   - runtime-stats.ts, runtime-stats-sidecar.ts, starvation-harness.ts exist specifically to measure these.
   - **Risk**: Production deployments may still hit memory pressure, slow queries, or UI lag under load. Telemetry is present but requires `--track-telemetry`.
   - WAL, indexes, and sidecar implemented per docs, but baseline benchmarks and further slices remain.

5. **Deep TS Review: Authentication, User Management & Related Modules**
   - **Core Files Examined**: `auth-service.ts` (1494 LOC orchestration for setup/login/sessions/tickets/step-up/lockouts), `auth.ts` (TOTP, Argon2id/Bun.password, recovery, HOTP impl), `auth-secrets.ts` (AES-GCM key mgmt with `auth-secret.key`), `auth-reset.ts`, `db.ts` (multi-user schema, migrations, queries), `rpc-authz.ts`, `rpc-websocket-auth.ts`, `project-security-audit.ts`, `project-procedures/*.ts` (user scoping, admin/pending users), mainview auth-shell/* + tests. Sampled ~50 other TS files (vm2-runner, git, pi-*, state, controls, etc.).
   - **Strengths**: Parameterized SQL (no injection), strong types, exhaustive tests (lockout, recovery, step-up, dev-bypass, multi-user, WS tickets, Pi auth sync – all pass), constant-time password verify, owner-only file perms (0600/0700, Windows graceful), session idle timeouts, single-use WS tickets (60s), audit events for all sensitive paths, legacy migration handling, CHECK constraints on DB, per-user TOTP encryption, step-up for high-risk (cross-workspace createThread, unsafe toggles, deletes).
   - **Risks/Bugs Surfaced**:
     - Maintainability: `auth-service.ts` is monolithic (helpers for timing, normalization, failure state, session resolve/touch, error codes). Mirrors App.tsx issues.
     - Lockout/concurrency: 3-failure → 10min lock; per-user but potential races on concurrent attempts (WAL helps; no explicit TX in all helpers). Tests simulate long timings (>3s for lockout scenarios).
     - TOTP: Custom impl (SHA1-HMAC, time counter, +/-1 window) solid but SHA1 deprecated; drift risk if clocks skew. Manual base32, crypto.subtle calls async.
     - Primary factor: PIN (min 6 digits) or password; weak PINs limit step-up value. No additional 2FA beyond TOTP/recovery.
     - Secrets: Persisted key critical (auto-gen on first use); reset path exists but full DB wipe needed if lost. Decrypt on every login.
     - Multi-user: Admins control pending users/TOTP setup; ownerUserId on all entities. Legacy tables co-exist with migration – risk of inconsistent state if upgrade partial. Username NOCASE UNIQUE but normalization (trim) could allow edge duplicates/spoofs.
     - Step-up/Unsafe: Protects escalation but audit logs show near-universal unsafeMode=true post-auth (bypasses VM2 entirely). DevBypass skips many checks.
     - Other TS: Good normalization in `git.ts`/`thread-tool-scope.ts` (rejects .. / symlinks / cross-scope), but VM2 patch, large derived state in mainview/app/state.ts, complex Pi event projection all add vectors. No TODOs but many test-only dev paths.
     - General: Strong test coverage (auth-service.test.ts, db.test.ts, etc.) but slow integration tests could hide flakiness. Relies on local env (no network rate limits).
   - Positive: No obvious vulns in sampled code; security-first design with audits, bounds checking, immutable where possible (deepFreeze in VM2).

6. **Tight Coupling to External Pi SDK and Sidecars**
   - Heavy use of `@mariozechner/pi-coding-agent`, `pi-thread-runtime.ts`, Metidos tools bridge (`createPiMetidosTools`), extension UI, cron sidecar.
   - `pi-runtime-probe.test.ts`, migration research docs highlight Bun compatibility risks, missing features (Actions streaming), and session resumption quirks.
   - **Risk**: Upstream Pi changes could break RPC schema, tool scoping, event projection, or telemetry. `project-procedures/` abstracts much of it but adds maintenance burden.
   - Cron scheduler (`sidecar-cron-scheduler.ts`, `sidecar-cron-runner.test.ts`) has queue caps and duration telemetry to mitigate overload.

### Low / Observational
7. **Task Graph and Generated Files**
   - `.metidos/tasks/` (config.toml, items/, tags.toml) is canonical repository data and is committed to VCS.
   - `.metidos/cache/` and `.metidos-build/` are derived artifacts and should stay ignored.
   - Contributor guidance now states that the general generated-file rule does not apply to the canonical task graph.

8. **Future-Dated Artifacts and Test Data**
   - All docs/, audit logs, and simulated current date use 2026-04-*. May indicate mocked time in test env.
   - **Risk**: Cron schedules, timestamps in SQLite (thread-metadata, runtime-stats), or date-based logic could behave unexpectedly in real 202x deployments if not normalized.

9. **UI/UX Warning Surface**
   - Abundant "warning" tones, unsafe mode popovers, provider error badges, re-render guards. `shouldRenderUnsafeModePopover`, message-ui.tsx warnings.
   - No code-level TODO/FIXME (positive hygiene), but implies many edge cases around errors, loading states, stale data.

10. **Scalability Limits**
    - Single-process Bun server handling WebSocket RPC, SQLite, Git FS ops, VM workers, cron scheduler, telemetry sidecar.
    - `server-security.test.ts`, `tls-config.ts`, origin allowlisting good, but production TLS is reverse-proxy only.
    - Large number of integration tests (many >500ms) indicates complex interactions that could hide intermittent bugs under load.

## Comprehensive List of All Surfaced Issues (Consolidated from Full TS + Agent Tools Review)

**High**:
1. Monolithic files (App.tsx 5.8k LOC, auth-service.ts ~1.5k, pi-metidos-tools.ts ~1.4k) – maintainability, bugs in re-renders/state, hard to evolve tools/auth.
2. Pervasive unsafeMode (audit logs, post-step-up tool use) – bypasses all VM2/fs scoping despite enforce*Scope and tests.
3. VM2 risks (CVEs, complex 50+ method fs mock with potential races/symlink/TOCTOU/Bun API escapes despite worktree tests, global fs patch, Worker leaks on timeout/terminate, broad sandbox exposure).

**Medium**:
4. Auth/user issues: Custom TOTP (SHA-1, clock risks), lockout races (no universal TX), critical auth-secret.key (reset path exists but disruptive), weak PIN step-up, legacy migration complexity, username edges, devBypass, no ratelimits.
5. Agent tools gaps: Monolithic pi-metidos-tools (schemas, per-call scoping, RPC delegation for list/update/new_thread/cron/focus/runUntrustedJS/etc.); the first missing telemetry slice is now in place through a `metidosTools` runtime-stats bucket (per-tool calls, explicit unsafe-mode requests, vm2 failures/timeouts), and the next follow-up now adds shared budgets plus loud saturation failures for sandbox runs and child thread/cron mutations, but broader load validation still remains; cron DoS via unsafe; GitHub truncation; complex projection/normalization (many edge tests = prior bugs); scope canonicalization platform edges.
6. Performance (re-renders, SQLite despite WAL/indexes/sidecar, RPC, cron, memory per 15+ OPT docs); slow tests risk flakiness; large mainview state/selectors/workers.
7. Pi/SDK coupling (pi-thread-runtime, Codex sync, event projection, session quirks, migration risks – breaks tools/telemetry on upstream change).
8. Security surface (strong scoping/audits/headers but residual from unsafe/VM2/keyfile/tool breadth; no vuln scanning in validate).

**Low/Observational**:
9. `.metidos/` mixes canonical task-graph data with derived local artifacts, so the repo policy has to keep that distinction explicit; 2026 dates (time skew?); abundant warnings/edges (no TODOs good); single-process limits; large test surface (387 passing but maintenance heavy); Git/fs/command normalization solid but complex.
10. Positives: Clean code/lint/TS, exhaustive tests (auth, scope, VM escapes, lockouts, Pi, normalization, derived state), parameterized DB, constant-time verifies, strong bounds/telemetry foundation, React Compiler.

## Task Graph Follow-up
- The audit findings are now decomposed into the git-native task graph under `.metidos/tasks/items/`.
- Umbrella epic: `tg-01kp16yachnc2h5f7wm9kd8eqa` — **Address 2026-04-12 audit risks across runtime, tools, and UI**.
- Child risk records and mitigation tasks capture the main remaining clusters: mainview modularity, unsafe/vm2 execution boundaries, auth hardening, and performance/load validation.
- The task-graph policy-clarity follow-up was addressed directly in repo guidance (`AGENTS.md`, `.tasks/todo.md`, `.gitignore`).
- The `run_untrusted_js` isolation spike is now captured in [docs/2026-04-12-run-untrusted-js-isolation-audit.md](./2026-04-12-run-untrusted-js-isolation-audit.md), which narrowed the next vm2 hardening slice to removing ambient network and unscoped Bun host APIs before considering a full replacement.
- That first vm2 hardening slice is now implemented in the runner and its regression tests, so the remaining vm2 risk is narrower than it was in the original audit snapshot.
- The first agent-tool telemetry slice is now implemented too, and that follow-up now includes shared budgets plus saturation counters around sandbox runs, child thread/cron mutations, and unsafe child operations. That narrows the remaining observability gap to load-test baselines instead of leaving the high-risk paths completely unbounded.
- New thread-start requests, interactive threads, and cron definitions now default to safe mode unless `unsafeMode` is explicitly requested through the admin-authorized backend path, and regression tests now pin that behavior across the main creation entrypoints.
- The Pi compatibility slice is now implemented too: a shared `pi-sdk-shapes.ts` boundary plus a real Bun-SDK runtime smoke test keep event projection, telemetry extraction, and session-resume assumptions aligned in one place instead of scattering Pi-owned payload knowledge across the runtime.
- The auth-service monolith has now been split into focused setup/login, session/ticket, cookie, and shared-core modules behind the stable `auth-service.ts` entrypoint, so the remaining auth hardening task is no longer blocked on editing one 1.5k-line orchestration file.

## Recommendations
- **Priority**: Split monoliths; keep the new safe-by-default thread/cron posture intact while measuring unsafe adoption; build on the new tool/unsafe/vm2 telemetry and landed budgets with load tests; harden VM2 (update, more tests, or replace); key rotation + ratelimits.
- **Security**: Automated audits/vuln scans; review all tool paths for escapes; stronger auth defaults.
- **Perf/Obs**: Finish OPT roadmap with production telemetry; load test agent tool usage.
- **Maintenance**: Keep the clarified `.metidos/tasks/**` versus `.metidos/cache/**` policy aligned across AGENTS, `.tasks/`, and `.gitignore`; keep this doc updated as single source; follow `.tasks/commit.md` strictly for changes. Refactor tools to modular files.
- **Next**: Production build/load test with heavy unsafe/agent workloads using the new tool telemetry and newly bounded high-risk paths.

This audit document now contains *all* problems, risks, and bugs surfaced from the complete review of TypeScript files and agent tools. It serves as the canonical record. Updated 2026-04-12. Cross-reference optimization-proposals.md, thread-tool-access-controls.md, security tests, AGENTS.md, and the linked task graph epic.
