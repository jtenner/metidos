import type { MetidosPluginApi } from "@metidos/plugin-api";
import { DEFAULT_POLICY, type TradingPolicy } from "./trading-types";

export const PROJECT_POLICY_PATH = "./.kraken-bot/policy.yml";
export const PROJECT_POLICY_DISPLAY_PATH = ".kraken-bot/policy.yml";

const SUPPORTED_SPOT_SYMBOLS = new Set(["BTC/USD", "ETH/USD"]);
const MAX_OPEN_ORDERS = 5;
const MAX_OPEN_POSITIONS = 5;

type PolicySource = "project_file" | "default";

export type LoadedPolicy = {
  policy: TradingPolicy;
  source: PolicySource;
  path: string;
  loaded_at: string;
  valid: boolean;
  validation_errors: string[];
  validation_warnings: string[];
  file_created?: boolean;
};

const POLICY_KEYS = new Set([
  "id",
  "enabled",
  "mode",
  "allowedSymbols",
  "maxOpenOrders",
  "maxOpenPositions",
  "maxDailyLossFraction",
  "maxWeeklyLossFraction",
  "maxRiskPerTradeFraction",
  "maxMarketDataAgeMs",
  "maxOrderAgeSeconds",
  "execution",
  "live",
]);

const EXECUTION_KEYS = new Set([
  "allowMarketOrders",
  "allowLeverage",
  "allowMargin",
  "allowWithdrawals",
  "postOnlyByDefault",
]);

const LIVE_KEYS = new Set([
  "requiresHumanApproval",
  "maxAutonomousNotionalUsd",
]);

const KEY_ALIASES: Record<string, string> = {
  allowed_symbols: "allowedSymbols",
  max_open_orders: "maxOpenOrders",
  max_open_positions: "maxOpenPositions",
  max_daily_loss_fraction: "maxDailyLossFraction",
  max_weekly_loss_fraction: "maxWeeklyLossFraction",
  max_risk_per_trade_fraction: "maxRiskPerTradeFraction",
  max_market_data_age_ms: "maxMarketDataAgeMs",
  max_order_age_seconds: "maxOrderAgeSeconds",
  allow_market_orders: "allowMarketOrders",
  allow_leverage: "allowLeverage",
  allow_margin: "allowMargin",
  allow_withdrawals: "allowWithdrawals",
  post_only_by_default: "postOnlyByDefault",
  requires_human_approval: "requiresHumanApproval",
  max_autonomous_notional_usd: "maxAutonomousNotionalUsd",
};

function canonicalKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

function stripComment(line: string): string {
  let quoted: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== "\\") {
      quoted = quoted === char ? null : (quoted ?? char);
    }
    if (char === "#" && !quoted) return line.slice(0, i);
  }
  return line;
}

function parseScalar(text: string): unknown {
  const value = text.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((part) => parseScalar(part.trim()));
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function parsePolicyYaml(text: string): unknown {
  const root: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentObject: Record<string, unknown> | null = null;
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const raw = stripComment(lines[lineNumber] ?? "");
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)?.[0].length ?? 0;
    const trimmed = raw.trim();

    if (indent === 0) {
      currentObject = null;
      if (trimmed.startsWith("- "))
        throw new Error(
          `line ${lineNumber + 1}: top-level arrays are not supported`,
        );
      const match = /^([^:]+):(.*)$/.exec(trimmed);
      if (!match)
        throw new Error(`line ${lineNumber + 1}: expected key: value`);
      const key = canonicalKey(match[1]!.trim());
      const rest = match[2]!.trim();
      if (rest === "") {
        currentKey = key;
        root[key] = [];
      } else {
        currentKey = null;
        root[key] = parseScalar(rest);
      }
      continue;
    }

    if (!currentKey)
      throw new Error(`line ${lineNumber + 1}: unexpected indentation`);
    if (indent !== 2)
      throw new Error(
        `line ${lineNumber + 1}: only two-space indentation is supported`,
      );

    if (trimmed.startsWith("- ")) {
      const list = root[currentKey];
      if (!Array.isArray(list))
        throw new Error(`line ${lineNumber + 1}: ${currentKey} is not a list`);
      list.push(parseScalar(trimmed.slice(2)));
      continue;
    }

    const match = /^([^:]+):(.*)$/.exec(trimmed);
    if (!match)
      throw new Error(`line ${lineNumber + 1}: expected nested key: value`);
    if (Array.isArray(root[currentKey])) root[currentKey] = {};
    currentObject = root[currentKey] as Record<string, unknown>;
    currentObject[canonicalKey(match[1]!.trim())] = parseScalar(
      match[2]!.trim(),
    );
  }

  return root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
): boolean {
  if (typeof record[key] !== "boolean") errors.push(`${key} must be a boolean`);
  return record[key] === true;
}

