import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type TgiModel = {
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

const BASE_URL_ENV = "TGI_BASE_URL";
const API_KEY_ENV = "TGI_API_KEY";
const MODEL_IDS_ENV = "TGI_MODEL_IDS";
const BASE_URL_SETTING = "base_url";
const API_KEY_SETTING = "api_key";
const MODEL_IDS_SETTING = "model_ids";
const DEFAULT_BASE_URL = "http://localhost:8080/v1";
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

export function normalizeTgiBaseUrl(value: unknown): string | null {
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
  return normalizeTgiBaseUrl(
    metidos.settings.get(BASE_URL_SETTING) ?? metidos.env.get(BASE_URL_ENV),
  );
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

export function normalizeTgiModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function tgiModelName(id: string): string {
  const cleaned = id
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function normalizeTgiModels(values: readonly unknown[]): TgiModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeTgiModelId(entry);
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
        name: tgiModelName(id),
        reasoning: /reason|thinking|gpt-oss|deepseek-r1|qwq/iu.test(id),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): TgiModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeTgiModels(settingModels ?? envModels);
}

function modelConfiguration(model: TgiModel) {
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
    id: "tgi",
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
              ? "TGI base URL must be a loopback /v1 URL such as http://localhost:8080/v1."
              : "TGI model IDs are not configured. Set model_ids or comma-separated TGI_MODEL_IDS from the local TGI /v1/models model-info response or the loaded model ID.",
          id: "default",
          label: "TGI OpenAI Server",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
