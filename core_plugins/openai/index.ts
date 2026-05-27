import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_ENV = "OPENAI_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.openai.com/v1";
const EMBEDDING_MODELS = [
  {
    contextWindow: 8191,
    id: "text-embedding-3-small",
    name: "Text Embedding 3 Small",
  },
  {
    contextWindow: 8191,
    id: "text-embedding-3-large",
    name: "Text Embedding 3 Large",
  },
] as const;

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

function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("OpenAI embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "OpenAI embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

function firstEmbeddingFromResponse(value: unknown): readonly number[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OpenAI embedding response was not an object.");
  }
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("OpenAI embedding response did not include data.");
  }
  const first = data[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) {
    throw new Error("OpenAI embedding response item was invalid.");
  }
  return normalizeEmbeddingVector((first as Record<string, unknown>).embedding);
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "openai_embeddings",
    refreshIntervalMs: 10 * 60_000,
    timeoutMs: 30_000,
    async embed(_context, request) {
      const apiKey = configuredApiKey(metidos);
      if (!apiKey) {
        throw new Error("OpenAI embeddings require an OpenAI API key.");
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
          `OpenAI embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromResponse(await response.json());
    },
    getProviderConfigurations() {
      return [
        {
          id: "default",
          label: "OpenAI Embeddings",
          models: EMBEDDING_MODELS.map((model) => ({
            api: "embeddings",
            compat: { providesEmbeddings: true },
            contextWindow: model.contextWindow,
            cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
            id: model.id,
            input: ["text"],
            maxTokens: model.contextWindow,
            name: model.name,
            reasoning: false,
          })),
          piAuth: [
            {
              kind: "api_key",
              source: "setting",
              value: API_KEY_SETTING,
            },
            { kind: "api_key", source: "env", value: API_KEY_ENV },
          ],
        },
      ];
    },
  });
});
