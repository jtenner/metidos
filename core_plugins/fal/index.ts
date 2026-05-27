import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type FalModel = {
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

const API_KEY_ENV = "FAL_KEY";
const API_KEY_SETTING = "api_key";
const API_KEY_SENTINEL = "METIDOS_FAL_KEY_NOT_CONFIGURED";
const BASE_URL = "https://fal.run/openrouter/router/openai/v1";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_TOKENS = 16_384;
const COST_PER_TOKEN_TO_PER_MILLION = 1_000_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumberValue(value: unknown): number | null {
  const normalized = numberValue(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function architectureForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.architecture) ? model.architecture : null;
}

function modelInputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return stringArrayValue(architecture?.input_modalities).map((modality) =>
    modality.toLowerCase(),
  );
}

function modelOutputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return stringArrayValue(architecture?.output_modalities).map((modality) =>
    modality.toLowerCase(),
  );
}

function modelSupportsImageInput(model: Record<string, unknown>): boolean {
  const inputModalities = modelInputModalities(model);
  if (inputModalities.some((modality) => modality === "image")) {
    return true;
  }
  const architecture = architectureForModel(model);
  const modality = stringValue(architecture?.modality)?.toLowerCase() ?? null;
  return modality?.includes("image") ?? false;
}

function modelSupportsTextOutput(model: Record<string, unknown>): boolean {
  const outputModalities = modelOutputModalities(model);
  return outputModalities.length === 0 || outputModalities.includes("text");
}

function modelSupportsReasoning(model: Record<string, unknown>): boolean {
  const supportedParameters = stringArrayValue(model.supported_parameters);
  return supportedParameters.some((parameter) =>
    /reason|thinking/u.test(parameter.toLowerCase()),
  );
}

export function openRouterCostValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value * COST_PER_TOKEN_TO_PER_MILLION;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const normalized = Number.parseFloat(value.trim());
  return Number.isFinite(normalized) && normalized >= 0
    ? normalized * COST_PER_TOKEN_TO_PER_MILLION
    : 0;
}

function modelDisplayName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  return id
    .split("/")
    .map((part) =>
      part
        .replace(/[._-]/gu, " ")
        .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase()),
    )
    .join(" / ");
}

export function normalizeFalModel(value: unknown): FalModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id || !modelSupportsTextOutput(value)) {
    return null;
  }
  const outputModalities = modelOutputModalities(value);
  if (outputModalities.some((modality) => modality.includes("embedding"))) {
    return null;
  }
  const contextWindow =
    positiveNumberValue(value.context_length) ?? DEFAULT_MAX_TOKENS;
  const topProvider = isRecord(value.top_provider) ? value.top_provider : null;
  const maxTokens =
    positiveNumberValue(topProvider?.max_completion_tokens) ?? contextWindow;
  const pricing = isRecord(value.pricing) ? value.pricing : null;
  return {
    contextWindow,
    cost: {
      cacheRead: openRouterCostValue(pricing?.cache_read),
      cacheWrite: openRouterCostValue(pricing?.cache_write),
      input: openRouterCostValue(pricing?.prompt),
      output: openRouterCostValue(pricing?.completion),
    },
    id,
    input: modelSupportsImageInput(value) ? ["text", "image"] : ["text"],
    maxTokens,
    name: modelDisplayName(id, stringValue(value.name)),
    reasoning: modelSupportsReasoning(value),
  };
}

function modelsFromPayload(payload: unknown): unknown[] {
  return isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
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
): Promise<FalModel[]> {
  if (!apiKey) {
    throw new Error(
      "fal.ai model discovery requires an api_key Plugin Setting or FAL_KEY.",
    );
  }
  const response = await metidos.fetch(MODELS_URL, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `fal.ai OpenRouter model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const models = modelsFromPayload(await response.json()).flatMap((entry) => {
    const model = normalizeFalModel(entry);
    return model ? [model] : [];
  });
  if (models.length === 0) {
    throw new Error("fal.ai OpenRouter model discovery returned no chat models.");
  }
  return models;
}

export function falAuthHeaders(
  apiKey: string | null,
): Record<string, string> | undefined {
  return apiKey ? { Authorization: `Key ${apiKey}` } : undefined;
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

function modelConfiguration(model: FalModel): Record<string, unknown> {
  return {
    api: "openai-completions",
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
    id: "fal",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      const headers = falAuthHeaders(apiKey);
      let models: FalModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `fal.ai model discovery failed; fal.ai catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "fal.ai API key is not configured. Set the fal.ai api_key setting or FAL_KEY.",
          authHeader: false,
          baseUrl: BASE_URL,
          ...(headers ? { headers } : {}),
          id: "default",
          label: "fal.ai OpenRouter",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
