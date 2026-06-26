import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type ZaiEndpointMode = "general_api" | "coding_plan";

export type ZaiModel = {
  contextWindow: number;
  id: string;
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
};

const API_KEY_ENV = "ZAI_API_KEY";
const API_KEY_SETTING = "api_key";
const ENDPOINT_SETTING = "endpoint";
const GENERAL_API_BASE_URL = "https://api.z.ai/api/paas/v4";
const CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const API_KEY_SENTINEL = "METIDOS_ZAI_API_KEY_NOT_CONFIGURED";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;
const MODEL_COMPAT = {
  supportsDeveloperRole: false,
  thinkingFormat: "zai",
  zaiToolStream: true,
} as const;
// Dynamic model list will be populated from ZAI /models endpoint.
// Fallback static list retained for environments where network fetch is unavailable.
const STATIC_ZAI_MODELS: ZaiModel[] = [
  {
    contextWindow: 131_072,
    id: "glm-4.5-air",
    input: ["text"],
    maxTokens: 98_304,
    name: "GLM-4.5-Air",
  },
  {
    contextWindow: 204_800,
    id: "glm-4.7",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-4.7",
  },
  {
    contextWindow: 202_800,
    id: "glm-5.2",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5.2",
  },
  {
    contextWindow: 202_800,
    id: "glm-5.1",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5.1",
  },
  {
    contextWindow: 202_800,
    id: "glm-5",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5",
  },
  {
    contextWindow: 200_000,
    id: "glm-5-turbo",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5-Turbo",
  },
  {
    contextWindow: 200_000,
    id: "glm-5v-turbo",
    input: ["text", "image"],
    maxTokens: 131_072,
    name: "GLM-5V-Turbo",
  },
];

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function endpointMode(value: unknown): ZaiEndpointMode {
  return value === "coding_plan" ? "coding_plan" : "general_api";
}

function baseUrlForEndpoint(mode: ZaiEndpointMode): string {
  return mode === "coding_plan" ? CODING_PLAN_BASE_URL : GENERAL_API_BASE_URL;
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

function titleCaseModelId(id: string): string {
  return id
    .split(/[-_]+/gu)
    .filter(Boolean)
    .map((part) => (/^glm$/iu.test(part) ? "GLM" : part.toUpperCase()))
    .join("-");
}

function modelInput(
  value: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const input = Array.isArray(value.input) ? value.input : [];
  const capabilities = isRecord(value.capabilities) ? value.capabilities : null;
  const hasVision =
    input.includes("image") ||
    value.type === "vision" ||
    capabilities?.vision === true ||
    capabilities?.image_input === true ||
    /(?:vision|vl|glm-\d+v)/iu.test(id);
  return hasVision ? ["text", "image"] : ["text"];
}

export function normalizeZaiModel(value: unknown): ZaiModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const contextWindow =
    numberValue(value.contextWindow) ??
    numberValue(value.context_window) ??
    numberValue(value.max_context_length) ??
    200_000;
  const maxTokens =
    numberValue(value.maxTokens) ??
    numberValue(value.max_tokens) ??
    numberValue(value.max_completion_tokens) ??
    numberValue(value.max_output_tokens) ??
    131_072;
  return {
    contextWindow,
    id,
    input: modelInput(value, id),
    maxTokens,
    name: stringValue(value.name) ?? titleCaseModelId(id),
  };
}

export function normalizeZaiModelsPayload(payload: unknown): ZaiModel[] {
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : null;
  if (!entries) {
    throw new Error(
      "Z.AI model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeZaiModel(entry);
    return model ? [model] : [];
  });
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

async function fetchZaiModels(
  metidos: MetidosPluginApi,
  baseUrl: string,
  apiKey: string | null,
): Promise<ZaiModel[]> {
  if (!apiKey) {
    return STATIC_ZAI_MODELS;
  }
  try {
    const response = await metidos.fetch(`${baseUrl}/models`, {
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
        `Z.AI model discovery returned HTTP ${response.status} ${response.statusText}`,
      );
    }
    return normalizeZaiModelsPayload(await response.json());
  } catch (error) {
    await logWarning(
      metidos,
      `Z.AI model discovery failed; using the built-in fallback catalog: ${error instanceof Error ? error.message : String(error)}`,
    );
    return STATIC_ZAI_MODELS;
  }
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "zai",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const baseUrl = baseUrlForEndpoint(
        endpointMode(metidos.settings.get(ENDPOINT_SETTING)),
      );

      const models = await fetchZaiModels(metidos, baseUrl, apiKey);

      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Z.AI API key is not configured. Set the Z.AI api_key setting or ZAI_API_KEY.",
          authHeader: true,
          baseUrl,
          id: "default",
          label: "Z.AI",
          models: models.map((model) => ({
            compat: MODEL_COMPAT,
            contextWindow: model.contextWindow,
            cost: DEFAULT_COST,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: true,
          })),
          piAuth: PI_AUTH,
        },
      ];
    },
  });

  // Second provider for Coding Plan endpoint
  metidos.providers.addProvider({
    id: "zai_coding_plan",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      // Force endpoint to coding_plan regardless of setting
      const baseUrl = CODING_PLAN_BASE_URL;
      const models = await fetchZaiModels(metidos, baseUrl, apiKey);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Z.AI API key is not configured. Set the Z.AI api_key setting or ZAI_API_KEY.",
          authHeader: true,
          baseUrl,
          id: "default",
          label: "Z.AI Coding Plan",
          models: models.map((model) => ({
            compat: MODEL_COMPAT,
            contextWindow: model.contextWindow,
            cost: DEFAULT_COST,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: true,
          })),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
