export type TradingMode = "paper" | "live";
export type IntentionStatus =
  | "staged"
  | "rejected"
  | "approval_requested"
  | "approved"
  | "executed"
  | "expired"
  | "cancelled";

export type TradingPolicy = {
  id: string;
  enabled: boolean;
  mode: TradingMode;
  allowedSymbols: string[];
  maxOpenOrders: number;
  maxOpenPositions: number;
  maxDailyLossFraction: number;
  maxWeeklyLossFraction: number;
  maxRiskPerTradeFraction: number;
  maxMarketDataAgeMs: number;
  maxOrderAgeSeconds: number;
  execution: {
    allowMarketOrders: boolean;
    allowLeverage: boolean;
    allowMargin: boolean;
    allowWithdrawals: boolean;
    postOnlyByDefault: boolean;
  };
  live: { requiresHumanApproval: boolean };
};

export type TradingRuntime = {
  adapterHealthy: boolean;
  apiErrorCount: number;
  exchangeStatus: ExchangeStatus;
  lastCronAt: string | null;
  lastJournalAt: string | null;
  lastPrivateStreamAt: string | null;
  openOrders: Array<{ clientOrderId: string; symbol?: string; side?: string }>;
  paperOrders: Array<Record<string, unknown>>;
  dailyRealizedPnl: number;
  weeklyRealizedPnl: number;
};

export type ExchangeStatus =
  | "online"
  | "post_only"
  | "cancel_only"
  | "maintenance"
  | "unknown";

export type TradeIntention = {
  id: string;
  mode: TradingMode;
  status: IntentionStatus;
  symbol: string;
  side: "buy" | "sell";
  order_type: "limit";
  limit_price: number;
  quantity: number;
  invalidation_price: number;
  reason: string;
  strategy_id: string;
  policy_id: string;
  created_at: string;
  expires_at: string;
  requires_human_approval: boolean;
  human_approval_id: string | null;
  max_slippage_bps: number;
  max_spread_bps: number;
  risk_fraction: number;
};

export type HumanApproval = {
  id: string;
  intention_id: string;
  expires_at: string;
  used_at: string | null;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  limit_price: number;
  limit_price_tolerance_bps: number;
  policy_id: string;
  strategy_id: string;
  risk_amount: number;
};

export type KillSwitch = {
  latched: boolean;
  reason: string | null;
  latched_at: string | null;
  panic: boolean;
};

export type RuntimeSnapshot = {
  adapter_healthy: boolean;
  exchange_status: ExchangeStatus;
  market_data: Record<
    string,
    {
      symbol: string;
      best_bid: number;
      best_ask: number;
      mid: number;
      spread_bps: number;
      last_update_at: string;
    }
  >;
  account: {
    equity: number | null;
    daily_realized_pnl: number;
    weekly_realized_pnl: number;
    open_orders: Array<{
      clientOrderId: string;
      symbol?: string;
      side?: string;
    }>;
    open_positions: Array<{ symbol: string; quantity: number }>;
  };
  local_open_orders: Array<{
    clientOrderId: string;
    symbol?: string;
    side?: string;
  }>;
  permission_anomaly: boolean;
  api_error_count: number;
};

export type JournalType =
  | "NO_ACTION"
  | "INTENTION_STAGED"
  | "INTENTION_REJECTED"
  | "APPROVAL_REQUESTED"
  | "PAPER_ORDER"
  | "LIVE_ORDER"
  | "CANCEL"
  | "RECONCILE_REQUIRED"
  | "HALT"
  | "KILL_SWITCH"
  | "ERROR";

export type JournalEntry = {
  id: string;
  timestamp: string;
  type: JournalType;
  policy_id: string;
  strategy_id: string | null;
  intention_id: string | null;
  symbol: string | null;
  summary: string;
  safe_details: Record<string, unknown>;
};

export const DEFAULT_POLICY: TradingPolicy = {
  id: "conservative_spot_only_v1",
  enabled: true,
  mode: "paper",
  allowedSymbols: ["BTC/USD", "ETH/USD"],
  maxOpenOrders: 1,
  maxOpenPositions: 1,
  maxDailyLossFraction: 0.01,
  maxWeeklyLossFraction: 0.03,
  maxRiskPerTradeFraction: 0.0025,
  maxMarketDataAgeMs: 10000,
  maxOrderAgeSeconds: 180,
  execution: {
    allowMarketOrders: false,
    allowLeverage: false,
    allowMargin: false,
    allowWithdrawals: false,
    postOnlyByDefault: true,
  },
  live: { requiresHumanApproval: true },
};

export const DEFAULT_RUNTIME: TradingRuntime = {
  adapterHealthy: true,
  apiErrorCount: 0,
  exchangeStatus: "unknown",
  lastCronAt: null,
  lastJournalAt: null,
  lastPrivateStreamAt: null,
  openOrders: [],
  paperOrders: [],
  dailyRealizedPnl: 0,
  weeklyRealizedPnl: 0,
};

export const DEFAULT_KILL_SWITCH: KillSwitch = {
  latched: false,
  latched_at: null,
  panic: false,
  reason: null,
};
