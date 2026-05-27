import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type OllamaModel = { id: string; name: string };

const BASE_URL_ENV = "OLLAMA_BASE_URL";
const API_KEY_ENV = "OLLAMA_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL_SETTING = "base_url";
const DEFAULT_BASE_URL = "http://localhost:11434";
const REFRESH_INTERVAL_MS = 60_000;
const NO_DISCOVERED_MODELS: OllamaModel[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredBaseUrl(metidos: MetidosPluginApi): string {
  const raw =
    stringValue(metidos.settings.get(BASE_URL_SETTING)) ??
    stringValue(metidos.env.get(BASE_URL_ENV)) ??
    DEFAULT_BASE_URL;
  return raw.replace(/\/+$/u, "");
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function configuredUserGlobalOrEnvApiKey(
  metidos: MetidosPluginApi,
): string | null {
  return configuredApiKey(metidos);
}

function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Ollama embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "Ollama embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

function firstEmbeddingFromResponse(value: unknown): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("Ollama embedding response was not an object.");
  }
  if (Array.isArray(value.embedding)) {
    return normalizeEmbeddingVector(value.embedding);
  }
  if (Array.isArray(value.embeddings) && value.embeddings.length > 0) {
    return normalizeEmbeddingVector(value.embeddings[0]);
  }
  throw new Error("Ollama embedding response did not include embeddings.");
}

function normalizeOpenAIModel(value: unknown): OllamaModel | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  return id ? { id, name: stringValue(value.name) ?? id } : null;
}

function normalizeTagModel(value: unknown): OllamaModel | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.model) ?? stringValue(value.name);
  if (!id) return null;
  return { id, name: stringValue(value.name) ?? id };
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

async function fetchModelsFromOpenAIEndpoint(
  metidos: MetidosPluginApi,
  baseUrl: string,
  apiKey: string | null,
): Promise<OllamaModel[]> {
  const response = await metidos.fetch(`${baseUrl}/v1/models`, {
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Ollama /v1/models discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  return isRecord(payload) && Array.isArray(payload.data)
    ? payload.data.flatMap((entry) => {
        const model = normalizeOpenAIModel(entry);
        return model ? [model] : [];
      })
    : [];
}

async function fetchModelsFromTagsEndpoint(
  metidos: MetidosPluginApi,
  baseUrl: string,
  apiKey: string | null,
): Promise<OllamaModel[]> {
  const response = await metidos.fetch(`${baseUrl}/api/tags`, {
    ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `Ollama /api/tags discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  return isRecord(payload) && Array.isArray(payload.models)
    ? payload.models.flatMap((entry) => {
        const model = normalizeTagModel(entry);
        return model ? [model] : [];
      })
    : [];
}

async function discoverModels(
  metidos: MetidosPluginApi,
  baseUrl: string,
  apiKey: string | null,
): Promise<OllamaModel[]> {
  try {
    const tagModels = await fetchModelsFromTagsEndpoint(
      metidos,
      baseUrl,
      apiKey,
    );
    if (tagModels.length > 0) return tagModels;
    await logWarning(
      metidos,
      "Ollama /api/tags discovery returned no models; trying /v1/models.",
    );
  } catch (error) {
    await logWarning(
      metidos,
      `Ollama /api/tags discovery failed; trying /v1/models: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const openAiModels = await fetchModelsFromOpenAIEndpoint(
      metidos,
      baseUrl,
      apiKey,
    );
    if (openAiModels.length > 0) return openAiModels;
  } catch (error) {
    await logWarning(
      metidos,
      `Ollama /v1/models discovery failed; no models discovered: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NO_DISCOVERED_MODELS;
  }

  await logWarning(
    metidos,
    "Ollama /v1/models discovery returned no models; no models discovered.",
  );
  return NO_DISCOVERED_MODELS;
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "ollama",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: 30_000,
    async embed(_context, request) {
      const baseUrl = configuredBaseUrl(metidos);
      const apiKey = configuredUserGlobalOrEnvApiKey(metidos);
      const response = await metidos.fetch(`${baseUrl}/api/embed`, {
        body: JSON.stringify({
          input: request.input,
          model: request.model.id,
          ...(request.options && typeof request.options === "object"
            ? request.options
            : {}),
        }),
        ...(apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {}),
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `Ollama /api/embed returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromResponse(await response.json());
    },
    async getProviderConfigurations() {
      const baseUrl = configuredBaseUrl(metidos);
      const apiKey = configuredApiKey(metidos);
      return [
        {
          api: "openai-completions",
          ...(apiKey ? { apiKey, authHeader: true } : {}),
          baseUrl: `${baseUrl}/v1`,
          id: "default",
          label: "Ollama",
          piAuth: [
            {
              kind: "api_key",
              source: "setting",
              value: API_KEY_SETTING,
            },
            { kind: "api_key", source: "env", value: API_KEY_ENV },
          ],
          models: (await discoverModels(metidos, baseUrl, apiKey)).map(
            (model) => ({
              api: "openai-completions",
              compat: {
                providesEmbeddings: true,
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
              },
              contextWindow: 131_072,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: model.id,
              input: ["text"],
              maxTokens: 8192,
              name: model.name,
              reasoning: false,
            }),
          ),
        },
      ];
    },
  });
});
