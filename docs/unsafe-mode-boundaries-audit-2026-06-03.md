# Unsafe Mode Boundary Audit — 2026-06-03

## Scope

This repository-readiness slice verified whether Unsafe Mode boundaries are documented and enforced in the code paths that decide Thread and Cron Job runtime capabilities. It did not manually exercise the Mainview because that is tracked separately by the visible-warning smoke task.

## Documentation evidence

- `README.md` states Safe Mode is the default for Threads and Cron Jobs, and that Unsafe Mode broadens runtime capability for narrow, trusted work.
- `docs/security-model.md` documents filesystem boundaries and explicitly warns that Unsafe Mode can broaden runtime capabilities.
- `docs/architecture.md` documents that Safe Threads keep scoped file/search/edit/write tools, while `bash` and unsafe child Thread/Cron escalation require explicit Unsafe Mode.
- `docs/cron.md` documents the same access-control model for scheduled work and recommends keeping Unsafe Mode off unless justified.
- `docs/known-limitations.md` clarifies that Unsafe Mode is not a sandbox for arbitrary untrusted code.

## Enforcement evidence

- `src/bun/pi/thread-tool-policy.ts` builds Safe Mode tool policy without `bash` and with `allowUnsafeModeEscalation: false`; only `metidos:unsafe` enables `bash` and unsafe child escalation.
- `src/bun/pi/thread-runtime.ts` blocks Pi-native `bash` tool calls when the running Thread lacks `metidos:unsafe`.
- `src/bun/pi/metidos/shared.ts` rejects unsafe child Thread/Cron creation or update requests when the current Thread scope does not allow unsafe escalation, and records the denied request for runtime telemetry.
- `src/bun/pi/metidos/terminal.ts` requires Unsafe Mode before exposing Pi-native terminal tools.
- `src/bun/project-procedures/local-operator.ts` keeps Unsafe Mode changes behind the local-operator capability.

## Regression coverage

Targeted regression tests covering these boundaries:

- `src/bun/pi/thread-tool-policy.test.ts` verifies `bash` and unsafe child escalation are disabled by default and enabled only by `metidos:unsafe`.
- `src/bun/pi/thread-runtime.test.ts` verifies runtime policy wiring for safe and unsafe Thread tool sets.
- `src/bun/pi/metidos/tools.test.ts` covers unsafe child Thread/Cron request approval/denial behavior, terminal worktree containment, unsafe mutation serialization, and unsafe request telemetry.
- `src/bun/project-procedures/local-operator.test.ts` verifies Unsafe Mode requires the local-operator capability.

## Validation performed

- `grep -R "unsafe mode\|Unsafe Mode\|unsafe-mode" -n docs src/bun src/mainview README.md | head -80`
- `bun test src/bun/pi/thread-tool-policy.test.ts src/bun/project-procedures/local-operator.test.ts`

Result: targeted tests passed locally under Bun `1.3.13`. The workspace still declares `packageManager: bun@1.3.14`, so this evidence is useful for the narrow code/documentation boundary check but does not replace the blocked clean-install smoke evidence.

## Conclusion

Unsafe Mode boundaries are documented and enforced where applicable for the current Thread/Cron runtime model. Remaining product-readiness work should focus on the separately tracked manual Mainview smoke confirming that Unsafe Mode warnings are visible in Thread creation and Cron editor access menus.
