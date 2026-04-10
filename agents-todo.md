# Agents Todo

This file is the active execution backlog for Pi-backed follow-up work in `jt-ide`, including Codex usage through Pi's built-in `openai-codex` provider.

## Rules

- Remove completed todo items from this document altogether. Do not leave completed items in place as checked, archived, or struck through entries.
- Keep the `Risks` and `Blockers` sections current before adding, reordering, or splitting slices.
- Add new slices only when they clearly map back to [the Pi migration research document](./docs/2026-04-09-pi-coding-agent-migration-research.md) or [the Codex-via-Pi wiring document](./docs/2026-04-09-codex-via-pi-wiring.md).

## Risks

- Keyring-gap risk. OpenAI documents that Codex may use OS keyring storage instead of `~/.codex/auth.json`. Jolt now gives operators explicit recovery steps and marks unauthenticated Codex provider rows as unavailable, but it still does not read the OS keyring directly. See [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), [7. Add diagnostics and recovery](./docs/2026-04-09-codex-via-pi-wiring.md#7-add-diagnostics-and-recovery), [CD08 - Add keyring and headless recovery guidance](./docs/2026-04-09-codex-via-pi-wiring.md#cd08---add-keyring-and-headless-recovery-guidance), and [CD10 - Surface unavailable Codex providers in the selector](./docs/2026-04-09-codex-via-pi-wiring.md#cd10---surface-unavailable-codex-providers-in-the-selector).
- Headless-flow risk. Codex publicly documents device-code authentication and localhost-callback recovery, but Pi's built-in OpenAI Codex docs do not document the same end-user recovery story. Jolt now surfaces device-code guidance in-product, but it still should not assume full CLI parity. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [7. Add diagnostics and recovery](./docs/2026-04-09-codex-via-pi-wiring.md#7-add-diagnostics-and-recovery), and [CD08 - Add keyring and headless recovery guidance](./docs/2026-04-09-codex-via-pi-wiring.md#cd08---add-keyring-and-headless-recovery-guidance).
- Policy-scope risk. OpenAI documents that ChatGPT-authenticated Codex usage follows ChatGPT workspace controls and retention, while API-key usage follows API org policy instead. Jolt now surfaces that distinction in Settings and in the provider/model selector, but operators can still choose the wrong provider if they ignore those cues. See [3. Public Codex authentication behavior is documented](./docs/2026-04-09-codex-via-pi-wiring.md#3-public-codex-authentication-behavior-is-documented), [CD04 - Add browser provider-auth UI](./docs/2026-04-09-codex-via-pi-wiring.md#cd04---add-browser-provider-auth-ui), and [CD09 - Expose provider billing and policy scope in the selector](./docs/2026-04-09-codex-via-pi-wiring.md#cd09---expose-provider-billing-and-policy-scope-in-the-selector).

## Blockers

- None for the recommended Pi-native path. Exact Codex credential-store parity only becomes a blocker if Jolt decides it must ship keyring support or direct reuse of `~/.codex/auth.json` before the first working implementation. See [Blockers](./docs/2026-04-09-codex-via-pi-wiring.md#blockers), [6. Decide on auth-storage parity](./docs/2026-04-09-codex-via-pi-wiring.md#6-decide-on-auth-storage-parity), and [Recommendation](./docs/2026-04-09-codex-via-pi-wiring.md#recommendation).

## Todo Items

No active todo items. Add new slices only when new Pi or Codex follow-up work is accepted into the backlog under the rules above.
