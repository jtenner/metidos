import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

import {
  firstEmbeddingFromResponse,
  isRecord,
  normalizeChatModel,
  normalizeEmbeddingModel,
  stringValue,
  type OpenRouterModel,
} from "./openrouter-models";

const API_KEY_ENV = "OPENROUTER_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://openrouter.ai/api/v1";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 120_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function configuredUserGlobalOrEnvApiKey(
  metidos: MetidosPluginApi,
): string | null {
  return configuredGlobalOrEnvApiKey(metidos);
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
  path: string,
  apiKey: string | null,
): Promise<unknown[]> {
  const response = await metidos.fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(apiKey),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error(
      "OpenRouter model discovery response did not include a data array.",
    );
  }
  return payload.data;
}

async function discoverChatModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<OpenRouterModel[]> {
  const data = await fetchModelCatalog(metidos, "/models", apiKey);
  return data.flatMap((entry) => {
    const model = normalizeChatModel(entry);
    return model ? [model] : [];
  });
}

async function discoverEmbeddingModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<OpenRouterModel[]> {
  let data: unknown[] | null = null;
  let assumeEmbeddingModels = false;
  if (apiKey) {
    try {
      data = await fetchModelCatalog(metidos, "/embeddings/models", apiKey);
      assumeEmbeddingModels = true;
    } catch (error) {
      await logWarning(
        metidos,
        `OpenRouter embedding model discovery failed through /embeddings/models; trying filtered /models discovery: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  if (!data) {
    data = await fetchModelCatalog(
      metidos,
      "/models?output_modalities=embeddings",
      apiKey,
    );
  }
  return data.flatMap((entry) => {
    const model = normalizeEmbeddingModel(entry, {
      assumeEmbedding: assumeEmbeddingModels,
    });
    return model ? [model] : [];
  });
}

function modelConfiguration(model: OpenRouterModel): Record<string, unknown> {
  return {
    api: model.api,
    compat: {
      providesEmbeddings: model.api === "embeddings",
      ...(model.output.includes("image")
        ? {
            openRouterImageOnly: !model.output.includes("text"),
            openRouterImageOutput: true,
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
    id: "openrouter",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: OpenRouterModel[] = [];
      try {
        models = await discoverChatModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `OpenRouter model discovery failed; OpenRouter catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "OpenRouter",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });

  metidos.providers.addProvider({
    id: "openrouter_embeddings",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredUserGlobalOrEnvApiKey(metidos);
      if (!apiKey) {
        throw new Error("OpenRouter embeddings require an OpenRouter API key.");
      }
      const response = await metidos.fetch(`${BASE_URL}/embeddings`, {
        body: JSON.stringify({
          input: request.input,
          model: request.model.id,
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
          `OpenRouter embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromResponse(await response.json());
    },
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: OpenRouterModel[] = [];
      try {
        models = await discoverEmbeddingModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `OpenRouter embedding model discovery failed; OpenRouter embeddings will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          id: "default",
          label: "OpenRouter Embeddings",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
