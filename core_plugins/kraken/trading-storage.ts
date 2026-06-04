import type { MetidosPluginApi } from "@metidos/plugin-api";
import {
  DEFAULT_KILL_SWITCH,
  DEFAULT_POLICY,
  DEFAULT_RUNTIME,
  type HumanApproval,
  type JournalEntry,
  type KillSwitch,
  type TradeIntention,
  type TradingPolicy,
  type TradingRuntime,
} from "./trading-types";
import { defaultLoadedPolicy, type LoadedPolicy } from "./policy-loader";

const POLICY_PATH = "~/trading/policy.json";
const POLICY_STATE_PATH = "~/trading/policy-state.json";
const RUNTIME_PATH = "~/trading/runtime.json";
const KILL_SWITCH_PATH = "~/trading/kill-switch.json";
const LOCK_PATH = "~/trading/runtime-lock.json";

function safeId(id: string): string {
  const normalized = id
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 120);
  if (!normalized)
    throw new Error("id must contain at least one safe character");
  return normalized;
}

function dayStamp(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

async function ensureTradingDirs(metidos: MetidosPluginApi): Promise<void> {
  await metidos.fs.mkdir("~/trading/intentions", { recursive: true });
  await metidos.fs.mkdir("~/trading/approvals", { recursive: true });
  await metidos.fs.mkdir("~/trading/journal", { recursive: true });
  await metidos.fs.mkdir("~/trading/incidents", { recursive: true });
}

async function readJson<T>(
  metidos: MetidosPluginApi,
  path: string,
  fallback: T,
): Promise<T> {
  try {
    if (!(await metidos.fs.exists(path))) return fallback;
    return JSON.parse(await metidos.fs.readText(path)) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(
  metidos: MetidosPluginApi,
  path: string,
  value: unknown,
): Promise<void> {
  await ensureTradingDirs(metidos);
  await metidos.fs.writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export class TradingStorage {
  constructor(private readonly metidos: MetidosPluginApi) {}

  async initialize(): Promise<void> {
    await ensureTradingDirs(this.metidos);
    if (!(await this.metidos.fs.exists(POLICY_PATH)))
      await this.writePolicy(DEFAULT_POLICY);
    if (!(await this.metidos.fs.exists(POLICY_STATE_PATH)))
      await this.writePolicyState(defaultLoadedPolicy());
    if (!(await this.metidos.fs.exists(RUNTIME_PATH)))
      await this.writeRuntime(DEFAULT_RUNTIME);
    if (!(await this.metidos.fs.exists(KILL_SWITCH_PATH)))
      await this.writeKillSwitch(DEFAULT_KILL_SWITCH);
  }

  async readPolicy(): Promise<TradingPolicy> {
    return (await this.readPolicyState()).policy;
  }

  writePolicy(policy: TradingPolicy): Promise<void> {
    return this.writePolicyState({
      ...defaultLoadedPolicy(),
      policy,
      source: "default",
      validation_warnings: [
        "policy was written to plugin storage; project .kraken-bot/policy.yml remains the human-editable source of truth",
      ],
    });
  }

  async readPolicyState(): Promise<LoadedPolicy> {
    const state = await readJson<LoadedPolicy | null>(
      this.metidos,
      POLICY_STATE_PATH,
      null,
    );
    if (state?.policy) return state;
    const legacy = await readJson(this.metidos, POLICY_PATH, DEFAULT_POLICY);
    return { ...defaultLoadedPolicy(), policy: legacy };
  }

  async writePolicyState(state: LoadedPolicy): Promise<void> {
    await writeJson(this.metidos, POLICY_STATE_PATH, state);
    await writeJson(this.metidos, POLICY_PATH, state.policy);
  }

  readRuntime(): Promise<TradingRuntime> {
    return readJson(this.metidos, RUNTIME_PATH, DEFAULT_RUNTIME);
  }

  writeRuntime(runtime: TradingRuntime): Promise<void> {
    return writeJson(this.metidos, RUNTIME_PATH, runtime);
  }

  readKillSwitch(): Promise<KillSwitch> {
    return readJson(this.metidos, KILL_SWITCH_PATH, DEFAULT_KILL_SWITCH);
  }

  writeKillSwitch(killSwitch: KillSwitch): Promise<void> {
    return writeJson(this.metidos, KILL_SWITCH_PATH, killSwitch);
  }

  async latchKillSwitch(reason: string): Promise<KillSwitch> {
    const current = await this.readKillSwitch();
    const next: KillSwitch = {
      ...current,
      latched: true,
      latched_at: current.latched_at ?? new Date().toISOString(),
      reason,
    };
    await this.writeKillSwitch(next);
    return next;
  }

  intentionPath(id: string): string {
    return `~/trading/intentions/${safeId(id)}.json`;
  }

  approvalPath(id: string): string {
    return `~/trading/approvals/${safeId(id)}.json`;
  }

  async saveIntention(intention: TradeIntention): Promise<void> {
    await writeJson(this.metidos, this.intentionPath(intention.id), intention);
  }

  async readIntention(id: string): Promise<TradeIntention | null> {
    const path = this.intentionPath(id);
    if (!(await this.metidos.fs.exists(path))) return null;
    return readJson<TradeIntention | null>(this.metidos, path, null);
  }

  async listIntentions(): Promise<TradeIntention[]> {
    await ensureTradingDirs(this.metidos);
    const paths = await this.metidos.fs.glob("~/trading/intentions/*.json");
    const intentions: TradeIntention[] = [];
    for (const path of [...paths].sort()) {
      const intention = await readJson<TradeIntention | null>(
        this.metidos,
        path,
        null,
      );
      if (intention) intentions.push(intention);
    }
    return intentions;
  }

  async saveApproval(approval: HumanApproval): Promise<void> {
    await writeJson(this.metidos, this.approvalPath(approval.id), approval);
  }

  async readApproval(id: string | null): Promise<HumanApproval | null> {
    if (!id) return null;
    const path = this.approvalPath(id);
    if (!(await this.metidos.fs.exists(path))) return null;
    return readJson<HumanApproval | null>(this.metidos, path, null);
  }

  async appendJournal(entry: JournalEntry): Promise<void> {
    await ensureTradingDirs(this.metidos);
    const path = `~/trading/journal/${dayStamp(new Date(entry.timestamp))}.jsonl`;
    const previous = (await this.metidos.fs.exists(path))
      ? await this.metidos.fs.readText(path)
      : "";
    await this.metidos.fs.writeText(
      path,
      `${previous}${JSON.stringify(entry)}\n`,
    );
    const runtime = await this.readRuntime();
    await this.writeRuntime({ ...runtime, lastJournalAt: entry.timestamp });
  }

  async appendIncident(incident: Record<string, unknown>): Promise<void> {
    const id = safeId(String(incident.id ?? `incident-${Date.now()}`));
    await writeJson(this.metidos, `~/trading/incidents/${id}.json`, incident);
  }

  async journalSummary(
    limit = 20,
  ): Promise<{ entries: JournalEntry[]; totalFiles: number }> {
    await ensureTradingDirs(this.metidos);
    const paths = [...(await this.metidos.fs.glob("~/trading/journal/*.jsonl"))]
      .sort()
      .slice(-7);
    const entries: JournalEntry[] = [];
    for (const path of paths) {
      const text = await this.metidos.fs.readText(path);
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          entries.push(JSON.parse(line) as JournalEntry);
        } catch {}
      }
    }
    return { entries: entries.slice(-limit), totalFiles: paths.length };
  }

  async acquireLock(name: string, ttlMs: number): Promise<boolean> {
    const now = Date.now();
    const current = await readJson<{ name: string; expiresAt: number } | null>(
      this.metidos,
      LOCK_PATH,
      null,
    );
    if (current && current.expiresAt > now && current.name === name)
      return false;
    await writeJson(this.metidos, LOCK_PATH, { expiresAt: now + ttlMs, name });
    return true;
  }

  async releaseLock(name: string): Promise<void> {
    const current = await readJson<{ name: string; expiresAt: number } | null>(
      this.metidos,
      LOCK_PATH,
      null,
    );
    if (current?.name === name)
      await writeJson(this.metidos, LOCK_PATH, { expiresAt: 0, name });
  }
}

export function makeJournalEntry(
  input: Omit<JournalEntry, "id" | "timestamp">,
): JournalEntry {
  const timestamp = new Date().toISOString();
  return {
    ...input,
    id: `journal-${timestamp}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp,
  };
}
