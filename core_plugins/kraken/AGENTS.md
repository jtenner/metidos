# AGENTS for Kraken Trading Operations

## Purpose

This plugin is a constrained Kraken trading operations plugin, not a chatbot trader.

Agents can inspect safe account status/balances and create, inspect, or cancel local trade intentions only. A plugin-owned minute cron evaluates staged intentions through deterministic safety checks before any paper simulation or live limit order can occur; live orders are gated by the project-local `.kraken-bot/policy.yml` policy (human approval by default, or a capped autonomous budget only when explicitly configured there).

LLM-facing tools:

- `get_status` (`kraken.trading.getStatus`): compact read-only status.
- `get_runtime_snapshot` (`kraken.trading.getRuntimeSnapshot`): redacted read-only runtime snapshot.
- `get_balances` (`kraken.trading.getBalances`): read normalized non-zero account balances only; uses Kraken `BalanceEx` first and falls back to `Balance`; never returns raw private Kraken payloads.
- `stage_intention` (`kraken.trading.stageIntention`): validate and store an intention only; never places orders.
- `list_intentions` (`kraken.trading.listIntentions`): read local intentions.
- `cancel_intention` (`kraken.trading.cancelIntention`): cancel a local staged intention only; does not cancel exchange orders.
- `new_policy` (`kraken.trading.newPolicy`): explicitly create `.kraken-bot/policy.yml` from safe defaults; never places orders.
- `get_policy` (`kraken.trading.getPolicy`): read the active policy.
- `get_journal_summary` (`kraken.trading.getJournalSummary`): read recent safe journal entries.

The LLM must not directly buy, sell, cancel all, withdraw, transfer, sign Kraken requests, or call raw Kraken endpoints. Internal adapter functions may sign private Kraken REST requests, place limit orders, cancel orders, cancel all orders during emergency handling, and request cancel-on-disconnect, but those functions are not manifest-exposed tools.

## Source layout

- `metidos-plugin.json`: v1 manifest reviewed by the local operator.
- `index.ts`: plugin entry point; registers intention-only tools and the minute cron.
- `kraken-adapter.ts`: internal-only Kraken REST adapter and execution guard helpers.
- `trading-ops.ts`: staging flow and minute cron orchestration.
- `trading-safety.ts`: pure deterministic safety checks and safe error redaction.
- `trading-storage.ts`: plugin `~/trading/**` storage helpers and cached policy state.
- `policy-loader.ts`: strict `.kraken-bot/policy.yml` loader, YAML parser, normalization, validation, and safe default rendering.
- `trading-types.ts`: policy, runtime, intention, approval, journal, and kill-switch types/defaults.
- `crypto.ts`: local SHA-256/HMAC-SHA-512/base64 helpers used for Kraken `API-Sign` generation.
- `risk-tools.ts`: legacy local risk calculators retained for tests/import compatibility; not manifest-exposed.
- `.data/`: generated plugin data owned by Metidos; do not commit.
- `.logs/`: generated plugin logs when enabled; do not commit.
- `.data-bak-*`: generated reset backups; do not commit.

Root `node_modules/` is forbidden. Plugin source may import only `@metidos/plugin-api` and local relative files.

## Validation

1. Validate `metidos-plugin.json` against the manifest schema.
2. Run targeted tests:

   ```bash
   bun test src/bun/plugin/kraken-core-plugin.test.ts src/bun/plugin/manifest.test.ts
   ```

3. For broader repository changes, run the usual repository validation workflow.
4. Confirm no manifest-exposed tool can place/cancel exchange orders, withdraw, transfer, or call raw Kraken endpoints.

## `.data` contents

The plugin persists trading state under `~/trading/**`:

- `~/trading/policy-state.json`: cached last loaded `.kraken-bot/policy.yml` state, including validation errors/warnings. Thread tools refresh this from the project file; cron uses the cached state because Plugin v1 crons cannot read project `./` files.
- `~/trading/policy.json`: legacy/cache copy of the active normalized policy. `.kraken-bot/policy.yml` is the human-editable source of truth. Default mode is `paper`; live is not enabled by default.
- `~/trading/runtime.json`: runtime counters, paper orders, open-order tracking, and cron timestamps.
- `~/trading/intentions/*.json`: staged, rejected, approval-requested, approved, executed, expired, or cancelled trade intentions.
- `~/trading/approvals/*.json`: live-mode approval envelopes. Approvals expire and cannot be reused.
- `~/trading/journal/*.jsonl`: append-only safe journal entries.
- `~/trading/incidents/*.json`: kill-switch/incident records.
- `~/trading/kill-switch.json`: persistent kill-switch state.
- `~/trading/runtime-lock.json`: best-effort cron lock with a TTL longer than the cron interval.

