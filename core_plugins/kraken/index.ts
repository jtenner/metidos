import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";
import { createKrakenAdapter } from "./kraken-adapter";
import { stageIntention, runMinuteCron } from "./trading-ops";
import { makeJournalEntry, TradingStorage } from "./trading-storage";
import {
  createDefaultProjectPolicy,
  loadProjectPolicy,
  publicPolicyResult,
} from "./policy-loader";

function compactInput(input: unknown): unknown {
  return input && typeof input === "object" ? input : {};
}

function pluginEnabled(metidos: MetidosPluginApi): boolean {
  return metidos.settings.get("enabled") === true;
}

async function refreshProjectPolicy(
  storage: TradingStorage,
  metidos: MetidosPluginApi,
) {
  const loaded = await loadProjectPolicy(metidos);
  await storage.writePolicyState(loaded);
  return loaded;
}

function jsonResult(value: unknown): { type: "markdown"; markdown: string } {
  return {
    type: "markdown",
    markdown: ["```json", JSON.stringify(value, null, 2), "```"].join("\n"),
  };
}

function storageAndAdapter(metidos: MetidosPluginApi): {
  adapter: ReturnType<typeof createKrakenAdapter>;
  storage: TradingStorage;
} {
  const storage = new TradingStorage(metidos);
  const adapter = createKrakenAdapter(metidos, () => storage.readRuntime());
  return { adapter, storage };
}

async function getSafeStatus(
  metidos: MetidosPluginApi,
): Promise<Record<string, unknown>> {
  const { adapter, storage } = storageAndAdapter(metidos);
  await storage.initialize();
  const policyState = await refreshProjectPolicy(storage, metidos);
  const policy = policyState.policy;
  const [runtime, killSwitch, intentions, snapshot] = await Promise.all([
    storage.readRuntime(),
    storage.readKillSwitch(),
    storage.listIntentions(),
    adapter.getRuntimeSnapshot(),
  ]);
  const equity = snapshot.account.equity ?? 0;
  return {
    adapter_healthy: snapshot.adapter_healthy,
    daily_loss_fraction:
      equity > 0
        ? Math.max(0, -snapshot.account.daily_realized_pnl / equity)
        : 0,
    enabled: policyState.valid && policy.enabled && pluginEnabled(metidos),
    policy_enabled: policy.enabled,
    policy_valid: policyState.valid,
    policy_source: policyState.source,
    policy_path: policyState.path,
    policy_loaded_at: policyState.loaded_at,
    policy_validation_errors: policyState.validation_errors,
    policy_validation_warnings: policyState.validation_warnings,
    setting_enabled: pluginEnabled(metidos),
    exchange_status: snapshot.exchange_status,
    kill_switch_latched: killSwitch.latched,
    last_cron_at: runtime.lastCronAt,
    live_requires_human_approval: policy.live.requiresHumanApproval,
    max_autonomous_notional_usd: policy.live.maxAutonomousNotionalUsd,
    mode: policy.mode,
    open_intentions: intentions.filter((intent) =>
      ["staged", "approval_requested", "approved"].includes(intent.status),
    ).length,
    open_orders: snapshot.account.open_orders.length,
    open_positions: snapshot.account.open_positions.length,
  };
}

