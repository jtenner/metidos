import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type AnyscaleModel = {
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

const API_KEY_ENV = "ANYSCALE_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.endpoints.anyscale.com/v1";
const DISCOVERY_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 16_384;
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
} as const;
const NON_CHAT_ID_PARTS = [
  "audio",
  "clip",
  "diffusion",
  "embed",
  "embedding",
  "image",
  "moderation",
  "rerank",
  "sdxl",
  "speech",
  "text-to-image",
  "tts",
  "video",
  "whisper",
];
const NON_CHAT_METADATA_PARTS = [
  "audio",
  "embedding",
  "embeddings",
  "feature-extraction",
  "image-generation",
  "image_generation",
  "moderation",
  "rerank",
  "speech",
  "text-to-image",
  "text_to_image",
  "tts",
  "video-generation",
  "video_generation",
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
    ? value
    : null;
}

function positiveIntegerValue(value: unknown): number | null {
  const normalized = numberValue(value);
  return normalized === null ? null : Math.floor(normalized);
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const values = value.flatMap((entry) => {
    const normalized = stringValue(entry);
    return normalized ? [normalized] : [];
  });
  return values.length > 0 ? values : null;
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function normalizedTextValues(model: Record<string, unknown>): string[] {
  const capabilities = nestedRecord(model, "capabilities");
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.endpoint),
    stringValue(model.object),
    stringValue(model.modality),
    stringValue(model.mode),
    stringValue(model.category),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(capabilities?.type),
    stringValue(capabilities?.task),
    ...(stringArrayValue(model.capabilities) ?? []),
    ...(stringArrayValue(model.endpoints) ?? []),
    ...(stringArrayValue(model.supported_features) ?? []),
    ...(stringArrayValue(model.supportedFeatures) ?? []),
    ...(stringArrayValue(model.supported_input_modalities) ?? []),
    ...(stringArrayValue(model.supportedInputModalities) ?? []),
    ...(stringArrayValue(model.supported_output_modalities) ?? []),
    ...(stringArrayValue(model.supportedOutputModalities) ?? []),
    ...(stringArrayValue(model.input_modalities) ?? []),
    ...(stringArrayValue(model.output_modalities) ?? []),
    ...(stringArrayValue(model.inputModalities) ?? []),
    ...(stringArrayValue(model.outputModalities) ?? []),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function outputModalities(model: Record<string, unknown>): string[] | null {
  return (
    stringArrayValue(model.supported_output_modalities) ??
    stringArrayValue(model.supportedOutputModalities) ??
    stringArrayValue(model.output_modalities) ??
    stringArrayValue(model.outputModalities)
  )?.map((entry) => entry.toLowerCase()) ?? null;
}

function inputModalities(model: Record<string, unknown>): string[] | null {
  return (
    stringArrayValue(model.supported_input_modalities) ??
    stringArrayValue(model.supportedInputModalities) ??
    stringArrayValue(model.input_modalities) ??
    stringArrayValue(model.inputModalities)
  )?.map((entry) => entry.toLowerCase()) ?? null;
}

function supportedInputKinds(model: Record<string, unknown>): ("text" | "image")[] {
  const modalities = inputModalities(model);
  if (!modalities || modalities.length === 0) {
    return ["text"];
  }
  const input = new Set<"text" | "image">();
  if (
    modalities.some((modality) =>
      ["text", "language", "message", "messages", "multimodal"].includes(
        modality,
      ),
    )
  ) {
    input.add("text");
  }
  if (modalities.some((modality) => ["image", "vision"].includes(modality))) {
    input.add("image");
    input.add("text");
  }
  return input.size > 0 ? [...input] : ["text"];
}

function normalizeCost(value: unknown): number {
  if (isRecord(value)) {
    return normalizeCost(value.usd);
  }
  const normalized = numberValue(value);
  return normalized === null ? 0 : normalized;
}

function pricingRecord(model: Record<string, unknown>): Record<string, unknown> | null {
  return nestedRecord(model, "pricing") ?? nestedRecord(model, "price");
}

function normalizeCostField(
  pricing: Record<string, unknown> | null,
  ...keys: string[]
): number {
  for (const key of keys) {
    const value = normalizeCost(pricing?.[key]);
    if (value > 0) {
      return value;
    }
  }
  return 0;
}

function normalizeContextWindow(value: Record<string, unknown>): number {
  const limits = nestedRecord(value, "limits");
  const config = nestedRecord(value, "config");
  return (
    positiveIntegerValue(value.context_length) ??
    positiveIntegerValue(value.contextLength) ??
    positiveIntegerValue(value.context_window) ??
    positiveIntegerValue(value.contextWindow) ??
    positiveIntegerValue(value.max_context_length) ??
    positiveIntegerValue(value.maxContextLength) ??
    positiveIntegerValue(value.max_model_len) ??
    positiveIntegerValue(value.maxModelLen) ??
    positiveIntegerValue(value.max_input_tokens) ??
    positiveIntegerValue(value.maxInputTokens) ??
    positiveIntegerValue(limits?.context_length) ??
    positiveIntegerValue(limits?.contextLength) ??
    positiveIntegerValue(limits?.max_context_length) ??
    positiveIntegerValue(limits?.maxContextLength) ??
    positiveIntegerValue(config?.max_position_embeddings) ??
    positiveIntegerValue(config?.max_sequence_length) ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(value: Record<string, unknown>): number {
  const limits = nestedRecord(value, "limits");
  return (
    positiveIntegerValue(value.max_completion_tokens) ??
    positiveIntegerValue(value.maxCompletionTokens) ??
    positiveIntegerValue(value.max_output_tokens) ??
    positiveIntegerValue(value.maxOutputTokens) ??
    positiveIntegerValue(value.max_output_length) ??
    positiveIntegerValue(value.maxOutputLength) ??
    positiveIntegerValue(value.max_tokens) ??
    positiveIntegerValue(value.maxTokens) ??
    positiveIntegerValue(limits?.max_completion_tokens) ??
    positiveIntegerValue(limits?.maxCompletionTokens) ??
    positiveIntegerValue(limits?.max_output_tokens) ??
    positiveIntegerValue(limits?.maxOutputTokens) ??
    Math.min(normalizeContextWindow(value), DEFAULT_MAX_TOKENS)
  );
}

function titleCaseWords(value: string): string {
  return value.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function modelName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  const displayId = id.split("/").pop() ?? id;
  return titleCaseWords(
    displayId
      .replace(/[._-]/gu, " ")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bmistral\b/giu, "Mistral")
      .replace(/\bmixtral\b/giu, "Mixtral")
      .replace(/\bqwen\b/giu, "Qwen")
      .replace(/\bvl\b/giu, "VL"),
  );
}

function modelSupportsChat(model: Record<string, unknown>, id: string): boolean {
  const object = stringValue(model.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const status = stringValue(model.status)?.toLowerCase();
  if (status && !["active", "available", "enabled", "ready"].includes(status)) {
    return false;
  }
  const normalizedId = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalizedId.includes(part))) {
    return false;
  }
  const outputs = outputModalities(model);
  if (
    outputs &&
    outputs.length > 0 &&
    !outputs.some((modality) =>
      ["text", "language", "message", "messages"].includes(modality),
    )
  ) {
    return false;
  }
  const metadata = normalizedTextValues(model);
  if (metadata.some((entry) => NON_CHAT_METADATA_PARTS.includes(entry))) {
    return false;
  }
  const capabilities = nestedRecord(model, "capabilities");
  const chatCapability =
    booleanValue(capabilities?.chat) ??
    booleanValue(capabilities?.chat_completion) ??
    booleanValue(capabilities?.chatCompletions) ??
    booleanValue(capabilities?.completion_chat) ??
    booleanValue(model.supports_chat_completions) ??
    booleanValue(model.supportsChatCompletions);
  return chatCapability !== false;
}

export function normalizeAnyscaleModel(value: unknown): AnyscaleModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id =
    stringValue(value.id) ??
    stringValue(value.model) ??
    stringValue(value.model_id) ??
    stringValue(value.modelId);
  if (!id || !modelSupportsChat(value, id)) {
    return null;
  }
  const pricing = pricingRecord(value);
  return {
    contextWindow: normalizeContextWindow(value),
    cost: {
      cacheRead: normalizeCostField(
        pricing,
        "cache_read",
        "cacheRead",
        "input_cache_read",
        "inputCacheRead",
      ),
      cacheWrite: normalizeCostField(
        pricing,
        "cache_write",
        "cacheWrite",
        "input_cache_write",
        "inputCacheWrite",
      ),
      input: normalizeCostField(pricing, "prompt", "input", "input_tokens"),
      output: normalizeCostField(
        pricing,
        "completion",
        "output",
        "output_tokens",
      ),
    },
    id,
    input: supportedInputKinds(value),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(
      id,
      stringValue(value.name) ??
        stringValue(value.display_name) ??
        stringValue(value.displayName),
    ),
    reasoning: normalizedTextValues(value).some((entry) =>
      /reason|thinking/u.test(entry),
    ),
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
): Promise<AnyscaleModel[]> {
  if (!apiKey) {
    throw new Error(
      "Anyscale model discovery requires an api_key Plugin Setting or ANYSCALE_API_KEY.",
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
      `Anyscale model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "Anyscale model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeAnyscaleModel(entry);
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
    id: "anyscale",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      let models: AnyscaleModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Anyscale model discovery failed; Anyscale catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Anyscale Endpoints",
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
