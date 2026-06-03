// @ts-nocheck
type ScalarRecord = Record<string, unknown>;

type ToolResult = {
  reasons: string[];
  metrics: Record<string, unknown>;
};

function record(value: unknown): ScalarRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ScalarRecord)
    : {};
}

function numberValue(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const number = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(number) ? number : fallback;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 200) : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSet(value: unknown, fallback: string[]): Set<string> {
  return new Set(
    (Array.isArray(value) ? value : fallback)
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function firstRecord(...values: unknown[]): ScalarRecord {
  for (const value of values) {
    const candidate = record(value);
    if (Object.keys(candidate).length > 0) return candidate;
  }
  return {};
}

function nested(policy: ScalarRecord, key: string): ScalarRecord {
  return record(policy[key]);
}

function policyNumber(
  policy: ScalarRecord,
  directKey: string,
  nestedKey: string,
  defaultValue: number,
): number {
  if (policy[directKey] !== undefined)
    return numberValue(policy[directKey], defaultValue);
  const risk = nested(policy, "risk");
  return numberValue(risk[nestedKey], defaultValue);
}

function policyBool(
  policy: ScalarRecord,
  directKey: string,
  nestedGroup: string,
  nestedKey: string,
  defaultValue: boolean,
): boolean {
  if (policy[directKey] !== undefined)
    return booleanValue(policy[directKey], defaultValue);
  return booleanValue(nested(policy, nestedGroup)[nestedKey], defaultValue);
}

export function validateOrderIntent(input: unknown): ToolResult & {
  execution_intent_valid: boolean;
  normalized_intent: ScalarRecord | null;
} {
  const payload = record(input);
  const intent = firstRecord(payload.order_intent, payload);
  const policy = record(payload.policy);
  const reasons: string[] = [];
  const required = [
    "intent_id",
    "strategy_id",
    "symbol",
    "side",
    "order_type",
    "quantity",
    "invalidation_price",
    "time_in_force",
    "client_order_id",
    "mode",
  ];

  for (const key of required) {
    if (
      intent[key] === undefined ||
      intent[key] === null ||
      intent[key] === ""
    ) {
      reasons.push(`missing required field: ${key}`);
    }
  }

  const side = stringValue(intent.side);
  if (side !== "buy" && side !== "sell")
    reasons.push("side must be buy or sell");

  const orderPolicy = nested(policy, "orders");
  const allowedOrderTypes = stringSet(
    policy.allowed_order_types ?? orderPolicy.allowed_order_types,
    ["limit"],
  );
  const orderType = stringValue(intent.order_type, "limit");
  if (!allowedOrderTypes.has(orderType))
    reasons.push(`order_type ${JSON.stringify(orderType)} not allowed`);
  if (
    orderType === "market" &&
    !policyBool(
      policy,
      "allow_market_orders",
      "orders",
      "allow_market_orders",
      false,
    )
  ) {
    reasons.push("market orders are disabled");
  }
  if (orderType === "limit" && numberValue(intent.limit_price) <= 0) {
    reasons.push("limit orders require limit_price > 0");
  }
  if (
    stringValue(intent.mode, "paper") === "live" &&
    !booleanValue(policy.live_trading_enabled)
  ) {
    reasons.push("live trading disabled by policy");
  }
  if (
    policyBool(
      policy,
      "require_client_order_id",
      "orders",
      "require_client_order_id",
      true,
    ) &&
    !stringValue(intent.client_order_id)
  ) {
    reasons.push("client_order_id required");
  }
  if (
    intent.post_only === false &&
    booleanValue(intent.maker_fee_assumption_used)
  ) {
    reasons.push("post_only required when maker fee assumption is used");
  }

  if (numberValue(intent.quantity) <= 0) reasons.push("quantity must be > 0");
  if (numberValue(intent.invalidation_price) <= 0)
    reasons.push("invalidation_price must be > 0");

  return {
    execution_intent_valid: reasons.length === 0,
    metrics: {},
    normalized_intent: reasons.length === 0 ? intent : null,
    reasons,
  };
}

export function sizePosition(input: unknown): ToolResult & {
  sizing_ok: boolean;
  quantity: number;
  notional: number;
  max_loss_at_invalidation: number;
  risk_fraction: number | null;
} {
  const payload = record(input);
  const reasons: string[] = [];
  const equity = numberValue(payload.account_equity);
  const side = stringValue(payload.side);
  const entry = numberValue(payload.entry_price);
  const stop = numberValue(payload.invalidation_price);
  const riskFraction = numberValue(
    payload.risk_fraction ?? payload.max_risk_per_trade_fraction,
    0.001,
  );
  const maxNotionalFraction = numberValue(payload.max_notional_fraction, 0.01);
  const feeBps = numberValue(payload.fee_bps);
  const slippageBps = numberValue(payload.slippage_bps);
  const qtyStep = numberValue(payload.quantity_step, 0.00000001);

  if (equity <= 0) reasons.push("account_equity must be > 0");
  if (side !== "buy" && side !== "sell")
    reasons.push("side must be buy or sell");
  if (entry <= 0) reasons.push("entry_price must be > 0");
  if (stop <= 0) reasons.push("invalidation_price must be > 0");
  if (riskFraction <= 0) reasons.push("risk_fraction must be > 0");
  if (maxNotionalFraction <= 0)
    reasons.push("max_notional_fraction must be > 0");
  if (reasons.length === 0 && side === "buy" && stop >= entry) {
    reasons.push("buy invalidation_price must be below entry_price");
  }
  if (reasons.length === 0 && side === "sell" && stop <= entry) {
    reasons.push("sell invalidation_price must be above entry_price");
  }
  if (reasons.length > 0) {
    return {
      max_loss_at_invalidation: 0,
      metrics: {},
      notional: 0,
      quantity: 0,
      reasons,
      risk_fraction: null,
      sizing_ok: false,
    };
  }

  const rawRiskPerUnit = Math.abs(entry - stop);
  const costPerUnit = (entry * (feeBps + slippageBps)) / 10000;
  const riskPerUnit = rawRiskPerUnit + costPerUnit;
  const lossBudget = equity * riskFraction;
  if (riskPerUnit <= 0) reasons.push("risk_per_unit must be > 0");

  const qtyByRisk = lossBudget / riskPerUnit;
  const maxNotional = equity * maxNotionalFraction;
  const qtyByNotional = maxNotional / entry;
  let quantity = Math.min(qtyByRisk, qtyByNotional);
  if (qtyStep > 0) quantity = Math.floor(quantity / qtyStep) * qtyStep;
  const notional = quantity * entry;
  const maxLoss = quantity * riskPerUnit;
  if (quantity <= 0) reasons.push("computed quantity rounds to zero");

  return {
    max_loss_at_invalidation: maxLoss,
    metrics: {
      clamped_by_notional: qtyByNotional < qtyByRisk,
      estimated_cost_per_unit: costPerUnit,
      loss_budget: lossBudget,
      max_notional: maxNotional,
      raw_risk_per_unit: rawRiskPerUnit,
      risk_per_unit_including_costs: riskPerUnit,
    },
    notional,
    quantity,
    reasons,
    risk_fraction: equity > 0 ? maxLoss / equity : null,
    sizing_ok: reasons.length === 0,
  };
}

export function riskGate(input: unknown): ToolResult & {
  approved: boolean;
  required_actions_before_resubmission: string[];
} {
  const payload = record(input);
  const intent = firstRecord(payload.order_intent, payload);
  const account = record(payload.account);
  const policy = record(payload.policy);
  const reasons: string[] = [];
  const actions: string[] = [];

  const mode = stringValue(intent.mode, "paper");
  if (mode === "live" && !booleanValue(policy.live_trading_enabled)) {
    reasons.push("live mode requested but live_trading_enabled is false");
    actions.push("enable live mode only after paper gate and human approval");
  }
  if (booleanValue(policy.kill_switch_latched)) {
    reasons.push("kill switch is latched");
    actions.push("manual reset required");
  }

  const equity = numberValue(account.equity);
  if (equity <= 0) {
    return {
      approved: false,
      metrics: {},
      reasons: ["account equity must be available and > 0"],
      required_actions_before_resubmission: ["provide account equity"],
    };
  }

  const side = stringValue(intent.side);
  const entry = numberValue(intent.limit_price ?? intent.entry_price);
  const stop = numberValue(intent.invalidation_price);
  const qty = numberValue(intent.quantity);
  const feeBps = numberValue(
    intent.fee_bps_estimate ?? policy.taker_fee_bps_estimate,
  );
  const slippageBps = numberValue(
    intent.slippage_bps_estimate ?? policy.extra_slippage_bps_estimate,
  );

  if (side !== "buy" && side !== "sell")
    reasons.push("side must be buy or sell");
  if (entry <= 0) reasons.push("entry/limit price must be > 0");
  if (stop <= 0) reasons.push("invalidation price must be > 0");
  if (qty <= 0) reasons.push("quantity must be > 0");

  const symbolsPolicy = nested(policy, "symbols");
  const allowedSymbols = stringSet(
    policy.allowed_symbols ?? symbolsPolicy.allowed,
    [],
  );
  const symbol = stringValue(intent.symbol);
  if (allowedSymbols.size > 0 && !allowedSymbols.has(symbol)) {
    reasons.push(`symbol ${JSON.stringify(symbol)} is not in allowed_symbols`);
  }

  const orderPolicy = nested(policy, "orders");
  const allowedOrderTypes = stringSet(
    policy.allowed_order_types ?? orderPolicy.allowed_order_types,
    ["limit"],
  );
  const orderType = stringValue(intent.order_type, "limit");
  if (!allowedOrderTypes.has(orderType))
    reasons.push(`order_type ${JSON.stringify(orderType)} not allowed`);
  if (
    orderType === "market" &&
    !policyBool(
      policy,
      "allow_market_orders",
      "orders",
      "allow_market_orders",
      false,
    )
  ) {
    reasons.push("market orders are disabled by policy");
  }
  if (
    (booleanValue(intent.leverage) ||
      numberValue(intent.leverage_multiplier, 1) > 1) &&
    !policyBool(policy, "allow_leverage", "exchange", "allow_leverage", false)
  ) {
    reasons.push("leverage requested but policy forbids leverage");
  }
  if (reasons.length > 0) {
    return {
      approved: false,
      metrics: {},
      reasons,
      required_actions_before_resubmission:
        actions.length > 0 ? actions : ["correct invalid order intent"],
    };
  }

  let perUnitLoss = 0;
  if (side === "buy") {
    if (stop >= entry)
      reasons.push("buy invalidation price must be below entry");
    perUnitLoss = entry - stop;
  } else {
    if (stop <= entry)
      reasons.push("sell invalidation price must be above entry");
    perUnitLoss = stop - entry;
  }

  const estimatedCosts = (qty * entry * (feeBps + slippageBps)) / 10000;
  const lossAtInvalidation = qty * perUnitLoss + estimatedCosts;
  const riskFraction = lossAtInvalidation / equity;
  const notional = qty * entry;
  const positionNotionalFraction = notional / equity;

  const maxRisk = policyNumber(
    policy,
    "max_risk_per_trade_fraction",
    "max_risk_per_trade_fraction",
    0.0025,
  );
  const maxNotionalFraction = policyNumber(
    policy,
    "max_position_notional_fraction",
    "max_position_notional_fraction",
    0.02,
  );
  const maxDailyLossFraction = policyNumber(
    policy,
    "max_daily_loss_fraction",
    "max_daily_loss_fraction",
    0.01,
  );
  const maxWeeklyLossFraction = policyNumber(
    policy,
    "max_weekly_loss_fraction",
    "max_weekly_loss_fraction",
    0.03,
  );

  if (riskFraction > maxRisk) {
    reasons.push(
      `risk_fraction ${riskFraction.toFixed(8)} exceeds max ${maxRisk}`,
    );
    actions.push("reduce quantity or use a tighter valid invalidation price");
  }
  if (positionNotionalFraction > maxNotionalFraction) {
    reasons.push(
      `position_notional_fraction ${positionNotionalFraction.toFixed(8)} exceeds max ${maxNotionalFraction}`,
    );
    actions.push("reduce quantity");
  }

  const dailyPnl = numberValue(account.daily_realized_pnl);
  const weeklyPnl = numberValue(account.weekly_realized_pnl);
  if (dailyPnl <= -(equity * maxDailyLossFraction)) {
    reasons.push("daily loss limit already breached");
    actions.push("halt trading for the day");
  }
  if (weeklyPnl <= -(equity * maxWeeklyLossFraction)) {
    reasons.push("weekly loss limit already breached");
    actions.push("halt trading for the week");
  }
  if (dailyPnl - lossAtInvalidation <= -(equity * maxDailyLossFraction)) {
    reasons.push("trade could breach daily loss limit at invalidation");
    actions.push("reduce risk or wait for next session");
  }

  const maxOpenOrders = Math.floor(
    numberValue(
      policy.max_open_orders ?? record(policy.account).max_open_orders,
      3,
    ),
  );
  if (
    Array.isArray(account.open_orders) &&
    account.open_orders.length >= maxOpenOrders
  ) {
    reasons.push("max open orders already reached");
    actions.push("cancel stale orders before resubmission");
  }

  return {
    approved: reasons.length === 0,
    metrics: {
      daily_realized_pnl: dailyPnl,
      entry_price: entry,
      equity,
      estimated_costs: estimatedCosts,
      invalidation_price: stop,
      loss_at_invalidation: lossAtInvalidation,
      max_position_notional_fraction: maxNotionalFraction,
      max_risk_fraction: maxRisk,
      notional,
      position_notional_fraction: positionNotionalFraction,
      quantity: qty,
      risk_fraction: riskFraction,
      weekly_realized_pnl: weeklyPnl,
    },
    reasons,
    required_actions_before_resubmission: actions,
  };
}

function normalizeLevels(
  value: unknown,
  reverse: boolean,
): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  const levels: Array<[number, number]> = [];
  for (const level of value.slice(0, 200)) {
    const item = record(level);
    const tuple = Array.isArray(level) ? level : [];
    const price = numberValue(item.price ?? item.limit_price ?? tuple[0]);
    const quantity = numberValue(
      item.qty ?? item.quantity ?? item.order_qty ?? tuple[1],
    );
    if (price > 0 && quantity > 0) levels.push([price, quantity]);
  }
  return levels.sort((left, right) =>
    reverse ? right[0] - left[0] : left[0] - right[0],
  );
}

function estimateVwap(
  side: string,
  quantity: number,
  bids: Array<[number, number]>,
  asks: Array<[number, number]>,
): [number | null, number] {
  const bookSide = side === "buy" ? asks : bids;
  let remaining = quantity;
  let notional = 0;
  let filled = 0;
  for (const [price, qty] of bookSide) {
    const take = Math.min(remaining, qty);
    notional += take * price;
    filled += take;
    remaining -= take;
    if (remaining <= 0) break;
  }
  if (filled <= 0 || remaining > 0) return [null, filled];
  return [notional / filled, filled];
}

export function liquidityCheck(
  input: unknown,
): ToolResult & { liquidity_ok: boolean } {
  const payload = record(input);
  const side = stringValue(payload.side);
  if (side !== "buy" && side !== "sell") {
    return {
      liquidity_ok: false,
      metrics: {},
      reasons: ["side must be buy or sell"],
    };
  }
  const quantity = numberValue(payload.quantity);
  if (quantity <= 0) {
    return {
      liquidity_ok: false,
      metrics: {},
      reasons: ["quantity must be > 0"],
    };
  }
  const book = record(payload.book);
  const bids = normalizeLevels(book.bids, true);
  const asks = normalizeLevels(book.asks, false);
  if (bids.length === 0 || asks.length === 0) {
    return {
      liquidity_ok: false,
      metrics: {},
      reasons: ["book must include non-empty bids and asks"],
    };
  }

  const reasons: string[] = [];
  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];
  if (bestBid >= bestAsk)
    reasons.push("crossed_or_locked_book: best_bid >= best_ask");
  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = ((bestAsk - bestBid) / mid) * 10000;
  const policy = record(payload.policy);
  const maxSpreadBps = numberValue(policy.max_spread_bps, 10);
  const maxSlippageBps = numberValue(policy.max_slippage_bps, 10);
  const minDepthRatio = numberValue(
    policy.min_depth_to_order_notional_ratio,
    10,
  );

  if (spreadBps > maxSpreadBps)
    reasons.push(
      `spread_bps ${spreadBps.toFixed(6)} exceeds max ${maxSpreadBps}`,
    );
  const [vwap, filled] = estimateVwap(side, quantity, bids, asks);
  let estimatedSlippageBps: number | null = null;
  if (vwap === null) {
    reasons.push(
      `insufficient opposing depth to fill quantity; fillable=${filled}`,
    );
  } else {
    const reference = side === "buy" ? bestAsk : bestBid;
    estimatedSlippageBps = Math.abs((vwap - reference) / reference) * 10000;
    if (estimatedSlippageBps > maxSlippageBps) {
      reasons.push(
        `estimated_slippage_bps ${estimatedSlippageBps.toFixed(6)} exceeds max ${maxSlippageBps}`,
      );
    }
  }

  const orderNotional = quantity * (side === "buy" ? bestAsk : bestBid);
  const depthNotional = (side === "buy" ? asks : bids).reduce(
    (sum, [price, qty]) => sum + price * qty,
    0,
  );
  const requiredDepth = orderNotional * minDepthRatio;
  if (depthNotional < requiredDepth) {
    reasons.push(
      `depth_notional ${depthNotional.toFixed(8)} below required ${requiredDepth.toFixed(8)}`,
    );
  }

  return {
    liquidity_ok: reasons.length === 0,
    metrics: {
      best_ask: bestAsk,
      best_bid: bestBid,
      depth_notional: depthNotional,
      estimated_slippage_bps: estimatedSlippageBps,
      estimated_vwap: vwap,
      mid,
      order_notional: orderNotional,
      required_depth_notional: requiredDepth,
      spread_bps: spreadBps,
    },
    reasons,
  };
}

