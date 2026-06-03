import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildPluginEntrypoint } from "./entrypoint-build";
import {
  base64ToBytes,
  bytesToBase64,
  hmacSha512,
  sha256,
} from "../../../core_plugins/kraken/crypto";
import type { TradingAdapter } from "../../../core_plugins/kraken/kraken-adapter";
import {
  runMinuteCron,
  stageIntention,
} from "../../../core_plugins/kraken/trading-ops";
import {
  DEFAULT_KILL_SWITCH,
  DEFAULT_POLICY,
  DEFAULT_RUNTIME,
  type HumanApproval,
  type JournalEntry,
  type KillSwitch,
  type RuntimeSnapshot,
  type TradeIntention,
  type TradingPolicy,
  type TradingRuntime,
} from "../../../core_plugins/kraken/trading-types";

const KRAKEN_PLUGIN_ROOT = join("core_plugins", "kraken");

function freshSnapshot(
  overrides: Partial<RuntimeSnapshot> = {},
): RuntimeSnapshot {
  const market = {
    best_ask: 65005,
    best_bid: 64995,
    last_update_at: new Date().toISOString(),
    mid: 65000,
    spread_bps: 1.538,
    symbol: "BTC/USD",
  };
  return {
    account: {
      daily_realized_pnl: 0,
      equity: 10000,
      open_orders: [],
      open_positions: [],
      weekly_realized_pnl: 0,
    },
    adapter_healthy: true,
    api_error_count: 0,
    exchange_status: "online",
    local_open_orders: [],
    market_data: {
      "BTC/USD": market,
      "ETH/USD": { ...market, symbol: "ETH/USD" },
    },
    permission_anomaly: false,
    ...overrides,
  };
}

function validIntention(extra: Partial<TradeIntention> = {}): TradeIntention {
  return {
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    human_approval_id: null,
    id: `intent-${Math.random().toString(36).slice(2)}`,
    invalidation_price: 64800,
    limit_price: 65000,
    max_slippage_bps: 10,
    max_spread_bps: 15,
    mode: "paper",
    order_type: "limit",
    policy_id: DEFAULT_POLICY.id,
    quantity: 0.001,
    reason: "test",
    requires_human_approval: false,
    risk_fraction: 0.001,
    side: "buy",
    status: "staged",
    strategy_id: "test_strategy",
    symbol: "BTC/USD",
    ...extra,
  };
}

class MemoryStorage {
  policy: TradingPolicy = structuredClone(DEFAULT_POLICY);
  runtime: TradingRuntime = structuredClone(DEFAULT_RUNTIME);
  killSwitch: KillSwitch = structuredClone(DEFAULT_KILL_SWITCH);
  intentions = new Map<string, TradeIntention>();
  approvals = new Map<string, HumanApproval>();
  journal: JournalEntry[] = [];
  incidents: Record<string, unknown>[] = [];
  locked = false;
  async initialize() {}
  async readPolicy() {
    return this.policy;
  }
  async writePolicy(policy: TradingPolicy) {
    this.policy = policy;
  }
  async readRuntime() {
    return this.runtime;
  }
  async writeRuntime(runtime: TradingRuntime) {
    this.runtime = runtime;
  }
  async readKillSwitch() {
    return this.killSwitch;
  }
  async writeKillSwitch(killSwitch: KillSwitch) {
    this.killSwitch = killSwitch;
  }
  async latchKillSwitch(reason: string) {
    this.killSwitch = {
      latched: true,
      latched_at: new Date().toISOString(),
      panic: this.killSwitch.panic,
      reason,
    };
    return this.killSwitch;
  }
  async saveIntention(intention: TradeIntention) {
    this.intentions.set(intention.id, intention);
  }
  async readIntention(id: string) {
    return this.intentions.get(id) ?? null;
  }
  async listIntentions() {
    return [...this.intentions.values()];
  }
  async saveApproval(approval: HumanApproval) {
    this.approvals.set(approval.id, approval);
  }
  async readApproval(id: string | null) {
    return id ? (this.approvals.get(id) ?? null) : null;
  }
  async appendJournal(entry: JournalEntry) {
    this.journal.push(entry);
    this.runtime.lastJournalAt = entry.timestamp;
  }
  async appendIncident(incident: Record<string, unknown>) {
    this.incidents.push(incident);
  }
  async journalSummary() {
    return { entries: this.journal, totalFiles: 1 };
  }
  async acquireLock() {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }
  async releaseLock() {
    this.locked = false;
  }
}

