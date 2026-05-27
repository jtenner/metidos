import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type CustomOpenAiModel = {
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

const NAME_ENV = "CUSTOM_OPENAI_NAME";
const BASE_URL_ENV = "CUSTOM_OPENAI_BASE_URL";
const API_KEY_ENV = "CUSTOM_OPENAI_API_KEY";
const MODEL_IDS_ENV = "CUSTOM_OPENAI_MODEL_IDS";
const NAME_SETTING = "name";
const BASE_URL_SETTING = "base_url";
const API_KEY_SETTING = "api_key";
const MODEL_IDS_SETTING = "model_ids";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_LABEL = "Custom OpenAI-Compatible Endpoint";
const MISSING_BASE_URL = "https://api.example.com/v1";
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
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

function isValidPublicHostname(host: string): boolean {
  if (
    host.length > 253 ||
    !host.includes(".") ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".test") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(host)
  ) {
    return false;
  }
  const labels = host.split(".");
  if (labels.some((label) => label.length < 1 || label.length > 63)) {
    return false;
  }
  return labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label));
}

export function normalizeCustomOpenAiBaseUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw || raw.length > 2048 || /\s/u.test(raw)) {
    return null;
  }
  const match = raw.match(
    /^https:\/\/([^/?#@:]+)(?::(\d{1,5}))?(?:\/([^?#]*))?$/iu,
  );
  if (!match) {
    return null;
  }
  const host = match[1]?.toLowerCase();
  const port = match[2] ? Number(match[2]) : null;
  const rawPath = match[3] ?? "";
  if (
    !host ||
    !isValidPublicHostname(host) ||
    (port !== null && (port < 1 || port > 65535))
  ) {
    return null;
  }
  const normalizedPath = rawPath.replace(/\/+$/u, "");
  if (
    normalizedPath.length > 0 &&
    normalizedPath !== "v1" &&
    !normalizedPath.endsWith("/v1")
  ) {
    return null;
  }
  return `https://${host}${port === null ? "" : `:${port}`}${
    normalizedPath.length > 0 ? `/${normalizedPath}` : "/v1"
  }`;
}

export function normalizeCustomOpenAiName(value: unknown): string {
  const normalized = stringValue(value)
    ?.replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized && normalized.length <= 80 ? normalized : DEFAULT_LABEL;
}

function configuredLabel(metidos: MetidosPluginApi): string {
  return normalizeCustomOpenAiName(
    metidos.settings.get(NAME_SETTING) ?? metidos.env.get(NAME_ENV),
  );
}

function configuredBaseUrl(metidos: MetidosPluginApi): string | null {
  return normalizeCustomOpenAiBaseUrl(
    metidos.settings.get(BASE_URL_SETTING) ?? metidos.env.get(BASE_URL_ENV),
  );
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

export function normalizeCustomOpenAiModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function customOpenAiModelName(id: string): string {
  const cleaned = id
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .replace(/\bvl\b/giu, "VL")
    .replace(/\b(\d+)b\b/giu, "$1B")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function normalizeCustomOpenAiModels(
  values: readonly unknown[],
): CustomOpenAiModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeCustomOpenAiModelId(entry);
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
        name: customOpenAiModelName(id),
        reasoning: /reason|thinking|gpt-oss|deepseek-r1|qwq|o[134]|sonar/iu.test(
          id,
        ),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): CustomOpenAiModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeCustomOpenAiModels(settingModels ?? envModels);
}

function modelConfiguration(model: CustomOpenAiModel) {
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
    id: "custom_openai",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const label = configuredLabel(metidos);
      const baseUrl = configuredBaseUrl(metidos);
      const apiKey = configuredApiKey(metidos);
      const models = baseUrl ? configuredModels(metidos) : [];
      const hasModels = models.length > 0;
      return [
        {
          api: "openai-completions",
          ...(apiKey ? { apiKey, authHeader: true } : { authHeader: false }),
          baseUrl: baseUrl ?? MISSING_BASE_URL,
          configurationMissing: baseUrl === null || !hasModels,
          configurationMissingMessage:
            baseUrl === null
              ? "Custom OpenAI-compatible base URL must be an HTTPS public-host /v1 URL, such as https://api.example.com/v1. Loopback, private, HTTP, IP-literal, query, and fragment URLs are rejected."
              : "Custom OpenAI-compatible model IDs are not configured. Set model_ids or comma-separated CUSTOM_OPENAI_MODEL_IDS from the endpoint's /v1/models response.",
          id: "default",
          label,
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
