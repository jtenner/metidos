import type { TradingAdapter } from "./kraken-adapter";
import { makeJournalEntry, TradingStorage } from "./trading-storage";
import {
  estimateRiskAmount,
  rejectExpiredIntentions,
  safeError,
  selectNextExecutableIntention,
  validateIntention,
  validateSystemSafety,
} from "./trading-safety";
import type {
  HumanApproval,
  TradeIntention,
  TradingPolicy,
} from "./trading-types";

const CRON_LOCK = "kraken-trading-minute-cron";

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asNumber(value: unknown, fallback = 0): number {
  const number =
    typeof value === "number" ? value : Number(String(value ?? ""));
  return Number.isFinite(number) ? number : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : fallback;
}

function normalizeIntention(
  input: unknown,
  policy: TradingPolicy,
): TradeIntention {
  const raw =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const createdAt = asString(raw.created_at, nowIso());
  const expiresAt = asString(
    raw.expires_at,
    new Date(Date.now() + policy.maxOrderAgeSeconds * 1000).toISOString(),
  );
  const mode = raw.mode === "live" ? "live" : "paper";
  return {
    created_at: createdAt,
    expires_at: expiresAt,
    human_approval_id:
      typeof raw.human_approval_id === "string" ? raw.human_approval_id : null,
    id: asString(raw.id, id("intent")),
    invalidation_price: asNumber(raw.invalidation_price),
    limit_price: asNumber(raw.limit_price),
    max_slippage_bps: asNumber(raw.max_slippage_bps, 10),
    max_spread_bps: asNumber(raw.max_spread_bps, 15),
    mode,
    order_type: "limit",
    policy_id: asString(raw.policy_id, policy.id),
    quantity: asNumber(raw.quantity),
    reason: asString(raw.reason),
    requires_human_approval:
      mode === "live" && policy.live.requiresHumanApproval,
    risk_fraction: asNumber(raw.risk_fraction, policy.maxRiskPerTradeFraction),
    side: raw.side === "sell" ? "sell" : "buy",
    status: "staged",
    strategy_id: asString(raw.strategy_id, "unspecified"),
    symbol: asString(raw.symbol),
  };
}

export async function stageIntention(
  storage: TradingStorage,
  input: unknown,
): Promise<Record<string, unknown>> {
  await storage.initialize();
  const policy = await storage.readPolicy();
  const intention = normalizeIntention(input, policy);
  const reasons: string[] = [];
  if (!intention.id) reasons.push("id is required");
  if (!policy.allowedSymbols.includes(intention.symbol))
    reasons.push("symbol must be in policy.allowedSymbols");
  if (intention.side !== "buy" && intention.side !== "sell")
    reasons.push("side must be buy or sell");
  if (intention.order_type !== "limit")
    reasons.push("order_type must be limit");
  if (
    asString((input as Record<string, unknown>)?.order_type, "limit") !==
    "limit"
  )
    reasons.push("market orders are never allowed");
  if (intention.limit_price <= 0) reasons.push("limit_price must be positive");
  if (intention.quantity <= 0) reasons.push("quantity must be positive");
  if (intention.invalidation_price <= 0)
    reasons.push("invalidation_price must be positive");
  if (!Number.isFinite(Date.parse(intention.created_at)))
    reasons.push("created_at must be a valid date");
  if (!Number.isFinite(Date.parse(intention.expires_at)))
    reasons.push("expires_at must be a valid date");
  if (Date.parse(intention.expires_at) <= Date.now())
    reasons.push("expires_at must be in the future when staged");
  if (intention.policy_id !== policy.id)
    reasons.push("policy_id must match active policy");
  if (intention.risk_fraction > policy.maxRiskPerTradeFraction)
    reasons.push("risk_fraction exceeds policy.maxRiskPerTradeFraction");
  if (
    (input as Record<string, unknown>)?.leverage ||
    (input as Record<string, unknown>)?.margin ||
    (input as Record<string, unknown>)?.futures ||
    (input as Record<string, unknown>)?.withdrawal
  ) {
    reasons.push(
      "leverage, margin, futures, and withdrawals are not supported",
    );
  }

  if (reasons.length > 0) {
    const rejected: TradeIntention = { ...intention, status: "rejected" };
    await storage.saveIntention(rejected);
    await storage.appendJournal(
      makeJournalEntry({
        intention_id: rejected.id,
        policy_id: policy.id,
        safe_details: { reasons },
        strategy_id: rejected.strategy_id,
        summary: "Trade intention rejected during staging.",
        symbol: rejected.symbol || null,
        type: "INTENTION_REJECTED",
      }),
    );
    return { ok: false, reasons, status: "rejected" };
  }

  await storage.saveIntention(intention);
  await storage.appendJournal(
    makeJournalEntry({
      intention_id: intention.id,
      policy_id: policy.id,
      safe_details: {
        mode: intention.mode,
        risk_fraction: intention.risk_fraction,
      },
      strategy_id: intention.strategy_id,
      summary:
        "Trade intention staged. Cron will evaluate it deterministically.",
      symbol: intention.symbol,
      type: "INTENTION_STAGED",
    }),
  );
  return {
    intention_id: intention.id,
    message:
      "Intention staged only; no order was placed. Minute cron will validate before any paper/live action.",
    ok: true,
    status: intention.requires_human_approval ? "approval_requested" : "staged",
  };
}

