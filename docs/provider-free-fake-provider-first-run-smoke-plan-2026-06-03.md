# Provider-free and fake-provider first-run smoke plan (2026-06-03)

This plan narrows the install/setup TODO: verify provider-free and fake-provider first-run behavior. It does not record completed smoke evidence yet; it defines a command-ready, secret-safe path for a future disposable run.

## Scope

Verify that Metidos remains understandable and usable when a new local operator has not configured any real model provider, and that a fake/local provider path fails or advertises itself clearly without requiring external credentials.

In scope:

- first authenticated app session after Local Auth setup with no real provider credentials configured,
- Settings/model selector/provider surfaces before any provider is configured,
- safe Thread/Cron creation attempts when no provider or no model is available,
- fake/local provider setup path using only disposable endpoints, loopback services, or intentionally invalid placeholder configuration,
- user-visible copy that explains what to configure next,
- sanitized evidence that records messages and outcomes without secrets, provider account metadata, private paths, or screenshots.

Out of scope:

- real provider credentials or upstream provider accounts,
- provider quality, latency, quota, or billing behavior,
- long-running agent behavior under slow providers, which is covered by `docs/usability-under-load-smoke-plan-2026-06-03.md`,
- exhaustive provider-plugin lifecycle testing, which is covered by `docs/plugin-lifecycle-smoke-plan-2026-06-03.md`,
- broad error-path coverage, which is covered by `docs/actionable-error-paths-smoke-plan-2026-06-03.md`.

## Documentation references

- `INSTALLATION.md` documents clean-clone startup, `.env` setup, Local Auth, and first-run expectations.
- `docs/model-providers.md` documents provider-qualified model IDs, secret handling, plugin-backed setup, local/private provider caveats, and troubleshooting.
- `.env.example` is the current placeholder reference for provider environment variable names.
- `docs/first-run-local-auth-smoke-plan-2026-06-03.md` covers the Local Auth setup prerequisite for this smoke.

## Preconditions and safety constraints

- Use a disposable Metidos App Data directory and disposable browser profile.
- Use a fake/demo Project repository if a Project is needed to reach Thread or Cron flows.
- Do not add real provider API keys, OAuth files, account IDs, billing data, or private provider endpoints.
- Do not commit screenshots, App Data files, cookies, WebSocket tickets, TOTP seeds, recovery-code values, full `.env` contents, private project paths, hostnames, usernames, provider account metadata, prompts containing private data, or provider request/response logs.
- Prefer no-provider and intentionally invalid loopback/fake-provider states over real upstream calls.
- Record the local Bun version and compare it with `package.json` `packageManager`. If they differ, record the mismatch as a blocker and do not use the run as release evidence.

## Suggested disposable setup

Run these checks before starting the smoke:

```bash
bun --version
node -e "const p=require('./package.json'); console.log(p.packageManager)"
uname -a
```

Start from a disposable App Data directory and a minimal provider-free environment:

```bash
appdata="$(mktemp -d /tmp/metidos-provider-free-smoke-XXXXXX)"
profile="$(mktemp -d /tmp/metidos-provider-free-browser-XXXXXX)"
port="7599"
METIDOS_APP_DATA_DIR="$appdata" METIDOS_PORT="$port" bun run start
```

Open the printed local URL in the disposable browser profile. Complete first-run Local Auth using fake/demo values if the disposable profile has no existing session.

If a fake/local provider variation is practical, use one of these safe patterns rather than real credentials:

- configure a local provider plugin with an intentionally unreachable loopback URL such as `http://127.0.0.1:9`,
- configure a fake API-key placeholder value only if the UI requires a non-empty setting,
- run a tiny disposable local HTTP fixture only if it is already available in the repository or can be created without network access and without mimicking a real provider account.

## Smoke steps

1. Start Metidos with disposable state and no real provider variables configured.
2. Complete or confirm Local Auth setup with fake/demo values.
3. Open the main app shell and confirm it does not block general navigation solely because no model provider is configured.
4. Open Settings or the model/provider surface.
   - Record the exact no-provider or no-model summary shown to the user.
   - Confirm the copy points to provider setup, Plugin Settings, `.env`, local providers, or documentation as appropriate.
5. Open any model selector reachable from Thread creation.
   - Confirm unavailable choices are disabled, empty-state copy is visible, or provider setup guidance is discoverable without hover-only UI.
6. Attempt to create a safe no-edit Thread only if the UI permits proceeding without selecting a valid model.
   - Record whether creation is blocked, deferred, or creates a Thread that fails.
   - Confirm any failure names the provider/model issue and gives a next step.
7. If Cron creation exposes model/provider selection, create a disposable disabled Cron Job or stop before saving if saving requires a real model.
   - Confirm no-provider guidance is visible and the Cron flow does not imply a provider exists.
8. Configure the fake/local provider variation using a loopback/unreachable endpoint or placeholder-only settings.
   - Record whether the provider appears as unavailable, unreachable, missing models, or invalid configuration.
   - Confirm the UI does not expose placeholder values as secrets and does not silently invent fallback models.
9. Return to the Thread/model selector and confirm the fake/local provider state is reflected consistently.
10. Stop the app with `Ctrl-C` unless another stop method is required.
11. Delete the disposable App Data directory and browser profile without printing their contents.

## Evidence to record

Commit a separate sanitized evidence note after execution with:

- date and timezone,
- OS/container image and shell,
- browser and version,
- Bun version and `package.json` `packageManager`,
- exact sanitized command shapes,
- App Data/browser profile setup method without private paths,
- no-provider status and exact user-visible message summaries,
- fake/local provider setup variation and exact user-visible status summaries,
- Thread/Cron/model selector pass/fail outcomes,
- whether setup guidance was discoverable without hover-only UI,
- stop method and teardown confirmation,
- any documentation, UI copy, provider discovery, or error-handling corrections made in the same commit.

## Acceptance criteria

The install/setup provider-free/fake-provider TODO can be marked complete only after sanitized evidence shows:

- the app remains navigable after first-run auth with no provider configured,
- Settings/model selector/Thread or Cron surfaces clearly explain the no-provider or no-model state,
- fake/local provider configuration produces deterministic unavailable/unreachable/no-model feedback instead of silent fallback behavior,
- messages provide a concrete next step toward provider setup or troubleshooting,
- no evidence contains real provider credentials, provider account metadata, private paths, hostnames, screenshots, cookies, TOTP seeds, recovery codes, or private Project data,
- any severe vague, misleading, or secret-leaking provider messages have follow-up TODOs or small fixes recorded.
