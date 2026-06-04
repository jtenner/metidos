# Kraken bot policy

The Kraken trading plugin loads bot policy from the current project/worktree file:

```text
.kraken-bot/policy.yml
```

This file is the human-editable source of truth for trading behavior. The plugin keeps a normalized cached copy in plugin storage so runtime tools and the cron can fail closed consistently.

## Reload behavior

`kraken_get_policy`, `kraken_get_status`, and `kraken_stage_intention` refresh the cached policy from `.kraken-bot/policy.yml` before returning or staging. If you edit the file, run `kraken_get_policy` or `kraken_get_status` before relying on the minute cron. Plugin v1 crons cannot read project `./` files directly, so the cron uses the last cached policy state.

If the file is missing, policy/status/stage tool calls do **not** create it automatically. They fall back to safe defaults and show a warning. To create the file explicitly, run the `new_policy` tool. It writes safe defaults: paper mode, BTC/USD and ETH/USD only, one open order/position, small loss/risk limits, limit orders only, no leverage/margin/withdrawals, and live human approval required.

## Example

```yaml
id: btc_micro_experiment_v1
enabled: true
mode: live

allowedSymbols:
  - BTC/USD

maxOpenOrders: 1
maxOpenPositions: 1
maxDailyLossFraction: 0.60
maxWeeklyLossFraction: 1.00
maxRiskPerTradeFraction: 0.50
maxMarketDataAgeMs: 10000
maxOrderAgeSeconds: 180

execution:
  allowMarketOrders: false
  allowLeverage: false
  allowMargin: false
  allowWithdrawals: false
  postOnlyByDefault: true

live:
  requiresHumanApproval: true
  maxAutonomousNotionalUsd: 10
```

## Fields

- `id`: Non-empty policy identifier. Staged intentions must match the active policy id.
- `enabled`: `true` allows staging/evaluation; `false` disables trading.
- `mode`: `paper` or `live`.
- `allowedSymbols`: Non-empty list of supported spot pairs. Currently `BTC/USD` and `ETH/USD` are allowed.
- `maxOpenOrders`: Maximum open orders, integer `0..5`.
- `maxOpenPositions`: Maximum open positions, integer `0..5`.
- `maxDailyLossFraction`: Daily loss cap as an account-equity fraction, `0..1`.
- `maxWeeklyLossFraction`: Weekly loss cap as an account-equity fraction, `0..1`.
- `maxRiskPerTradeFraction`: Per-trade risk cap as an account-equity fraction, `0..1`.
- `maxMarketDataAgeMs`: Maximum accepted market data age in milliseconds, integer `> 0`.
- `maxOrderAgeSeconds`: Staged intention lifetime, integer `> 0`.
- `execution.allowMarketOrders`: Must be `false`; market orders are hard-blocked.
- `execution.allowLeverage`: Must be `false`; leverage is not supported.
- `execution.allowMargin`: Must be `false`; margin is not supported.
- `execution.allowWithdrawals`: Must be `false`; withdrawals are not supported.
- `execution.postOnlyByDefault`: Boolean. Limit-order intent remains required.
- `live.requiresHumanApproval`: Boolean. When `true`, live intentions need a human approval envelope.
- `live.maxAutonomousNotionalUsd`: Maximum autonomous live notional when human approval is disabled, number `>= 0`.

Snake_case equivalents for known fields are accepted and normalized to camelCase in tool output.

## Validation and fail-closed behavior

The YAML schema is strict. Unknown fields, malformed YAML, missing required fields, wrong types, unsupported symbols, or unsupported safety capabilities make the policy invalid. Missing policy falls back to safe defaults with a warning until `new_policy` creates the file. Invalid policy disables trading and causes staging/cron evaluation to reject or no-op fail-closed with clear validation errors.

Hard-blocked for safety:

- market orders
- withdrawals
- margin
- leverage
- futures/raw Kraken endpoint access
- secret exposure

High risk values are allowed up to `1.0` when otherwise valid, but policy/status output warns for:

- `maxRiskPerTradeFraction > 0.05`
- `maxDailyLossFraction > 0.10`
- `mode: live` with `live.requiresHumanApproval: false`
