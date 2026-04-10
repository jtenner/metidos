# Agents Todo

This file is the active execution backlog for Pi-backed follow-up work in `jt-ide`, including restoring Codex usage through Pi's built-in `openai-codex` provider.

## Rules

- Remove completed todo items from this document altogether. Do not leave completed items in place as checked, archived, or struck through entries.
- Keep the `Risks` and `Blockers` sections current before adding, reordering, or splitting slices.
- Add new slices only when they clearly map back to [the Pi migration research document](./docs/2026-04-09-pi-coding-agent-migration-research.md) or [the Codex-via-Pi wiring document](./docs/2026-04-09-codex-via-pi-wiring.md).

## Risks

- Keyring-gap risk. OpenAI documents that Codex may use OS keyring storage instead of `~/.codex/auth.json`. The recommended auto-import behavior only works when the Codex file exists, so keyring-backed Codex setups still need a fallback UX. See [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), [Blockers](./docs/2026-04-09-codex-via-pi-wiring.md#blockers), and [CD06 - Implement auth-storage behavior and diagnostics](./docs/2026-04-09-codex-via-pi-wiring.md#cd06---implement-auth-storage-behavior-and-diagnostics).
- Browser-login risk. Pi's OAuth flow is backend-only, and Jolt still has no browser UI for provider-auth state, progress, failures, or logout. The app still needs browser orchestration on top of the new backend RPC surface. See [3. Jolt now mirrors Codex file auth into Pi auth and exposes backend provider-auth RPC, but it still has no browser UI](./docs/2026-04-09-codex-via-pi-wiring.md#3-jolt-now-mirrors-codex-file-auth-into-pi-auth-and-exposes-backend-provider-auth-rpc-but-it-still-has-no-browser-ui), [4. Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#4-add-browser-provider-auth-ui), and [CD04 - Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#cd04---add-browser-provider-auth-ui).
- Headless-flow risk. Codex publicly documents device-code authentication and localhost-callback recovery, but Pi's built-in OpenAI Codex docs do not document the same end-user recovery story. Jolt should not assume it gets that parity for free. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [7. Add diagnostics and recovery](./docs/2026-04-09-codex-via-pi-wiring.md#7-add-diagnostics-and-recovery), and [Risks](./docs/2026-04-09-codex-via-pi-wiring.md#risks).
- Policy-scope risk. OpenAI documents that ChatGPT-authenticated Codex usage follows ChatGPT workspace controls and retention, while API-key usage follows API org policy instead. Jolt must make the chosen auth mode and provider obvious to users. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [4. Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#4-add-browser-provider-auth-ui), and [CD04 - Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#cd04---add-browser-provider-auth-ui).

## Blockers

- None for the recommended Pi-native path. Exact Codex credential-store parity only becomes a blocker if Jolt decides it must ship keyring support or direct reuse of `~/.codex/auth.json` before the first working implementation. See [Blockers](./docs/2026-04-09-codex-via-pi-wiring.md#blockers), [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), and [Recommendation](./docs/2026-04-09-codex-via-pi-wiring.md#recommendation).

## Todo Items

- [CD][04] - Add Browser Provider Auth UI
Turn the placeholder settings panel into a real provider-auth surface that shows Codex login state, starts login, supports logout, and explains both ChatGPT-plan versus API-billed behavior and why provider is chosen before model. See [4. Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#4-add-browser-provider-auth-ui) and [CD04 - Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#cd04---add-browser-provider-auth-ui).
- [CD][07] - Verify The Full Codex Path
Add focused backend and frontend coverage, run manual login/thread verification, and verify the selector behavior for provider, model, and reasoning effort once ChatGPT-plan-backed Codex works end to end through Pi. See [8. Test the full Codex path](./docs/2026-04-09-codex-via-pi-wiring.md#8-test-the-full-codex-path) and [CD07 - Verify the full Codex path and document operator behavior](./docs/2026-04-09-codex-via-pi-wiring.md#cd07---verify-the-full-codex-path-and-document-operator-behavior).
