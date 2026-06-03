import type { MetidosPluginApi } from "@metidos/plugin-api";
import { base64ToBytes, bytesToBase64, hmacSha512, sha256 } from "./crypto";
import type {
  RuntimeSnapshot,
  TradeIntention,
  TradingRuntime,
} from "./trading-types";

const BASE_URL = "https://api.kraken.com";
const PUBLIC_WS_URL = "wss://ws.kraken.com/v2";

type Scalar = string | number | boolean;

function encode(value: Scalar): string {
  return encodeURIComponent(String(value)).replace(/%20/g, "+");
}

function formEncode(params: Record<string, Scalar | Scalar[]>): string {
  const pairs: string[] = [];
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) pairs.push(`${encode(key)}=${encode(entry)}`);
  }
  return pairs.join("&");
}

function nonce(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
}

function signedHeaders(
  path: string,
  postData: string,
  nonceValue: string,
  apiKey: string,
  privateKey: string,
): Record<string, string> {
  const secret = base64ToBytes(privateKey);
  const message = Array.from(path)
    .map((char) => char.charCodeAt(0))
    .concat(sha256(`${nonceValue}${postData}`));
  return {
    "API-Key": apiKey,
    "API-Sign": bytesToBase64(hmacSha512(secret, message)),
  };
}

export async function krakenPrivateRequest(
  metidos: MetidosPluginApi,
  path: string,
  params: Record<string, Scalar | Scalar[]> = {},
): Promise<unknown> {
  const apiKey = metidos.env.get("KRAKEN_API_KEY");
  const privateKey = metidos.env.get("KRAKEN_PRIVATE_KEY");
  if (!apiKey || !privateKey)
    throw new Error("Kraken API credentials are not configured.");
  const bodyParams = { ...params, nonce: nonce() };
  const body = formEncode(bodyParams);
  const response = await metidos.fetch(`${BASE_URL}${path}`, {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      ...signedHeaders(
        path,
        body,
        String(bodyParams.nonce),
        apiKey,
        privateKey,
      ),
    },
    method: "POST",
  });
  return response.json();
}

export type TradingAdapter = {
  getRuntimeSnapshot(): Promise<RuntimeSnapshot>;
  getExchangeStatus(): Promise<RuntimeSnapshot["exchange_status"]>;
  getAccountSnapshot(): Promise<RuntimeSnapshot["account"]>;
  getMarketSnapshot(
    symbol: string,
  ): Promise<RuntimeSnapshot["market_data"][string]>;
  placeLimitOrder(
    orderIntent: TradeIntention,
  ): Promise<{ clientOrderId: string; raw?: unknown }>;
  cancelOrder(clientOrderId: string): Promise<void>;
  cancelAllOrders(): Promise<void>;
  refreshCancelOnDisconnect(): Promise<void>;
  reconcileOpenOrders(): Promise<{ required: boolean; reasons: string[] }>;
  notifyHuman(message: string): Promise<void>;
};

function emptyMarket(symbol: string): RuntimeSnapshot["market_data"][string] {
  const now = new Date().toISOString();
  return {
    best_ask: 0,
    best_bid: 0,
    last_update_at: now,
    mid: 0,
    spread_bps: 0,
    symbol,
  };
}