export function feeEdgeCheck(
  input: unknown,
): ToolResult & { edge_ok: boolean } {
  const payload = record(input);
  const policy = record(payload.policy);
  const expectedEdgeBps = numberValue(payload.expected_edge_bps);
  const multiple = numberValue(
    payload.minimum_expected_edge_multiple_of_total_cost ??
      policy.minimum_expected_edge_multiple_of_total_cost,
    2,
  );
  const components = record(payload.cost_components_bps);
  let roundTripCostBps = Object.values(components).reduce(
    (sum, value) => sum + numberValue(value),
    0,
  );
  if (Object.keys(components).length === 0) {
    roundTripCostBps =
      numberValue(payload.entry_fee_bps) +
      numberValue(payload.exit_fee_bps) +
      numberValue(payload.entry_spread_cost_bps) +
      numberValue(payload.exit_spread_cost_bps) +
      numberValue(payload.entry_slippage_bps) +
      numberValue(payload.exit_slippage_bps) +
      numberValue(payload.latency_buffer_bps);
  }

  const reasons: string[] = [];
  const requiredEdgeBps = roundTripCostBps * multiple;
  if (expectedEdgeBps <= 0)
    reasons.push("expected_edge_bps must be provided and > 0");
  if (roundTripCostBps <= 0)
    reasons.push("round_trip_cost_bps must be estimated and > 0");
  if (expectedEdgeBps < requiredEdgeBps) {
    reasons.push(
      `expected_edge_bps ${expectedEdgeBps} below required_edge_bps ${requiredEdgeBps}`,
    );
  }

  return {
    edge_ok: reasons.length === 0,
    metrics: {
      expected_edge_bps: expectedEdgeBps,
      minimum_multiple: multiple,
      required_edge_bps: requiredEdgeBps,
      round_trip_cost_bps: roundTripCostBps,
    },
    reasons,
  };
}