function requiredNumber(
  record: Record<string, unknown>,
  key: string,
  errors: string[],
  min: number,
  max = Number.POSITIVE_INFINITY,
  integer = false,
): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isInteger(value))
  ) {
    errors.push(
      `${key} must be ${integer ? "an integer" : "a number"} >= ${min}${Number.isFinite(max) ? ` and <= ${max}` : ""}`,
    );
    return 0;
  }
  return value;
}

function rejectUnknown(
  record: Record<string, unknown>,
  allowed: Set<string>,
  prefix: string,
  errors: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key))
      errors.push(`${prefix}${key} is not a supported policy field`);
  }
}

export function validatePolicy(value: unknown): LoadedPolicy {
  const loaded_at = new Date().toISOString();
  const errors: string[] = [];
  const warnings: string[] = [];
  const policy = structuredClone(DEFAULT_POLICY);

  if (!isRecord(value)) {
    errors.push("policy must be a YAML object");
  } else {
    rejectUnknown(value, POLICY_KEYS, "", errors);
    const execution = isRecord(value.execution) ? value.execution : null;
    const live = isRecord(value.live) ? value.live : null;
    if (!execution) errors.push("execution must be an object");
    else rejectUnknown(execution, EXECUTION_KEYS, "execution.", errors);
    if (!live) errors.push("live must be an object");
    else rejectUnknown(live, LIVE_KEYS, "live.", errors);

    if (typeof value.id !== "string" || !value.id.trim())
      errors.push("id must be a non-empty string");
    else policy.id = value.id.trim();
    policy.enabled = requiredBoolean(value, "enabled", errors);
    if (value.mode !== "paper" && value.mode !== "live")
      errors.push("mode must be one of: paper, live");
    else policy.mode = value.mode;
    if (
      !Array.isArray(value.allowedSymbols) ||
      value.allowedSymbols.length === 0
    )
      errors.push("allowedSymbols must be a non-empty array");
    else {
      const symbols = value.allowedSymbols.filter(
        (symbol): symbol is string => typeof symbol === "string",
      );
      if (symbols.length !== value.allowedSymbols.length)
        errors.push("allowedSymbols must contain only strings");
      for (const symbol of symbols)
        if (!SUPPORTED_SPOT_SYMBOLS.has(symbol))
          errors.push(
            `allowedSymbols contains unsupported spot pair: ${symbol}`,
          );
      policy.allowedSymbols = symbols;
    }
    policy.maxOpenOrders = requiredNumber(
      value,
      "maxOpenOrders",
      errors,
      0,
      MAX_OPEN_ORDERS,
      true,
    );
    policy.maxOpenPositions = requiredNumber(
      value,
      "maxOpenPositions",
      errors,
      0,
      MAX_OPEN_POSITIONS,
      true,
    );
    policy.maxDailyLossFraction = requiredNumber(
      value,
      "maxDailyLossFraction",
      errors,
      0,
      1,
    );
    policy.maxWeeklyLossFraction = requiredNumber(
      value,
      "maxWeeklyLossFraction",
      errors,
      0,
      1,
    );
    policy.maxRiskPerTradeFraction = requiredNumber(
      value,
      "maxRiskPerTradeFraction",
      errors,
      0,
      1,
    );
    policy.maxMarketDataAgeMs = requiredNumber(
      value,
      "maxMarketDataAgeMs",
      errors,
      1,
      Number.POSITIVE_INFINITY,
      true,
    );
    policy.maxOrderAgeSeconds = requiredNumber(
      value,
      "maxOrderAgeSeconds",
      errors,
      1,
      Number.POSITIVE_INFINITY,
      true,
    );

    if (execution) {
      policy.execution.allowMarketOrders = requiredBoolean(
        execution,
        "allowMarketOrders",
        errors,
      );
      policy.execution.allowLeverage = requiredBoolean(
        execution,
        "allowLeverage",
        errors,
      );
      policy.execution.allowMargin = requiredBoolean(
        execution,
        "allowMargin",
        errors,
      );
      policy.execution.allowWithdrawals = requiredBoolean(
        execution,
        "allowWithdrawals",
        errors,
      );
      policy.execution.postOnlyByDefault = requiredBoolean(
        execution,
        "postOnlyByDefault",
        errors,
      );
      if (policy.execution.allowMarketOrders)
        errors.push(
          "execution.allowMarketOrders=true is not supported; market orders remain hard-blocked",
        );
      if (policy.execution.allowLeverage)
        errors.push(
          "execution.allowLeverage must be false; leverage is not supported",
        );
      if (policy.execution.allowMargin)
        errors.push(
          "execution.allowMargin must be false; margin is not supported",
        );
      if (policy.execution.allowWithdrawals)
        errors.push(
          "execution.allowWithdrawals must be false; withdrawals are not supported",
        );
    }
    if (live) {
      policy.live.requiresHumanApproval = requiredBoolean(
        live,
        "requiresHumanApproval",
        errors,
      );
      policy.live.maxAutonomousNotionalUsd = requiredNumber(
        live,
        "maxAutonomousNotionalUsd",
        errors,
        0,
      );
    }
  }

  if (policy.maxRiskPerTradeFraction > 0.05)
    warnings.push("maxRiskPerTradeFraction is above 0.05 and is high risk");
  if (policy.maxDailyLossFraction > 0.1)
    warnings.push("maxDailyLossFraction is above 0.10 and is high risk");
  if (policy.mode === "live" && policy.live.requiresHumanApproval === false)
    warnings.push("live.requiresHumanApproval is false in live mode");

  const valid = errors.length === 0;
  return {
    loaded_at,
    path: PROJECT_POLICY_DISPLAY_PATH,
    policy: valid ? policy : { ...policy, enabled: false },
    source: "project_file",
    valid,
    validation_errors: errors,
    validation_warnings: warnings,
  };
}