export default definePlugin((metidos) => {
  metidos.addAgentTool({
    tool: "get_status",
    name: "kraken.trading.getStatus",
    description:
      "Read compact Kraken trading operations status. Does not place, cancel, sign, or submit orders.",
    timeoutMs: 10_000,
    validateProps: compactInput,
    async action() {
      return jsonResult(await getSafeStatus(metidos));
    },
  });

  metidos.addAgentTool({
    tool: "get_runtime_snapshot",
    name: "kraken.trading.getRuntimeSnapshot",
    description:
      "Read a redacted runtime snapshot for Kraken trading operations. Secrets and raw private payloads are never returned.",
    timeoutMs: 10_000,
    validateProps: compactInput,
    async action() {
      const { adapter, storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const policyState = await storage.readPolicyState();
      const snapshot = await adapter.getRuntimeSnapshot();
      return jsonResult({
        account: snapshot.account,
        adapter_healthy: snapshot.adapter_healthy,
        api_error_count: snapshot.api_error_count,
        exchange_status: snapshot.exchange_status,
        local_open_orders: snapshot.local_open_orders,
        market_data: snapshot.market_data,
        permission_anomaly: snapshot.permission_anomaly,
        policy: {
          enabled: policyState.policy.enabled,
          loaded_at: policyState.loaded_at,
          path: policyState.path,
          source: policyState.source,
          valid: policyState.valid,
          validation_errors: policyState.validation_errors,
          validation_warnings: policyState.validation_warnings,
        },
      });
    },
  });

  metidos.addAgentTool({
    tool: "get_balances",
    name: "kraken.trading.getBalances",
    description:
      "Read normalized non-zero Kraken account balances. Read-only; never places, cancels, withdraws, transfers, or exposes raw private payloads.",
    timeoutMs: 10_000,
    validateProps: compactInput,
    async action() {
      const { adapter, storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const balances = await adapter.getBalances();
      return jsonResult({
        as_of: new Date().toISOString(),
        balance_count: balances.length,
        balances,
        ok: true,
      });
    },
  });

  metidos.addAgentTool({
    tool: "stage_intention",
    name: "kraken.trading.stageIntention",
    description:
      "Validate and store a trade intention for cron review. This tool never places orders, cancels orders, signs requests, or calls raw Kraken endpoints.",
    timeoutMs: 10_000,
    validateProps: compactInput,
    async action(_context, props) {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      await refreshProjectPolicy(storage, metidos);
      return jsonResult(await stageIntention(storage, props));
    },
  });

  metidos.addAgentTool({
    tool: "list_intentions",
    name: "kraken.trading.listIntentions",
    description:
      "List staged and historical trade intentions from plugin storage. Read-only.",
    timeoutMs: 10_000,
    validateProps(input) {
      const record = compactInput(input) as Record<string, unknown>;
      return {
        limit:
          typeof record.limit === "number"
            ? Math.max(1, Math.min(100, Math.floor(record.limit)))
            : 25,
      };
    },
    async action(_context, props) {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const intentions = (await storage.listIntentions()).slice(-props.limit);
      return jsonResult({ intentions });
    },
  });

  metidos.addAgentTool({
    tool: "cancel_intention",
    name: "kraken.trading.cancelIntention",
    description:
      "Cancel a staged local trade intention. This does not cancel exchange orders and cannot call Kraken trading endpoints.",
    timeoutMs: 10_000,
    validateProps(input) {
      const record = compactInput(input) as Record<string, unknown>;
      if (typeof record.id !== "string" || !record.id.trim())
        throw new Error("id is required");
      return { id: record.id.trim().slice(0, 120) };
    },
    async action(_context, props) {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const intention = await storage.readIntention(props.id);
      if (!intention)
        return jsonResult({ ok: false, message: "intention not found" });
      const cancelled = { ...intention, status: "cancelled" as const };
      await storage.saveIntention(cancelled);
      return jsonResult({
        intention_id: props.id,
        ok: true,
        status: "cancelled",
      });
    },
  });

  metidos.addAgentTool({
    tool: "new_policy",
    name: "kraken.trading.newPolicy",
    description:
      "Create .kraken-bot/policy.yml from safe defaults. Does not place, cancel, sign, or submit orders.",
    timeoutMs: 10_000,
    validateProps(input) {
      const record = compactInput(input) as Record<string, unknown>;
      return { overwrite: record.overwrite === true };
    },
    async action(_context, props) {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const result = await createDefaultProjectPolicy(metidos, props);
      await storage.writePolicyState(await loadProjectPolicy(metidos));
      return jsonResult(result);
    },
  });

  metidos.addAgentTool({
    tool: "get_policy",
    name: "kraken.trading.getPolicy",
    description:
      "Read the active project-file-backed trading policy. Read-only.",
    timeoutMs: 10_000,
    validateProps: compactInput,
    async action() {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      return jsonResult(
        publicPolicyResult(await refreshProjectPolicy(storage, metidos)),
      );
    },
  });

  metidos.addAgentTool({
    tool: "get_journal_summary",
    name: "kraken.trading.getJournalSummary",
    description:
      "Read recent safe journal summaries for Kraken trading operations. Read-only.",
    timeoutMs: 10_000,
    validateProps(input) {
      const record = compactInput(input) as Record<string, unknown>;
      return {
        limit:
          typeof record.limit === "number"
            ? Math.max(1, Math.min(50, Math.floor(record.limit)))
            : 20,
      };
    },
    async action(_context, props) {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      return jsonResult(await storage.journalSummary(props.limit));
    },
  });

  metidos.cron({
    key: "trading_minute",
    schedule: "* * * * *",
    timeoutMs: 60_000,
    async action() {
      const { storage } = storageAndAdapter(metidos);
      await storage.initialize();
      const policyState = await storage.readPolicyState();
      const policy = policyState.policy;
      if (!pluginEnabled(metidos)) {
        await storage.appendJournal(
          makeJournalEntry({
            intention_id: null,
            policy_id: policy.id,
            safe_details: { setting_enabled: false },
            strategy_id: null,
            summary:
              "Plugin enabled setting is false; cron exited before evaluation.",
            symbol: null,
            type: "NO_ACTION",
          }),
        );
        return {
          policy_id: policy.id,
          reason: "plugin_enabled_setting_false",
          status: "disabled",
        };
      }
      const adapter = createKrakenAdapter(metidos, () => storage.readRuntime());
      return runMinuteCron(storage, adapter);
    },
  });
});
