import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type InflectionModel = {
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
  reasoning: boolean;
};

const API_KEY_ENV = "INFLECTION_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.inflection.ai/v1";
const DISCOVERY_CONFIGS_URL = `${BASE_URL}/discovery/configs`;
const EMBEDDINGS_URL = `${BASE_URL}/embeddings`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_EMBEDDING_CONTEXT_WINDOW = 8_192;
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

export const INFLECTION_STATIC_CHAT_MODELS: readonly InflectionModel[] = [
  {
    api: "openai-completions",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    cost: DEFAULT_COST,
    id: "inflection_3_pi",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Inflection Pi 3.0",
    reasoning: false,
  },
  {
    api: "openai-completions",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    cost: DEFAULT_COST,
    id: "inflection_3_productivity",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Inflection Productivity 3.0",
    reasoning: false,
  },
  {
    api: "openai-completions",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    cost: DEFAULT_COST,
    id: "Pi-3.1",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Inflection Pi 3.1 Preview",
    reasoning: true,
  },
];

export const INFLECTION_EMBEDDING_MODELS: readonly InflectionModel[] = [
  {
    api: "embeddings",
    contextWindow: DEFAULT_EMBEDDING_CONTEXT_WINDOW,
    cost: DEFAULT_COST,
    id: "inf_3_1_embedding",
    input: ["text"],
    maxTokens: DEFAULT_EMBEDDING_CONTEXT_WINDOW,
    name: "Inflection 3.1 Embedding",
    reasoning: false,
  },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function positiveIntegerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = stringValue(entry);
        return normalized ? [normalized] : [];
      })
    : [];
}

function numberArrayValue(value: unknown): number[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized =
          typeof entry === "number" ? entry : Number(stringValue(entry));
        return Number.isFinite(normalized) && normalized > 0
          ? [Math.floor(normalized)]
          : [];
      })
    : [];
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function nestedParameterValue(
  value: Record<string, unknown> | null,
  key: string,
): number | null {
  const parameter = value ? nestedRecord(value, key) : null;
  const range = numberArrayValue(parameter?.range);
  return (
    positiveIntegerValue(parameter?.value) ??
    positiveIntegerValue(parameter?.default) ??
    (range.length > 0 ? Math.max(...range) : null)
  );
}

function titleCaseWords(value: string): string {
  return value.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function modelName(id: string, alias: string | null): string {
  if (alias) {
    return alias;
  }
  return titleCaseWords(
    id
      .replace(/[._-]/gu, " ")
      .replace(/\bai\b/giu, "AI")
      .replace(/\bapi\b/giu, "API"),
  );
}

function modelConfiguration(model: InflectionModel): Record<string, unknown> {
  return {
    api: model.api,
    compat: {
      providesEmbeddings: model.api === "embeddings",
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

function dedupeModels(models: readonly InflectionModel[]): InflectionModel[] {
  const seen = new Set<string>();
  const deduped: InflectionModel[] = [];
  for (const model of models) {
    const key = model.id.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(model);
  }
  return deduped;
}

export function normalizeInflectionConfig(
  value: unknown,
): InflectionModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id =
    stringValue(value.name) ??
    stringValue(value.model) ??
    stringValue(value.id) ??
    stringValue(value.config);
  if (!id) {
    return null;
  }
  const defaults = nestedRecord(value, "default_parameters");
  const maxTokens =
    nestedParameterValue(defaults, "maximumLength") ??
    nestedParameterValue(defaults, "max_tokens") ??
    positiveIntegerValue(value.max_tokens) ??
    positiveIntegerValue(value.maxTokens) ??
    DEFAULT_MAX_TOKENS;
  return {
    api: "openai-completions",
    contextWindow:
      positiveIntegerValue(value.context_window) ??
      positiveIntegerValue(value.contextWindow) ??
      Math.max(DEFAULT_CONTEXT_WINDOW, maxTokens),
    cost: DEFAULT_COST,
    id,
    input: ["text"],
    maxTokens,
    name: modelName(
      id,
      stringValue(value.alias) ?? stringValue(value.display_name),
    ),
    reasoning:
      /(?:^|[-_])(?:pi[-_]?3[._-]?1|3[._-]?1|reason|preview)(?:[-_]|$)/iu.test(
        id,
      ),
  };
}

export function textEmbeddingInput(value: unknown): string | readonly string[] {
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
  throw new Error("Inflection embeddings require non-empty text input.");
}

export function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Inflection embedding response did not include a vector.");
  }
  return value.map((entry) => {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      throw new Error(
        "Inflection embedding response contained a non-finite number.",
      );
    }
    return entry;
  });
}

export function firstEmbeddingFromInflectionResponse(
  value: unknown,
): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("Inflection embedding response was not an object.");
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Inflection embedding response did not include data.");
  }
  const first = data[0];
  if (!isRecord(first)) {
    throw new Error("Inflection embedding response item was invalid.");
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

async function discoverConfigs(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<InflectionModel[]> {
  if (!apiKey) {
    return [];
  }
  const response = await metidos.fetch(DISCOVERY_CONFIGS_URL, {
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
      `Inflection config discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.data)
      ? payload.data
      : isRecord(payload) && Array.isArray(payload.configs)
        ? payload.configs
        : null;
  if (!entries) {
    throw new Error(
      "Inflection config discovery response did not include a config array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeInflectionConfig(entry);
    return model ? [model] : [];
  });
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "inflection",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      let discoveredModels: InflectionModel[] = [];
      try {
        discoveredModels = await discoverConfigs(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Inflection config discovery failed; using the documented static catalog until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Inflection AI",
          models: dedupeModels([
            ...discoveredModels,
            ...INFLECTION_STATIC_CHAT_MODELS,
          ]).map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });

  metidos.providers.addProvider({
    id: "inflection_embeddings",
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredApiKey(metidos);
      if (!apiKey) {
        throw new Error(
          "Inflection embeddings require an api_key Plugin Setting or INFLECTION_API_KEY.",
        );
      }
      const modelId = stringValue(request.model.id);
      if (!modelId) {
        throw new Error("Inflection embeddings require a model id.");
      }
      const response = await metidos.fetch(EMBEDDINGS_URL, {
        body: JSON.stringify({
          input: textEmbeddingInput(request.input),
          model: modelId,
        }),
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `Inflection embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromInflectionResponse(await response.json());
    },
    getProviderConfigurations() {
      return [
        {
          id: "default",
          label: "Inflection AI Embeddings",
          models: INFLECTION_EMBEDDING_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