## Safe `.data` inspection

- Prefer read-only inspection.
- Do not print or copy raw account data unless needed for local diagnosis.
- Never copy API keys, API secrets, signatures, auth headers, raw private Kraken payloads, withdrawal credentials, or hidden prompt content into logs or issue reports.
- Inspect journal summaries before editing state files.

## Safe `.data` repair

1. Stop or disable the plugin before mutating files.
2. Back up affected files or use Metidos Reset Plugin Data.
3. Prefer cancelling stale local intentions over deleting files.
4. Do not manually reset `kill-switch.json`; manual reset requires explicit future admin/human tooling and is intentionally not automatic.
5. Re-run targeted tests and restart/retry the plugin.

## Reset behavior

Metidos Reset Plugin Data moves `.data` to `.data-bak-{timestamp}`, recreates `.data`, and restarts/reloads the plugin. The default conservative policy is recreated on first use. Environment variables are not reset.

## Secrets and logs

Secrets are supplied primarily through Plugin Settings declared in `metidos-plugin.json`:

- `api_key` / **API key**: used internally by the execution guard for approved private Kraken REST requests.
- `personal_key` / **Personal key**: base64 Kraken personal/private key (API secret) used locally to generate `API-Sign`.

Optional environment fallbacks are also declared for deployments that prefer process-level secrets:

- `KRAKEN_API_KEY`: fallback for `api_key`.
- `KRAKEN_PRIVATE_KEY`: fallback for `personal_key`.

Agents cannot read these secrets or directly trigger signed raw requests. Plugin v1 does not automatically redact plugin-authored outputs, so future changes must not log secrets, signatures, auth headers, raw private payloads, withdrawal credentials, or hidden reasoning.

## Embeddings and vector search

This plugin does not provide embeddings, consume embeddings, or store LanceDB vectors.

## Trading safety model

- The LLM creates intentions only.
- The cron runs once per minute and executes at most one approved action per run.
- Trading policy is controlled by the project/worktree file `.kraken-bot/policy.yml`.
- If the policy file is missing, policy/status/stage tool calls fall back to safe defaults and warn; they do not create project files.
- The `new_policy` tool explicitly creates `.kraken-bot/policy.yml` from safe defaults.
- Policy file changes are refreshed by policy/status/stage thread tools. Cron uses the cached last loaded policy state because Plugin v1 crons cannot read project files; run `get_policy` or `get_status` after edits, or restart/reload if hot reload has not run.
- Default mode is paper.
- Live human approval is controlled by `live.requiresHumanApproval` in `.kraken-bot/policy.yml` and defaults to true.
- When live human approval is disabled, `live.maxAutonomousNotionalUsd` caps autonomous live intention notional and defaults to 10 USD.
- Live mode requires human approval unless the local operator disables that policy field; autonomous live execution remains deterministic-safety-gated and capped.
- Market orders are not supported.
- Withdrawals are never supported.
- Leverage, margin, and futures are not supported.
- Kill switch is persistent and requires manual reset by a future explicit admin/human action.
- Kraken API keys should be scoped with no withdrawal permission.
- Use separate read-only and trading keys when possible.
- Start with tiny balances.
- Intentions whose mode differs from the policy-selected `mode` are rejected.
- Prefer rejecting a trade to executing an unsafe trade.
- Prefer halt to ambiguity.

## Context notes

- All tools are thread tools and are available only when the `kraken/trading_ops` access group is enabled for the thread.
- The minute cron does not call an LLM and does not ask an agent whether to buy or sell.
- The cron routes only already-staged intentions.
- Private Kraken requests are internal-only and signed according to Kraken Spot REST authentication.
- Market snapshots prefer Kraken WebSocket v2 ticker data (`wss://ws.kraken.com/v2`) and fall back to REST ticker data if WebSocket sampling fails.
- Trade notifications are sent for paper order simulations and live limit orders after the journal entry is written.