async function requestApproval(
  storage: TradingStorage,
  adapter: TradingAdapter,
  intention: TradeIntention,
  policy: TradingPolicy,
): Promise<void> {
  const approvalId = id("approval");
  const snapshot = await adapter.getRuntimeSnapshot();
  const approval: HumanApproval = {
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    id: approvalId,
    intention_id: intention.id,
    limit_price: intention.limit_price,
    limit_price_tolerance_bps: intention.max_slippage_bps,
    policy_id: policy.id,
    quantity: intention.quantity,
    risk_amount: estimateRiskAmount(intention, snapshot),
    side: intention.side,
    strategy_id: intention.strategy_id,
    symbol: intention.symbol,
    used_at: null,
  };
  await storage.saveApproval(approval);
  await storage.saveIntention({
    ...intention,
    human_approval_id: approvalId,
    status: "approval_requested",
  });
  await storage.appendJournal(
    makeJournalEntry({
      intention_id: intention.id,
      policy_id: policy.id,
      safe_details: {
        approval_id: approvalId,
        expires_at: approval.expires_at,
      },
      strategy_id: intention.strategy_id,
      summary: "Human approval requested for live intention. No order placed.",
      symbol: intention.symbol,
      type: "APPROVAL_REQUESTED",
    }),
  );
  await adapter.notifyHuman(
    `Kraken live approval requested for ${intention.symbol} ${intention.side} ${intention.quantity} @ ${intention.limit_price}. Approval id: ${approvalId}`,
  );
}

async function latchCritical(
  storage: TradingStorage,
  adapter: TradingAdapter,
  reason: string,
  liveEnabled: boolean,
): Promise<void> {
  await storage.latchKillSwitch(reason);
  let cancelAttempted = false;
  if (liveEnabled) {
    cancelAttempted = true;
    try {
      await adapter.cancelAllOrders();
    } catch {}
  }
  const incident = {
    cancelAttempted,
    id: id("incident"),
    reason,
    timestamp: nowIso(),
  };
  await storage.appendIncident(incident);
  await storage.appendJournal(
    makeJournalEntry({
      intention_id: null,
      policy_id: (await storage.readPolicy()).id,
      safe_details: incident,
      strategy_id: null,
      summary: `Kill switch latched: ${reason}`,
      symbol: null,
      type: "KILL_SWITCH",
    }),
  );
  await adapter.notifyHuman(`Kraken kill switch latched: ${reason}`);
}