export function policyToYaml(policy: TradingPolicy = DEFAULT_POLICY): string {
  return `id: ${policy.id}
enabled: ${policy.enabled}
mode: ${policy.mode}

allowedSymbols:
${policy.allowedSymbols.map((symbol) => `  - ${symbol}`).join("\n")}

maxOpenOrders: ${policy.maxOpenOrders}
maxOpenPositions: ${policy.maxOpenPositions}
maxDailyLossFraction: ${policy.maxDailyLossFraction}
maxWeeklyLossFraction: ${policy.maxWeeklyLossFraction}
maxRiskPerTradeFraction: ${policy.maxRiskPerTradeFraction}
maxMarketDataAgeMs: ${policy.maxMarketDataAgeMs}
maxOrderAgeSeconds: ${policy.maxOrderAgeSeconds}

execution:
  allowMarketOrders: ${policy.execution.allowMarketOrders}
  allowLeverage: ${policy.execution.allowLeverage}
  allowMargin: ${policy.execution.allowMargin}
  allowWithdrawals: ${policy.execution.allowWithdrawals}
  postOnlyByDefault: ${policy.execution.postOnlyByDefault}

live:
  requiresHumanApproval: ${policy.live.requiresHumanApproval}
  maxAutonomousNotionalUsd: ${policy.live.maxAutonomousNotionalUsd}
`;
}

export function defaultLoadedPolicy(): LoadedPolicy {
  return {
    loaded_at: new Date().toISOString(),
    path: PROJECT_POLICY_DISPLAY_PATH,
    policy: structuredClone(DEFAULT_POLICY),
    source: "default",
    valid: true,
    validation_errors: [],
    validation_warnings: [
      "project policy file is missing; using safe defaults until new_policy creates .kraken-bot/policy.yml",
    ],
  };
}

export async function loadProjectPolicy(
  metidos: MetidosPluginApi,
): Promise<LoadedPolicy> {
  try {
    if (!(await metidos.fs.exists(PROJECT_POLICY_PATH))) {
      return defaultLoadedPolicy();
    }
    const text = await metidos.fs.readText(PROJECT_POLICY_PATH);
    return validatePolicy(parsePolicyYaml(text));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      loaded_at: new Date().toISOString(),
      path: PROJECT_POLICY_DISPLAY_PATH,
      policy: { ...structuredClone(DEFAULT_POLICY), enabled: false },
      source: "project_file",
      valid: false,
      validation_errors: [`policy YAML could not be loaded: ${message}`],
      validation_warnings: [],
    };
  }
}

export async function createDefaultProjectPolicy(
  metidos: MetidosPluginApi,
  options: { overwrite?: boolean } = {},
): Promise<Record<string, unknown>> {
  const exists = await metidos.fs.exists(PROJECT_POLICY_PATH);
  if (exists && !options.overwrite) {
    return {
      ok: false,
      created: false,
      path: PROJECT_POLICY_DISPLAY_PATH,
      message:
        "policy file already exists; pass overwrite: true only if you intend to replace it with safe defaults",
    };
  }
  await metidos.fs.mkdir("./.kraken-bot", { recursive: true });
  await metidos.fs.writeText(PROJECT_POLICY_PATH, policyToYaml(DEFAULT_POLICY));
  return {
    ok: true,
    created: !exists,
    overwritten: exists,
    path: PROJECT_POLICY_DISPLAY_PATH,
    policy: publicPolicyResult(await loadProjectPolicy(metidos)),
  };
}

export function publicPolicyResult(
  loaded: LoadedPolicy,
): Record<string, unknown> {
  return {
    ...loaded.policy,
    source: loaded.source,
    path: loaded.path,
    loaded_at: loaded.loaded_at,
    valid: loaded.valid,
    validation_errors: loaded.validation_errors,
    validation_warnings: loaded.validation_warnings,
  };
}
