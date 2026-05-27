import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type TheRouterModel = {
  api: "embeddings" | "openai-completions";
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
  output: ("text" | "image")[];
  reasoning: boolean;
};

const API_KEY_ENV = "THEROUTER_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.therouter.ai/v1";
const MODELS_URL = `${BASE_URL}/models`;
const EMBEDDINGS_URL = `${BASE_URL}/embeddings`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 120_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
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

export function costValue(value: unknown): number {
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

function modelSupportsReasoning(model: Record<string, unknown>): boolean {
  const supportedParameters = stringArrayValue(model.supported_parameters);
  return supportedParameters.some((parameter) =>
    /reason|thinking/u.test(parameter.toLowerCase()),
  );
}

function modelSupportsEmbeddings(model: Record<string, unknown>): boolean {
  const id = stringValue(model.id)?.toLowerCase() ?? "";
  return (
    /(?:^|[\/_-])embed(?:ding|dings)?(?:$|[\/_-])/u.test(id) ||
    modelOutputModalities(model).some((modality) =>
      modality.includes("embedding"),
    )
  );
}

function modelOutputKinds(
  model: Record<string, unknown>,
): ("text" | "image")[] {
  const outputModalities = modelOutputModalities(model);
  const output = new Set<"text" | "image">();
  if (outputModalities.length === 0 || outputModalities.includes("text")) {
    output.add("text");
  }
  if (outputModalities.includes("image")) {
    output.add("image");
  }
  return [...output];
}

function normalizeModel(
  value: unknown,
  api: TheRouterModel["api"],
): TheRouterModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const name = stringValue(value.name) ?? id;
  const contextWindow =
    positiveNumberValue(value.context_length) ?? DEFAULT_MAX_TOKENS;
  const topProvider = isRecord(value.top_provider) ? value.top_provider : null;
  const maxTokens =
    positiveNumberValue(topProvider?.max_completion_tokens) ?? contextWindow;
  const pricing = isRecord(value.pricing) ? value.pricing : null;
  const supportsImageInput = modelSupportsImageInput(value);
  const output = modelOutputKinds(value);
  return {
    api,
    contextWindow,
    cost: {
      cacheRead: costValue(pricing?.cache_read),
      cacheWrite: costValue(pricing?.cache_write),
      input: costValue(pricing?.prompt),
      output: costValue(pricing?.completion),
    },
    id,
    input: supportsImageInput ? ["text", "image"] : ["text"],
    maxTokens,
    name,
    output,
    reasoning: api === "openai-completions" && modelSupportsReasoning(value),
  };
}

export function normalizeTheRouterChatModel(
  value: unknown,
): TheRouterModel | null {
  if (!isRecord(value) || modelSupportsEmbeddings(value)) {
    return null;
  }
  const output = modelOutputKinds(value);
  if (output.length === 0) {
    return null;
  }
  return normalizeModel(value, "openai-completions");
}

export function normalizeTheRouterEmbeddingModel(
  value: unknown,
): TheRouterModel | null {
  if (!isRecord(value) || !modelSupportsEmbeddings(value)) {
    return null;
  }
  return normalizeModel(value, "embeddings");
}

export function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("TheRouter embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "TheRouter embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

export function firstEmbeddingFromTheRouterResponse(
  value: unknown,
): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("TheRouter embedding response was not an object.");
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("TheRouter embedding response did not include data.");
  }
  const first = data[0];
  if (!isRecord(first)) {
    throw new Error("TheRouter embedding response item was invalid.");
  }
  return normalizeEmbeddingVector(first.embedding);
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

function authHeaders(apiKey: string | null): Record<string, string> {
  return {
    Accept: "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
}

async function fetchModelCatalog(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<unknown[]> {
  if (!apiKey) {
    throw new Error(
      "TheRouter model discovery requires a api_key Plugin Setting or THEROUTER_API_KEY.",
    );
  }
  const response = await metidos.fetch(MODELS_URL, {
    headers: authHeaders(apiKey),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `TheRouter model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error(
      "TheRouter model discovery response did not include a data array.",
    );
  }
  return payload.data;
}

async function discoverChatModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<TheRouterModel[]> {
  const data = await fetchModelCatalog(metidos, apiKey);
  return data.flatMap((entry) => {
    const model = normalizeTheRouterChatModel(entry);
    return model ? [model] : [];
  });
}

async function discoverEmbeddingModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<TheRouterModel[]> {
  const data = await fetchModelCatalog(metidos, apiKey);
  return data.flatMap((entry) => {
    const model = normalizeTheRouterEmbeddingModel(entry);
    return model ? [model] : [];
  });
}

function modelConfiguration(model: TheRouterModel): Record<string, unknown> {
  return {
    api: model.api,
    compat: {
      providesEmbeddings: model.api === "embeddings",
      ...(model.output.includes("image")
        ? {
            theRouterImageOnly: !model.output.includes("text"),
            theRouterImageOutput: true,
          }
        : {}),
    },
    contextWindow: model.contextWindow,
    cost: model.cost,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
  };
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
    id: "therouter",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: TheRouterModel[] = [];
      try {
        models = await discoverChatModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `TheRouter model discovery failed; TheRouter catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "TheRouter",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });

  metidos.providers.addProvider({
    id: "therouter_embeddings",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      if (!apiKey) {
        throw new Error(
          "TheRouter embeddings require an api_key Plugin Setting or THEROUTER_API_KEY.",
        );
      }
      const response = await metidos.fetch(EMBEDDINGS_URL, {
        body: JSON.stringify({
          input: request.input,
          model: stringValue(request.model.id),
          ...(request.options && typeof request.options === "object"
            ? request.options
            : {}),
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `TheRouter embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromTheRouterResponse(await response.json());
    },
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: TheRouterModel[] = [];
      try {
        models = await discoverEmbeddingModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `TheRouter embedding model discovery failed; TheRouter embeddings will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          id: "default",
          label: "TheRouter Embeddings",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