export async function runMinuteCron(
  storage: TradingStorage,
  adapter: TradingAdapter,
): Promise<Record<string, unknown>> {
  await storage.initialize();
  if (!(await storage.acquireLock(CRON_LOCK, 90_000)))
    return { status: "locked" };
  try {
    const policy = await storage.readPolicy();
    let runtime = await storage.readRuntime();
    const killSwitch = await storage.readKillSwitch();
    runtime = { ...runtime, lastCronAt: nowIso() };
    await storage.writeRuntime(runtime);

    if (!policy.enabled) {
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: null,
          policy_id: policy.id,
          safe_details: {},
          strategy_id: null,
          summary: "Policy disabled; no action.",
          symbol: null,
          type: "NO_ACTION",
        }),
      );
      return { status: "disabled" };
    }
    if (killSwitch.latched || killSwitch.panic) {
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: null,
          policy_id: policy.id,
          safe_details: { reason: killSwitch.reason },
          strategy_id: null,
          summary: "Trading halted by kill switch.",
          symbol: null,
          type: "HALT",
        }),
      );
      return { status: "halted" };
    }

    const snapshot = await adapter.getRuntimeSnapshot();
    const system = validateSystemSafety({
      killSwitchLatched: false,
      policy,
      runtime,
      snapshot,
    });
    if (!system.ok) {
      if (system.critical)
        await latchCritical(
          storage,
          adapter,
          system.reasons.join("; "),
          policy.mode === "live",
        );
      else
        await storage.appendJournal(
          makeJournalEntry({
            intention_id: null,
            policy_id: policy.id,
            safe_details: { reasons: system.reasons },
            strategy_id: null,
            summary: "System safety rejected cron execution.",
            symbol: null,
            type: "HALT",
          }),
        );
      return { reasons: system.reasons, status: "unsafe" };
    }

    const reconcile = await adapter.reconcileOpenOrders();
    if (reconcile.required) {
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: null,
          policy_id: policy.id,
          safe_details: { reasons: reconcile.reasons },
          strategy_id: null,
          summary: "Reconciliation required before execution.",
          symbol: null,
          type: "RECONCILE_REQUIRED",
        }),
      );
      return { status: "reconcile_required" };
    }

    for (const expired of rejectExpiredIntentions(
      await storage.listIntentions(),
    )) {
      const old = await storage.readIntention(expired.id);
      if (old?.status !== expired.status) {
        await storage.saveIntention(expired);
        await storage.appendJournal(
          makeJournalEntry({
            intention_id: expired.id,
            policy_id: policy.id,
            safe_details: {},
            strategy_id: expired.strategy_id,
            summary: "Intention expired before execution.",
            symbol: expired.symbol,
            type: "INTENTION_REJECTED",
          }),
        );
      }
    }

    const intention = selectNextExecutableIntention(
      await storage.listIntentions(),
    );
    if (!intention) {
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: null,
          policy_id: policy.id,
          safe_details: {},
          strategy_id: null,
          summary: "No executable staged intention.",
          symbol: null,
          type: "NO_ACTION",
        }),
      );
      return { status: "no_action" };
    }

    const approval = await storage.readApproval(intention.human_approval_id);
    const validation = validateIntention(intention, {
      approval,
      policy,
      runtime,
      snapshot,
    });
    if (!validation.ok) {
      if (
        intention.mode === "live" &&
        validation.reasons.includes(
          "live mode requires approval and approval is missing",
        )
      ) {
        await requestApproval(storage, adapter, intention, policy);
        return { status: "approval_requested" };
      }
      const rejected: TradeIntention = { ...intention, status: "rejected" };
      await storage.saveIntention(rejected);
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: intention.id,
          policy_id: policy.id,
          safe_details: { reasons: validation.reasons },
          strategy_id: intention.strategy_id,
          summary: "Intention rejected by deterministic validation.",
          symbol: intention.symbol,
          type: "INTENTION_REJECTED",
        }),
      );
      return { reasons: validation.reasons, status: "rejected" };
    }

    if (intention.mode === "paper") {
      const clientOrderId = `paper-${intention.id}`;
      await storage.saveIntention({ ...intention, status: "executed" });
      await storage.writeRuntime({
        ...runtime,
        paperOrders: [
          ...runtime.paperOrders,
          { clientOrderId, intentionId: intention.id },
        ],
      });
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: intention.id,
          policy_id: policy.id,
          safe_details: { clientOrderId },
          strategy_id: intention.strategy_id,
          summary: "Paper order simulated.",
          symbol: intention.symbol,
          type: "PAPER_ORDER",
        }),
      );
      await adapter.notifyHuman(
        `Kraken paper order simulated: ${intention.symbol} ${intention.side} ${intention.quantity} @ ${intention.limit_price} (${clientOrderId}).`,
      );
      return { clientOrderId, status: "paper_order" };
    }

    try {
      const placed = await adapter.placeLimitOrder(intention);
      await storage.saveIntention({ ...intention, status: "executed" });
      await storage.writeRuntime({
        ...runtime,
        openOrders: [
          ...runtime.openOrders,
          {
            clientOrderId: placed.clientOrderId,
            side: intention.side,
            symbol: intention.symbol,
          },
        ],
      });
      await storage.appendJournal(
        makeJournalEntry({
          intention_id: intention.id,
          policy_id: policy.id,
          safe_details: { clientOrderId: placed.clientOrderId },
          strategy_id: intention.strategy_id,
          summary: "Live limit order placed through execution guard.",
          symbol: intention.symbol,
          type: "LIVE_ORDER",
        }),
      );
      await adapter.notifyHuman(
        `Kraken live limit order placed: ${intention.symbol} ${intention.side} ${intention.quantity} @ ${intention.limit_price} (${placed.clientOrderId}).`,
      );
      if (approval)
        await storage.saveApproval({ ...approval, used_at: nowIso() });
      return { clientOrderId: placed.clientOrderId, status: "live_order" };
    } catch (error) {
      await latchCritical(
        storage,
        adapter,
        `plugin exception during live order handling: ${safeError(error)}`,
        true,
      );
      return { status: "kill_switch", error: safeError(error) };
    }
  } catch (error) {
    await storage.appendJournal(
      makeJournalEntry({
        intention_id: null,
        policy_id: "unknown",
        safe_details: { error: safeError(error) },
        strategy_id: null,
        summary: "Cron exception.",
        symbol: null,
        type: "ERROR",
      }),
    );
    return { error: safeError(error), status: "error" };
  } finally {
    await storage.releaseLock(CRON_LOCK);
  }
}
