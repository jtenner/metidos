import type {
  HumanApproval,
  RuntimeSnapshot,
  TradeIntention,
  TradingPolicy,
  TradingRuntime,
} from "./trading-types";

export type ValidationResult = {
  ok: boolean;
  reasons: string[];
  critical?: boolean;
};

export function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/API-Key[^\n,}]*/gi, "API-Key=[redacted]")
    .replace(/API-Sign[^\n,}]*/gi, "API-Sign=[redacted]")
    .replace(/KRAKEN_[A-Z_]+[^\n,}]*/g, "KRAKEN_SECRET=[redacted]")
    .slice(0, 500);
}

function validDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function estimateRiskAmount(
  intent: TradeIntention,
  snapshot: RuntimeSnapshot,
): number {
  const perUnit =
    intent.side === "buy"
      ? intent.limit_price - intent.invalidation_price
      : intent.invalidation_price - intent.limit_price;
  const equity = snapshot.account.equity ?? 0;
  return (
    Math.max(0, perUnit * intent.quantity) || equity * intent.risk_fraction
  );
}

export function validateSystemSafety(input: {
  killSwitchLatched?: boolean;
  policy: TradingPolicy;
  runtime: TradingRuntime;
  snapshot: RuntimeSnapshot;
}): ValidationResult {
  const reasons: string[] = [];
  const { policy, runtime, snapshot } = input;
  if (input.killSwitchLatched) reasons.push("kill switch is latched");
  if (!snapshot.adapter_healthy) reasons.push("adapter is unhealthy");
  if (
    ["maintenance", "cancel_only", "unknown"].includes(snapshot.exchange_status)
  ) {
    reasons.push(`exchange status ${snapshot.exchange_status} is unsafe`);
  }
  const now = Date.now();
  for (const symbol of policy.allowedSymbols) {
    const market = snapshot.market_data[symbol];
    if (!market) {
      reasons.push(`market data missing for ${symbol}`);
      continue;
    }
    if (now - Date.parse(market.last_update_at) > policy.maxMarketDataAgeMs) {
      reasons.push(`market data stale for ${symbol}`);
    }
  }
  const localIds = new Set(
    snapshot.local_open_orders.map((order) => order.clientOrderId),
  );
  const exchangeIds = new Set(
    snapshot.account.open_orders.map((order) => order.clientOrderId),
  );
  for (const id of localIds)
    if (!exchangeIds.has(id))
      reasons.push(`local/exchange open order mismatch: ${id}`);
  for (const id of exchangeIds)
    if (!localIds.has(id)) reasons.push(`unknown exchange open order: ${id}`);
  if (snapshot.account.equity === null || snapshot.account.equity <= 0)
    reasons.push("account equity cannot be read");
  const equity = snapshot.account.equity ?? 0;
  if (
    equity > 0 &&
    snapshot.account.daily_realized_pnl <=
      -(equity * policy.maxDailyLossFraction)
  )
    reasons.push("daily loss limit reached");
  if (
    equity > 0 &&
    snapshot.account.weekly_realized_pnl <=
      -(equity * policy.maxWeeklyLossFraction)
  )
    reasons.push("weekly loss limit reached");
  if (snapshot.permission_anomaly) reasons.push("permission anomaly detected");
  if (snapshot.account.open_positions.length > policy.maxOpenPositions)
    reasons.push("unexpected open position exists");
  if (snapshot.account.open_orders.length > policy.maxOpenOrders)
    reasons.push("unexpected open order exists");
  if (
    policy.mode === "live" &&
    snapshot.account.open_orders.length > 0 &&
    (!runtime.lastPrivateStreamAt ||
      Date.now() - Date.parse(runtime.lastPrivateStreamAt) > 120_000)
  ) {
    reasons.push("private account stream stale while live orders are open");
  }
  if (snapshot.api_error_count > 3)
    reasons.push("API errors exceed configured threshold");
  return {
    critical: reasons.some((reason) =>
      /unknown exchange|permission anomaly|daily loss|weekly loss|mismatch|unexpected open|private account stream stale/.test(
        reason,
      ),
    ),
    ok: reasons.length === 0,
    reasons,
  };
}

