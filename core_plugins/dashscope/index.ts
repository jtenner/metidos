import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type DashScopeRegion = "china" | "hong_kong" | "international" | "us";

type DashScopeModel = {
  contextWindow: number;
  id: string;
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
  reasoning: boolean;
  regions?: DashScopeRegion[];
};

type DashScopeEmbeddingModel = {
  contextWindow: number;
  dimensions: number;
  id: string;
  input: ["text"];
  maxTokens: number;
  name: string;
  regions: DashScopeRegion[];
};

const API_KEY_SETTING = "api_key";
const REGION_SETTING = "region";
const DASHSCOPE_API_KEY_ENV = "DASHSCOPE_API_KEY";
const QWEN_API_KEY_ENV = "QWEN_API_KEY";
const PROVIDER_TIMEOUT_MS = 30_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
const API_KEY_SENTINEL = "METIDOS_DASHSCOPE_API_KEY_NOT_CONFIGURED";
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
} as const;
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: DASHSCOPE_API_KEY_ENV },
  { kind: "api_key", source: "env", value: QWEN_API_KEY_ENV },
] as const;

const BASE_URLS: Record<DashScopeRegion, string> = {
  china: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  hong_kong: "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
  international: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  us: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
};

const DASH_SCOPE_MODELS: DashScopeModel[] = [
  {
    contextWindow: 262_144,
    id: "qwen3-max",
    input: ["text"],
    maxTokens: 65_536,
    name: "Qwen3-Max",
    reasoning: true,
    regions: ["china", "hong_kong", "international"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen3.5-plus",
    input: ["text", "image"],
    maxTokens: 65_536,
    name: "Qwen3.5-Plus",
    reasoning: true,
    regions: ["china", "international"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen3.5-flash",
    input: ["text", "image"],
    maxTokens: 65_536,
    name: "Qwen3.5-Flash",
    reasoning: true,
    regions: ["china", "hong_kong", "international"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen-plus",
    input: ["text", "image"],
    maxTokens: 8_192,
    name: "Qwen-Plus",
    reasoning: false,
    regions: ["china", "hong_kong", "international"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen-flash",
    input: ["text", "image"],
    maxTokens: 8_192,
    name: "Qwen-Flash",
    reasoning: false,
    regions: ["china", "international"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen-plus-us",
    input: ["text"],
    maxTokens: 8_192,
    name: "Qwen-Plus US",
    reasoning: false,
    regions: ["us"],
  },
  {
    contextWindow: 1_000_000,
    id: "qwen-flash-us",
    input: ["text"],
    maxTokens: 8_192,
    name: "Qwen-Flash US",
    reasoning: false,
    regions: ["us"],
  },
];

const DASH_SCOPE_EMBEDDING_MODELS: DashScopeEmbeddingModel[] = [
  {
    contextWindow: 8_192,
    dimensions: 1_024,
    id: "text-embedding-v4",
    input: ["text"],
    maxTokens: 8_192,
    name: "Text Embedding V4",
    regions: ["china", "hong_kong", "international"],
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
    stringValue(metidos.env.get(DASHSCOPE_API_KEY_ENV)) ??
    stringValue(metidos.env.get(QWEN_API_KEY_ENV))
  );
}

export function dashScopeRegion(value: unknown): DashScopeRegion {
  return value === "china" || value === "hong_kong" || value === "us"
    ? value
    : "international";
}

export function dashScopeBaseUrl(region: DashScopeRegion): string {
  return BASE_URLS[region];
}

export function dashScopeModelsForRegion(
  region: DashScopeRegion,
): DashScopeModel[] {
  return DASH_SCOPE_MODELS.filter(
    (model) => !model.regions || model.regions.includes(region),
  );
}

export function dashScopeEmbeddingModelsForRegion(
  region: DashScopeRegion,
): DashScopeEmbeddingModel[] {
  return DASH_SCOPE_EMBEDDING_MODELS.filter((model) =>
    model.regions.includes(region),
  );
}

function textEmbeddingInput(value: unknown): string | readonly string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  ) {
    return value as readonly string[];
  }
  throw new Error("DashScope embeddings require non-empty text input.");
}

function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("DashScope embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "DashScope embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstEmbeddingFromDashScopeResponse(
  value: unknown,
): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("DashScope embedding response was not an object.");
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("DashScope embedding response did not include data.");
  }
  const first = data[0];
  if (!isRecord(first)) {
    throw new Error("DashScope embedding response item was invalid.");
  }
  return normalizeEmbeddingVector(first.embedding);
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "dashscope",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const region = dashScopeRegion(metidos.settings.get(REGION_SETTING));

      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "DashScope API key is not configured. Set the DashScope api_key setting, DASHSCOPE_API_KEY, or QWEN_API_KEY.",
          authHeader: true,
          baseUrl: dashScopeBaseUrl(region),
          id: region,
          label: `Alibaba Cloud Model Studio (${region.replace("_", " ")})`,
          models: dashScopeModelsForRegion(region).map((model) => ({
            compat: MODEL_COMPAT,
            contextWindow: model.contextWindow,
            cost: DEFAULT_COST,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: model.reasoning,
          })),
          piAuth: PI_AUTH,
        },
      ];
    },
  });

  metidos.providers.addProvider({
    id: "dashscope_embeddings",
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredApiKey(metidos);
      if (!apiKey) {
        throw new Error(
          "DashScope embeddings require an api_key Plugin Setting, DASHSCOPE_API_KEY, or QWEN_API_KEY.",
        );
      }
      const region = dashScopeRegion(metidos.settings.get(REGION_SETTING));
      if (dashScopeEmbeddingModelsForRegion(region).length === 0) {
        throw new Error(
          "DashScope embeddings are not enabled for the configured region.",
        );
      }
      const modelId = stringValue(request.model.id);
      if (!modelId) {
        throw new Error("DashScope embeddings require a model id.");
      }
      const response = await metidos.fetch(
        `${dashScopeBaseUrl(region)}/embeddings`,
        {
          body: JSON.stringify({
            input: textEmbeddingInput(request.input),
            model: modelId,
            ...(request.options && typeof request.options === "object"
              ? request.options
              : {}),
          }),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error(
          `DashScope embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromDashScopeResponse(await response.json());
    },
    async getProviderConfigurations() {
      const region = dashScopeRegion(metidos.settings.get(REGION_SETTING));
      return [
        {
          id: region,
          label: `Alibaba Cloud Model Studio Embeddings (${region.replace("_", " ")})`,
          models: dashScopeEmbeddingModelsForRegion(region).map((model) => ({
            api: "embeddings",
            compat: { providesEmbeddings: true },
            contextWindow: model.contextWindow,
            cost: DEFAULT_COST,
            dimensions: model.dimensions,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: false,
          })),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