function marketFromBidAsk(
  symbol: string,
  bestBid: number,
  bestAsk: number,
): RuntimeSnapshot["market_data"][string] | null {
  if (bestAsk <= 0 || bestBid <= 0) return null;
  const mid = (bestAsk + bestBid) / 2;
  return {
    best_ask: bestAsk,
    best_bid: bestBid,
    last_update_at: new Date().toISOString(),
    mid,
    spread_bps: ((bestAsk - bestBid) / mid) * 10000,
    symbol,
  };
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function parseTickerMarket(
  symbol: string,
  message: unknown,
): RuntimeSnapshot["market_data"][string] | null {
  const record =
    message && typeof message === "object"
      ? (message as Record<string, unknown>)
      : {};
  if (record.channel !== "ticker" || !Array.isArray(record.data)) return null;
  for (const item of record.data) {
    const ticker =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    if (ticker.symbol !== symbol) continue;
    const bestBid = numberFromUnknown(ticker.bid);
    const bestAsk = numberFromUnknown(ticker.ask);
    return marketFromBidAsk(symbol, bestBid, bestAsk);
  }
  return null;
}

export function createKrakenAdapter(
  metidos: MetidosPluginApi,
  runtimeProvider: () => Promise<TradingRuntime>,
): TradingAdapter {
  async function getExchangeStatus(): Promise<
    RuntimeSnapshot["exchange_status"]
  > {
    try {
      const response = await metidos.fetch(
        `${BASE_URL}/0/public/SystemStatus`,
        { headers: { Accept: "application/json" }, method: "GET" },
      );
      const json = (await response.json()) as { result?: { status?: string } };
      const status = json.result?.status;
      if (
        status === "online" ||
        status === "post_only" ||
        status === "cancel_only" ||
        status === "maintenance"
      )
        return status;
      return "unknown";
    } catch {
      return "unknown";
    }
  }

  async function getMarketSnapshotViaWebSocket(
    symbol: string,
  ): Promise<RuntimeSnapshot["market_data"][string] | null> {
    const socket = await metidos.websocket.connect(PUBLIC_WS_URL);
    try {
      await socket.sendText(
        JSON.stringify({
          method: "subscribe",
          params: { channel: "ticker", symbol: [symbol] },
        }),
      );
      for (let attempt = 0; attempt < 6; attempt++) {
        const event = await socket.receive({ timeoutMs: 5_000 });
        if (event.type !== "message") continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.text);
        } catch {
          continue;
        }
        const market = parseTickerMarket(symbol, parsed);
        if (market) return market;
      }
      return null;
    } finally {
      await socket.close(1000, "snapshot complete");
    }
  }

  async function getMarketSnapshotViaRest(
    symbol: string,
  ): Promise<RuntimeSnapshot["market_data"][string]> {
    const pair = symbol.replace("/", "");
    try {
      const response = await metidos.fetch(
        `${BASE_URL}/0/public/Ticker?pair=${encodeURIComponent(pair)}`,
        { headers: { Accept: "application/json" }, method: "GET" },
      );
      const json = (await response.json()) as {
        result?: Record<string, { a?: string[]; b?: string[] }>;
      };
      const first = json.result ? Object.values(json.result)[0] : undefined;
      const market = marketFromBidAsk(
        symbol,
        Number(first?.b?.[0] ?? 0),
        Number(first?.a?.[0] ?? 0),
      );
      return market ?? emptyMarket(symbol);
    } catch {
      return {
        ...emptyMarket(symbol),
        last_update_at: new Date(0).toISOString(),
      };
    }
  }

  async function getMarketSnapshot(
    symbol: string,
  ): Promise<RuntimeSnapshot["market_data"][string]> {
    try {
      return (
        (await getMarketSnapshotViaWebSocket(symbol)) ??
        (await getMarketSnapshotViaRest(symbol))
      );
    } catch {
      return getMarketSnapshotViaRest(symbol);
    }
  }

  async function getAccountSnapshot(): Promise<RuntimeSnapshot["account"]> {
    const runtime = await runtimeProvider();
    let equity: number | null = null;
    try {
      const tradeBalance = (await krakenPrivateRequest(
        metidos,
        "/0/private/TradeBalance",
        {},
      )) as {
        error?: unknown[];
        result?: { eb?: string | number };
      };
      const parsed = Number(tradeBalance.result?.eb);
      equity = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      equity = null;
    }
    return {
      daily_realized_pnl: runtime.dailyRealizedPnl,
      equity,
      open_orders: runtime.openOrders,
      open_positions: [],
      weekly_realized_pnl: runtime.weeklyRealizedPnl,
    };
  }

  return {
    async cancelAllOrders() {
      await krakenPrivateRequest(metidos, "/0/private/CancelAll", {});
    },
    async cancelOrder(clientOrderId: string) {
      await krakenPrivateRequest(metidos, "/0/private/CancelOrder", {
        cl_ord_id: clientOrderId,
      });
    },
    getAccountSnapshot,
    getExchangeStatus,
    getMarketSnapshot,
    async getRuntimeSnapshot() {
      const runtime = await runtimeProvider();
      const exchange_status = await getExchangeStatus();
      const market_data: RuntimeSnapshot["market_data"] = {};
      for (const symbol of ["BTC/USD", "ETH/USD"])
        market_data[symbol] = await getMarketSnapshot(symbol);
      const account = await getAccountSnapshot();
      return {
        account,
        adapter_healthy: runtime.adapterHealthy,
        api_error_count: runtime.apiErrorCount,
        exchange_status,
        local_open_orders: runtime.openOrders,
        market_data,
        permission_anomaly: false,
      };
    },
    async notifyHuman(message: string) {
      try {
        await metidos.notifications.send({
          message: message.slice(0, 1000),
          tags: ["kraken", "trading"],
          title: "Kraken trading plugin",
        });
      } catch {}
    },
    async placeLimitOrder(orderIntent: TradeIntention) {
      const clientOrderId = `metidos-${orderIntent.id}`.slice(0, 60);
      const raw = await krakenPrivateRequest(metidos, "/0/private/AddOrder", {
        cl_ord_id: clientOrderId,
        ordertype: "limit",
        pair: orderIntent.symbol.replace("/", ""),
        post_only: true,
        price: orderIntent.limit_price,
        type: orderIntent.side,
        volume: orderIntent.quantity,
      });
      return { clientOrderId, raw };
    },
    async reconcileOpenOrders() {
      return { reasons: [], required: false };
    },
    async refreshCancelOnDisconnect() {
      await krakenPrivateRequest(metidos, "/0/private/CancelAllOrdersAfter", {
        timeout: 60,
      });
    },
  };
}
