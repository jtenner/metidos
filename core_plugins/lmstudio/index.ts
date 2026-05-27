import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type LmStudioModel = {
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

const BASE_URL_ENV = "LMSTUDIO_BASE_URL";
const API_TOKEN_ENV = "LM_API_TOKEN";
const API_KEY_ENV = "LMSTUDIO_API_KEY";
const MODEL_IDS_ENV = "LMSTUDIO_MODEL_IDS";
const BASE_URL_SETTING = "base_url";
const API_KEY_SETTING = "api_key";
const MODEL_IDS_SETTING = "model_ids";
const DEFAULT_BASE_URL = "http://localhost:1234/v1";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_MAX_TOKENS = 8192;
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
  { kind: "api_key", source: "env", value: API_TOKEN_ENV },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;

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

export function normalizeLmStudioBaseUrl(value: unknown): string | null {
  const raw = stringValue(value) ?? DEFAULT_BASE_URL;
  const match = raw.match(
    /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\])(?::(\d{1,5}))?(?:\/(?:v1\/?)?)?$/iu,
  );
  if (!match) {
    return null;
  }
  const protocol = match[1]?.toLowerCase();
  const host = match[2]?.toLowerCase();
  const port = match[3] ? Number(match[3]) : null;
  if (!protocol || !host || (port !== null && (port < 1 || port > 65535))) {
    return null;
  }
  return `${protocol}${host}${port === null ? "" : `:${port}`}/v1`;
}

function configuredBaseUrl(metidos: MetidosPluginApi): string | null {
  return normalizeLmStudioBaseUrl(
    metidos.settings.get(BASE_URL_SETTING) ?? metidos.env.get(BASE_URL_ENV),
  );
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_TOKEN_ENV)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

export function normalizeLmStudioModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function lmStudioModelName(id: string): string {
  const cleaned = id
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function normalizeLmStudioModels(values: readonly unknown[]): LmStudioModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeLmStudioModelId(entry);
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
        name: lmStudioModelName(id),
        reasoning: /reason|thinking|gpt-oss|deepseek-r1/iu.test(id),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): LmStudioModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeLmStudioModels(settingModels ?? envModels);
}

function modelConfiguration(model: LmStudioModel) {
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
    id: "lmstudio",
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
          baseUrl: baseUrl ?? DEFAULT_BASE_URL,
          configurationMissing: baseUrl === null || !hasModels,
          configurationMissingMessage:
            baseUrl === null
              ? "LM Studio base URL must be a loopback /v1 URL such as http://localhost:1234/v1."
              : "LM Studio model IDs are not configured. Set model_ids or comma-separated LMSTUDIO_MODEL_IDS from the IDs returned by LM Studio /v1/models.",
          id: "default",
          label: "LM Studio",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
