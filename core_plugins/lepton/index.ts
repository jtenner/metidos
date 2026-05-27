import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type LeptonModel = {
  contextWindow: number;
  cost: {
    cacheRead: number;
    cacheWrite: number;
    input: number;
    output: number;
  };
  id: string;
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
  reasoning: boolean;
};

const BASE_URL_ENV = "LEPTON_BASE_URL";
const API_KEY_ENV = "LEPTON_API_KEY";
const API_TOKEN_ENV = "LEPTON_API_TOKEN";
const MODEL_IDS_ENV = "LEPTON_MODEL_IDS";
const BASE_URL_SETTING = "base_url";
const API_KEY_SETTING = "api_key";
const MODEL_IDS_SETTING = "model_ids";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const MODEL_COMPAT = {
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
  supportsStore: false,
} as const;
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
  { kind: "api_key", source: "env", value: API_TOKEN_ENV },
] as const;
const PLACEHOLDER_BASE_URL = "https://example.lepton.run/api/v1";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.flatMap((entry) => {
    const normalized = stringValue(entry);
    return normalized ? [normalized] : [];
  });
  return entries.length > 0 ? entries : null;
}

function splitCommaSeparated(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isAllowedLeptonHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return (
    normalized.endsWith(".lepton.run") ||
    normalized.endsWith(".cloud.lepton.ai") ||
    normalized.endsWith(".dgxc-lepton.nvidia.com")
  );
}

export function normalizeLeptonBaseUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw || /[?#@]/u.test(raw)) {
    return null;
  }

  const match = raw.match(
    /^https:\/\/([A-Za-z0-9.-]+)(?::(443|[0-9]{1,5}))?(\/(?:api\/v1|v1)\/?)?$/u,
  );
  if (!match) {
    return null;
  }

  const host = match[1]?.toLowerCase();
  const port = match[2] ?? null;
  if (!host || (port !== null && port !== "443") || !isAllowedLeptonHost(host)) {
    return null;
  }

  const rawPath = match[3]?.replace(/\/+$/u, "") ?? "";
  const normalizedPath = rawPath.length > 0 ? rawPath : "/api/v1";
  const normalizedPort = port ? `:${port}` : "";
  return `https://${host}${normalizedPort}${normalizedPath}`;
}

function configuredBaseUrl(metidos: MetidosPluginApi): string | null {
  return normalizeLeptonBaseUrl(
    metidos.settings.get(BASE_URL_SETTING) ?? metidos.env.get(BASE_URL_ENV),
  );
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV)) ??
    stringValue(metidos.env.get(API_TOKEN_ENV))
  );
}

export function normalizeLeptonModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function leptonModelName(id: string): string {
  const cleaned = id
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .replace(/\bnim\b/giu, "NIM")
    .replace(/\bvl\b/giu, "VL")
    .replace(/\b(\d+)b\b/giu, "$1B")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function normalizeLeptonModels(values: readonly unknown[]): LeptonModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeLeptonModelId(entry);
    if (!id || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [
      {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        cost: DEFAULT_COST,
        id,
        input: ["text"],
        maxTokens: DEFAULT_MAX_TOKENS,
        name: leptonModelName(id),
        reasoning: /reason|thinking|r1|qwq|nemotron/iu.test(id),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): LeptonModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeLeptonModels(settingModels ?? envModels);
}

function modelConfiguration(model: LeptonModel) {
  return {
    api: "openai-completions",
    compat: MODEL_COMPAT,
    contextWindow: model.contextWindow,
    cost: model.cost,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "lepton",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const baseUrl = configuredBaseUrl(metidos);
      const apiKey = configuredApiKey(metidos);
      const models = baseUrl ? configuredModels(metidos) : [];
      const hasModels = models.length > 0;

      return [
        {
          api: "openai-completions",
          ...(apiKey ? { apiKey, authHeader: true } : { authHeader: false }),
          baseUrl: baseUrl ?? PLACEHOLDER_BASE_URL,
          configurationMissing: baseUrl === null || !hasModels,
          configurationMissingMessage:
            baseUrl === null
              ? "Lepton base_url is not configured or is not an HTTPS Lepton endpoint ending in /api/v1 or /v1. Set base_url or LEPTON_BASE_URL from the endpoint API tab."
              : "Lepton model IDs are not configured. Set model_ids or comma-separated LEPTON_MODEL_IDS from the endpoint /models response or deployed model name.",
          id: "default",
          label: "DGX Cloud Lepton",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
