# Agents Todo

This file is the active execution backlog for Pi-backed follow-up work in `jt-ide`, including restoring Codex usage through Pi's built-in `openai-codex` provider.

## Rules

- Remove completed todo items from this document altogether. Do not leave completed items in place as checked, archived, or struck through entries.
- Keep the `Risks` and `Blockers` sections current before adding, reordering, or splitting slices.
- Add new slices only when they clearly map back to [the Pi migration research document](./docs/2026-04-09-pi-coding-agent-migration-research.md) or [the Codex-via-Pi wiring document](./docs/2026-04-09-codex-via-pi-wiring.md).

## Risks

- Keyring-gap risk. OpenAI documents that Codex may use OS keyring storage instead of `~/.codex/auth.json`. Jolt now explains that state more clearly, but keyring-backed Codex setups still need a fallback operator flow because the automatic import only works when the Codex file exists. See [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), [7. Add diagnostics and recovery](./docs/2026-04-09-codex-via-pi-wiring.md#7-add-diagnostics-and-recovery), and [Verification status on 2026-04-09](./docs/2026-04-09-codex-via-pi-wiring.md#8-test-the-full-codex-path).
- Headless-flow risk. Codex publicly documents device-code authentication and localhost-callback recovery, but Pi's built-in OpenAI Codex docs do not document the same end-user recovery story. Jolt documents the gap and surfaces manual-code completion, but it still should not assume full CLI parity. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [7. Add diagnostics and recovery](./docs/2026-04-09-codex-via-pi-wiring.md#7-add-diagnostics-and-recovery), and [Risks](./docs/2026-04-09-codex-via-pi-wiring.md#risks).
- Policy-scope risk. OpenAI documents that ChatGPT-authenticated Codex usage follows ChatGPT workspace controls and retention, while API-key usage follows API org policy instead. Jolt now labels the providers and auth sources, but operators still need to understand which side they selected. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [4. Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#4-add-browser-provider-auth-ui), and [CD04 - Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#cd04---add-browser-provider-auth-ui).

## Blockers

- None for the recommended Pi-native path. Exact Codex credential-store parity only becomes a blocker if Jolt decides it must ship keyring support or direct reuse of `~/.codex/auth.json` before the first working implementation. See [Blockers](./docs/2026-04-09-codex-via-pi-wiring.md#blockers), [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), and [Recommendation](./docs/2026-04-09-codex-via-pi-wiring.md#recommendation).

## Todo Items

No active todo items. Add new slices only when new Pi or Codex follow-up work is accepted into the backlog under the rules above.
