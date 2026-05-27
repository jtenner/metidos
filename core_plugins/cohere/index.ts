import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type CohereModel = {
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

const API_KEY_ENV = "COHERE_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.cohere.ai/compatibility/v1";
const DISCOVERY_URL = "https://api.cohere.ai/v1/models";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
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
  supportsStore: false,
};
const NON_CHAT_ID_PARTS = [
  "audio",
  "embed",
  "embedding",
  "image",
  "moderation",
  "rerank",
  "tts",
  "whisper",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function titleCaseWords(value: string): string {
  return value.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function modelName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  return titleCaseWords(
    id
      .replace(/[\/_-]/gu, " ")
      .replace(/\bapi\b/giu, "API")
      .replace(/\bcohere\b/giu, "Cohere")
      .replace(/\bcommand\b/giu, "Command")
      .replace(/\br\b/giu, "R")
      .replace(/\ba\b/giu, "A"),
  );
}

function capabilitiesForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.capabilities) ? model.capabilities : null;
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return value.flatMap((entry) => {
    const text = stringValue(entry);
    return text ? [text] : [];
  });
}

function isChatModel(model: Record<string, unknown>, id: string): boolean {
  const normalized = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalized.includes(part))) {
    return false;
  }
  const type = stringValue(model.type)?.toLowerCase();
  if (type && ["embedding", "image", "moderation", "rerank"].includes(type)) {
    return false;
  }
  const endpoints = stringArrayValue(model.endpoints);
  if (endpoints && endpoints.length > 0) {
    const normalizedEndpoints = endpoints.map((endpoint) => endpoint.toLowerCase());
    if (
      normalizedEndpoints.some((endpoint) =>
        ["chat", "chat-completions", "chat_completions", "compatible"].includes(
          endpoint,
        ),
      )
    ) {
      return true;
    }
    return false;
  }
  const capabilities = capabilitiesForModel(model);
  const supportsChat =
    booleanValue(capabilities?.completion_chat) ??
    booleanValue(capabilities?.chat_completion) ??
    booleanValue(capabilities?.chat);
  return supportsChat !== false;
}

function modelInput(
  model: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const capabilities = capabilitiesForModel(model);
  const hasVision =
    capabilities?.vision === true ||
    capabilities?.image_input === true ||
    capabilities?.multimodal === true ||
    /(?:vision|vl|multimodal)/iu.test(id);
  return hasVision ? ["text", "image"] : ["text"];
}

function normalizeContextWindow(value: Record<string, unknown>): number {
  const limits = isRecord(value.limits) ? value.limits : null;
  return (
    numberValue(value.max_context_length) ??
    numberValue(value.maxContextLength) ??
    numberValue(value.context_window) ??
    numberValue(value.contextWindow) ??
    numberValue(value.context_length) ??
    numberValue(value.contextLength) ??
    numberValue(value.max_context_tokens) ??
    numberValue(value.maxContextTokens) ??
    numberValue(limits?.max_context_length) ??
    numberValue(limits?.maxContextLength) ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(value: Record<string, unknown>): number {
  const limits = isRecord(value.limits) ? value.limits : null;
  return (
    numberValue(value.max_completion_tokens) ??
    numberValue(value.maxCompletionTokens) ??
    numberValue(value.max_output_tokens) ??
    numberValue(value.maxOutputTokens) ??
    numberValue(value.max_tokens) ??
    numberValue(value.maxTokens) ??
    numberValue(limits?.max_completion_tokens) ??
    numberValue(limits?.maxCompletionTokens) ??
    numberValue(limits?.max_output_tokens) ??
    numberValue(limits?.maxOutputTokens) ??
    DEFAULT_MAX_TOKENS
  );
}

export function normalizeCohereModel(value: unknown): CohereModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.name);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Cohere exposes reasoning-capable models, but Pi thinking-level controls
    // stay disabled until Cohere-specific reasoning parameters are modeled.
    reasoning: false,
  };
}

async function logWarning(
  metidos: MetidosPluginApi,
  message: string,
): Promise<void> {
  try {
    await metidos.log?.("warn", message);
  } catch {
    // Ignore logging failures.
  }
}

async function discoverModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<CohereModel[]> {
  if (!apiKey) {
    throw new Error(
      "Cohere model discovery requires a api_key Plugin Setting or COHERE_API_KEY.",
    );
  }
  const response = await metidos.fetch(DISCOVERY_URL, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Cohere model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.models)
        ? payload.models
        : null;
  if (!entries) {
    throw new Error(
      "Cohere model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeCohereModel(entry);
    return model ? [model] : [];
  });
}

function piAuthRecords(): Record<string, string>[] {
  return [
    {
      kind: "api_key",
      source: "setting",
      value: API_KEY_SETTING,
    },
    { kind: "api_key", source: "env", value: API_KEY_ENV },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "cohere",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: CohereModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Cohere model discovery failed; Cohere catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Cohere",
          models: models.map((model) => ({
            compat: MODEL_COMPAT,
            contextWindow: model.contextWindow,
            cost: model.cost,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: model.reasoning,
          })),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
