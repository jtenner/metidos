import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type YiModel = {
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

const API_KEY_SETTING = "api_key";
const YI_API_KEY_ENV = "YI_API_KEY";
const LINGYI_API_KEY_ENV = "LINGYI_API_KEY";
const BASE_URL = "https://api.01.ai/v1";
const DISCOVERY_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_000;
const DEFAULT_MAX_TOKENS = 4_096;
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
  "moderation",
  "rerank",
  "tts",
  "whisper",
];
const KNOWN_MODEL_METADATA: Record<
  string,
  { contextWindow: number; input: ("text" | "image")[]; name: string }
> = {
  "yi-large": {
    contextWindow: 32_000,
    input: ["text"],
    name: "Yi Large",
  },
  "yi-large-fc": {
    contextWindow: 32_000,
    input: ["text"],
    name: "Yi Large FC",
  },
  "yi-large-turbo": {
    contextWindow: 4_000,
    input: ["text"],
    name: "Yi Large Turbo",
  },
  "yi-vision": {
    contextWindow: 16_000,
    input: ["text", "image"],
    name: "Yi Vision",
  },
};

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

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(YI_API_KEY_ENV)) ??
    stringValue(metidos.env.get(LINGYI_API_KEY_ENV))
  );
}

function titleCaseWords(value: string): string {
  return value.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function modelName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  return (
    KNOWN_MODEL_METADATA[id]?.name ??
    titleCaseWords(
      id
        .replace(/[-_]/gu, " ")
        .replace(/\bai\b/giu, "AI")
        .replace(/\bapi\b/giu, "API")
        .replace(/\bfc\b/giu, "FC")
        .replace(/\byi\b/giu, "Yi"),
    )
  );
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

function normalizedMetadata(model: Record<string, unknown>): string[] {
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.model_type),
    stringValue(model.modelType),
    stringValue(model.object),
    ...(stringArrayValue(model.endpoints) ?? []),
    ...(stringArrayValue(model.supported_features) ?? []),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function isChatModel(model: Record<string, unknown>, id: string): boolean {
  const normalizedId = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalizedId.includes(part))) {
    return false;
  }
  const object = stringValue(model.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const status = stringValue(model.status)?.toLowerCase();
  if (status && !["active", "available", "enabled"].includes(status)) {
    return false;
  }
  return !normalizedMetadata(model).some((entry) =>
    ["embedding", "embeddings", "moderation", "rerank"].includes(entry),
  );
}

function modelInput(
  model: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const known = KNOWN_MODEL_METADATA[id]?.input;
  if (known) {
    return known;
  }
  const metadata = normalizedMetadata(model);
  const supportsVision =
    model.supports_image_in === true ||
    model.image_input === true ||
    metadata.some((entry) =>
      ["image", "image-input", "image_input", "vision"].includes(entry),
    ) ||
    /(?:vision|vl|multimodal)/iu.test(id);
  return supportsVision ? ["text", "image"] : ["text"];
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function normalizeContextWindow(
  value: Record<string, unknown>,
  id: string,
): number {
  const limits = nestedRecord(value, "limits");
  return (
    numberValue(value.context_length) ??
    numberValue(value.contextLength) ??
    numberValue(value.context_window) ??
    numberValue(value.contextWindow) ??
    numberValue(value.max_context_length) ??
    numberValue(value.maxContextLength) ??
    numberValue(value.max_context_tokens) ??
    numberValue(value.maxContextTokens) ??
    numberValue(limits?.context_length) ??
    numberValue(limits?.contextLength) ??
    numberValue(limits?.max_context_length) ??
    numberValue(limits?.maxContextLength) ??
    KNOWN_MODEL_METADATA[id]?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(value: Record<string, unknown>): number {
  const limits = nestedRecord(value, "limits");
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

export function normalizeYiModel(value: unknown): YiModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id =
    stringValue(value.id) ??
    stringValue(value.model) ??
    stringValue(value.name);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value, id),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(
      id,
      stringValue(value.display_name) ?? stringValue(value.displayName),
    ),
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
): Promise<YiModel[]> {
  if (!apiKey) {
    throw new Error(
      "01.AI model discovery requires a api_key Plugin Setting, YI_API_KEY, or LINGYI_API_KEY.",
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
      `01.AI model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "01.AI model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeYiModel(entry);
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
    { kind: "api_key", source: "env", value: YI_API_KEY_ENV },
    { kind: "api_key", source: "env", value: LINGYI_API_KEY_ENV },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "yi",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: YiModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `01.AI model discovery failed; Yi catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "01.AI Yi",
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