function adapter(
  snapshot: RuntimeSnapshot,
  hooks: Partial<TradingAdapter> = {},
): TradingAdapter {
  return {
    async cancelAllOrders() {},
    async cancelOrder() {},
    async getAccountSnapshot() {
      return snapshot.account;
    },
    async getExchangeStatus() {
      return snapshot.exchange_status;
    },
    async getMarketSnapshot(symbol: string) {
      const market = snapshot.market_data[symbol];
      if (!market) throw new Error(`missing market snapshot for ${symbol}`);
      return market;
    },
    async getRuntimeSnapshot() {
      return snapshot;
    },
    async notifyHuman() {},
    async placeLimitOrder(intent: TradeIntention) {
      return { clientOrderId: `live-${intent.id}` };
    },
    async reconcileOpenOrders() {
      return { reasons: [], required: false };
    },
    async refreshCancelOnDisconnect() {},
    ...hooks,
  };
}

describe("Kraken core plugin", () => {
  it("builds the plugin entrypoint", async () => {
    await expect(
      buildPluginEntrypoint({ pluginRoot: KRAKEN_PLUGIN_ROOT }),
    ).resolves.toMatchObject({ source: expect.any(String) });
  });

  it("LLM cannot directly place orders or call raw Kraken request tools", async () => {
    const manifest = await import(
      "../../../core_plugins/kraken/metidos-plugin.json"
    );
    const toolNames = manifest.default.access.flatMap(
      (group: { tools: Array<{ name: string }> }) =>
        group.tools.map((tool) => tool.name),
    );
    for (const forbidden of [
      "kraken_request",
      "trade_action",
      "funding_action",
      "place_order",
      "cancel_all_orders",
      "withdraw",
      "signed_request",
      "raw_kraken_request",
    ]) {
      expect(toolNames).not.toContain(forbidden);
    }
    expect(toolNames).toEqual([
      "get_status",
      "get_runtime_snapshot",
      "stage_intention",
      "list_intentions",
      "cancel_intention",
      "get_policy",
      "get_journal_summary",
    ]);
    expect(manifest.default.permissions).toContain("network:websocket");
    expect(manifest.default.network.webSocketAllow).toContain(
      "wss://ws.kraken.com/v2",
    );
  });

  it("matches Kraken's documented API-Sign example", () => {
    const privateKey =
      "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==";
    const nonce = "1616492376594";
    const path = "/0/private/AddOrder";
    const postData =
      "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25";
    const message = Array.from(path)
      .map((character) => character.charCodeAt(0))
      .concat(sha256(`${nonce}${postData}`));
    expect(bytesToBase64(hmacSha512(base64ToBytes(privateKey), message))).toBe(
      "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==",
    );
  });

  it("stageIntention stores but does not execute", async () => {
    const storage = new MemoryStorage();
    const result = await stageIntention(storage as never, validIntention());
    expect(result).toMatchObject({ ok: true });
    expect(storage.intentions.size).toBe(1);
    expect(
      storage.journal.some((entry) => entry.type === "INTENTION_STAGED"),
    ).toBe(true);
  });

  it("expired intention and market order are rejected during staging", async () => {
    const storage = new MemoryStorage();
    expect(
      await stageIntention(
        storage as never,
        validIntention({
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      ),
    ).toMatchObject({ ok: false, status: "rejected" });
    expect(
      await stageIntention(storage as never, {
        ...validIntention(),
        id: "market",
        order_type: "market",
      }),
    ).toMatchObject({ ok: false, status: "rejected" });
  });

  it("policy mismatch is rejected by cron", async () => {
    const storage = new MemoryStorage();
    await storage.saveIntention(validIntention({ policy_id: "other" }));
    const result = await runMinuteCron(
      storage as never,
      adapter(freshSnapshot()),
    );
    expect(result).toMatchObject({ status: "rejected" });
    expect(
      storage.journal.some((entry) => entry.type === "INTENTION_REJECTED"),
    ).toBe(true);
  });

  it("stale market data halts trading", async () => {
    const storage = new MemoryStorage();
    await storage.saveIntention(validIntention());
    const stale = freshSnapshot({
      market_data: {
        "BTC/USD": {
          ...freshSnapshot().market_data["BTC/USD"]!,
          last_update_at: new Date(0).toISOString(),
        },
        "ETH/USD": { ...freshSnapshot().market_data["ETH/USD"]! },
      },
    });
    const result = await runMinuteCron(storage as never, adapter(stale));
    expect(result).toMatchObject({ status: "unsafe" });
    expect(storage.journal.some((entry) => entry.type === "HALT")).toBe(true);
  });

  it("daily loss limit and unknown exchange order trigger kill switch", async () => {
    const storage = new MemoryStorage();
    await runMinuteCron(
      storage as never,
      adapter(
        freshSnapshot({
          account: { ...freshSnapshot().account, daily_realized_pnl: -200 },
        }),
      ),
    );
    expect(storage.killSwitch.latched).toBe(true);
    const storage2 = new MemoryStorage();
    await runMinuteCron(
      storage2 as never,
      adapter(
        freshSnapshot({
          account: {
            ...freshSnapshot().account,
            open_orders: [{ clientOrderId: "unknown" }],
          },
        }),
      ),
    );
    expect(storage2.killSwitch.latched).toBe(true);
  });

  it("missing approval prevents live order and requests approval", async () => {
    const storage = new MemoryStorage();
    storage.policy = { ...storage.policy, mode: "live" };
    await storage.saveIntention(
      validIntention({ mode: "live", requires_human_approval: true }),
    );
    let placed = 0;
    const result = await runMinuteCron(
      storage as never,
      adapter(freshSnapshot(), {
        async placeLimitOrder() {
          placed++;
          return { clientOrderId: "bad" };
        },
      }),
    );
    expect(result).toMatchObject({ status: "approval_requested" });
    expect(placed).toBe(0);
  });

  it("valid paper intention becomes simulated paper order and notifies", async () => {
    const storage = new MemoryStorage();
    const intent = validIntention();
    await storage.saveIntention(intent);
    let notifications = 0;
    const result = await runMinuteCron(
      storage as never,
      adapter(freshSnapshot(), {
        async notifyHuman() {
          notifications++;
        },
      }),
    );
    expect(result).toMatchObject({ status: "paper_order" });
    expect((await storage.readIntention(intent.id))?.status).toBe("executed");
    expect(notifications).toBe(1);
  });

  it("valid live approved intention calls placeLimitOrder once", async () => {
    const storage = new MemoryStorage();
    storage.policy = { ...storage.policy, mode: "live" };
    const snapshot = freshSnapshot();
    const intent = validIntention({
      human_approval_id: "approval-1",
      mode: "live",
      requires_human_approval: true,
      status: "approved",
    });
    await storage.saveIntention(intent);
    await storage.saveApproval({
      expires_at: new Date(Date.now() + 60000).toISOString(),
      id: "approval-1",
      intention_id: intent.id,
      limit_price: intent.limit_price,
      limit_price_tolerance_bps: 100,
      policy_id: intent.policy_id,
      quantity: intent.quantity,
      risk_amount: 0.2,
      side: intent.side,
      strategy_id: intent.strategy_id,
      symbol: intent.symbol,
      used_at: null,
    });
    let placed = 0;
    let notifications = 0;
    const result = await runMinuteCron(
      storage as never,
      adapter(snapshot, {
        async notifyHuman() {
          notifications++;
        },
        async placeLimitOrder(orderIntent) {
          placed++;
          return { clientOrderId: `live-${orderIntent.id}` };
        },
      }),
    );
    expect(result).toMatchObject({ status: "live_order" });
    expect(placed).toBe(1);
    expect(notifications).toBe(1);
  });

  it("overlapping cron runs do not double-execute", async () => {
    const storage = new MemoryStorage();
    storage.locked = true;
    await storage.saveIntention(validIntention());
    expect(
      await runMinuteCron(storage as never, adapter(freshSnapshot())),
    ).toMatchObject({ status: "locked" });
  });

  it("thrown exception during live execution latches kill switch and attempts cancelAllOrders", async () => {
    const storage = new MemoryStorage();
    storage.policy = { ...storage.policy, mode: "live" };
    const intent = validIntention({
      human_approval_id: "approval-1",
      mode: "live",
      requires_human_approval: true,
      status: "approved",
    });
    await storage.saveIntention(intent);
    await storage.saveApproval({
      expires_at: new Date(Date.now() + 60000).toISOString(),
      id: "approval-1",
      intention_id: intent.id,
      limit_price: intent.limit_price,
      limit_price_tolerance_bps: 100,
      policy_id: intent.policy_id,
      quantity: intent.quantity,
      risk_amount: 0.2,
      side: intent.side,
      strategy_id: intent.strategy_id,
      symbol: intent.symbol,
      used_at: null,
    });
    let cancelled = 0;
    await runMinuteCron(
      storage as never,
      adapter(freshSnapshot(), {
        async cancelAllOrders() {
          cancelled++;
        },
        async placeLimitOrder() {
          throw new Error("boom");
        },
      }),
    );
    expect(storage.killSwitch.latched).toBe(true);
    expect(cancelled).toBe(1);
    expect(storage.journal.some((entry) => entry.type === "KILL_SWITCH")).toBe(
      true,
    );
  });
});