export function validateIntention(
  intent: TradeIntention,
  context: {
    approval?: HumanApproval | null;
    policy: TradingPolicy;
    runtime: TradingRuntime;
    snapshot: RuntimeSnapshot;
  },
): ValidationResult {
  const reasons: string[] = [];
  const { policy, snapshot } = context;
  const now = Date.now();
  if (!intent.id) reasons.push("id is required");
  if (intent.mode !== "paper" && intent.mode !== "live")
    reasons.push("mode is required");
  if (intent.status !== "staged" && intent.status !== "approved")
    reasons.push("intention is not staged or approved");
  if (!validDate(intent.created_at))
    reasons.push("created_at must be a valid date");
  if (!validDate(intent.expires_at))
    reasons.push("expires_at must be a valid date");
  if (validDate(intent.expires_at) && Date.parse(intent.expires_at) <= now)
    reasons.push("intention is expired");
  if (intent.policy_id !== policy.id) reasons.push("policy id mismatch");
  if (!policy.allowedSymbols.includes(intent.symbol))
    reasons.push("symbol is not allowed");
  if (intent.side !== "buy" && intent.side !== "sell")
    reasons.push("side must be buy or sell");
  if (intent.order_type !== "limit") reasons.push("order type is not limit");
  if (intent.limit_price <= 0) reasons.push("limit_price must be positive");
  if (intent.quantity <= 0) reasons.push("quantity must be positive");
  if (intent.invalidation_price <= 0)
    reasons.push("invalidation_price must be positive");
  if (intent.risk_fraction > policy.maxRiskPerTradeFraction)
    reasons.push("risk_fraction exceeds policy");
  if (!policy.execution.allowMarketOrders && intent.order_type !== "limit")
    reasons.push("market orders are never allowed");
  const market = snapshot.market_data[intent.symbol];
  if (!market) reasons.push("market data missing");
  else {
    if (
      Date.now() - Date.parse(market.last_update_at) >
      policy.maxMarketDataAgeMs
    )
      reasons.push("market data is stale");
    if (market.spread_bps > intent.max_spread_bps)
      reasons.push("spread exceeds max_spread_bps");
  }
  const equity = snapshot.account.equity ?? 0;
  const riskAmount = estimateRiskAmount(intent, snapshot);
  if (equity <= 0) reasons.push("account equity cannot be read");
  else if (riskAmount / equity > policy.maxRiskPerTradeFraction)
    reasons.push("estimated risk exceeds policy.maxRiskPerTradeFraction");
  if (
    equity > 0 &&
    snapshot.account.daily_realized_pnl <=
      -(equity * policy.maxDailyLossFraction)
  )
    reasons.push("daily loss limit is breached");
  if (snapshot.account.open_orders.length >= policy.maxOpenOrders)
    reasons.push("open order count exceeds policy");
  if (snapshot.account.open_positions.length >= policy.maxOpenPositions)
    reasons.push("open position count exceeds policy");
  if (intent.mode === "live" && policy.live.requiresHumanApproval) {
    const approvalResult = validateHumanApproval(
      intent,
      context.approval ?? null,
      snapshot,
    );
    if (!approvalResult.ok) reasons.push(...approvalResult.reasons);
  }
  return { ok: reasons.length === 0, reasons };
}

export function selectNextExecutableIntention(
  intentions: TradeIntention[],
): TradeIntention | null {
  return (
    intentions
      .filter(
        (intent) => intent.status === "staged" || intent.status === "approved",
      )
      .filter((intent) => Date.parse(intent.expires_at) > Date.now())
      .sort(
        (left, right) =>
          Date.parse(left.created_at) - Date.parse(right.created_at),
      )[0] ?? null
  );
}

export function rejectExpiredIntentions(
  intentions: TradeIntention[],
): TradeIntention[] {
  const now = Date.now();
  return intentions.map((intent) =>
    intent.status === "staged" && Date.parse(intent.expires_at) <= now
      ? { ...intent, status: "expired" }
      : intent,
  );
}

export function validateHumanApproval(
  intent: TradeIntention,
  approval: HumanApproval | null,
  snapshot: RuntimeSnapshot,
): ValidationResult {
  const reasons: string[] = [];
  if (!approval)
    return {
      ok: false,
      reasons: ["live mode requires approval and approval is missing"],
    };
  if (approval.used_at) reasons.push("approval cannot be reused");
  if (Date.parse(approval.expires_at) <= Date.now())
    reasons.push("approval expired");
  if (approval.intention_id !== intent.id)
    reasons.push("approval intention mismatch");
  if (approval.symbol !== intent.symbol)
    reasons.push("approval symbol mismatch");
  if (approval.side !== intent.side) reasons.push("approval side mismatch");
  if (approval.quantity !== intent.quantity)
    reasons.push("approval quantity mismatch");
  if (approval.policy_id !== intent.policy_id)
    reasons.push("approval policy mismatch");
  if (approval.strategy_id !== intent.strategy_id)
    reasons.push("approval strategy mismatch");
  const riskAmount = estimateRiskAmount(intent, snapshot);
  if (Math.abs(approval.risk_amount - riskAmount) > 0.000001)
    reasons.push("approval risk amount mismatch");
  const tolerance =
    approval.limit_price * (approval.limit_price_tolerance_bps / 10000);
  if (Math.abs(approval.limit_price - intent.limit_price) > tolerance)
    reasons.push("approval limit price mismatch");
  const market = snapshot.market_data[intent.symbol];
  if (market && Math.abs(market.mid - approval.limit_price) > tolerance)
    reasons.push("current market moved outside approval tolerance");
  return { ok: reasons.length === 0, reasons };
}
