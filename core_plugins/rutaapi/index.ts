import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type RutaApiModel = {
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

const API_KEY_ENV = "RUTAAPI_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.rutaapi.com/v1";
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
  supportsDeveloperRole: false,
  supportsStore: false,
} as const;
const NON_CHAT_ID_PARTS = [
  "audio",
  "diffusion",
  "embed",
  "embedding",
  "image-generation",
  "moderation",
  "rerank",
  "speech",
  "tts",
  "video-generation",
  "whisper",
];
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;

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

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
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
      ["text", "language", "messages", "multimodal"].includes(modality),
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
  return (
    positiveIntegerValue(value.context_length) ??
    positiveIntegerValue(value.contextLength) ??
    positiveIntegerValue(value.context_window) ??
    positiveIntegerValue(value.contextWindow) ??
    positiveIntegerValue(value.max_context_length) ??
    positiveIntegerValue(value.maxContextLength) ??
    positiveIntegerValue(value.max_input_tokens) ??
    positiveIntegerValue(value.maxInputTokens) ??
    positiveIntegerValue(limits?.context_length) ??
    positiveIntegerValue(limits?.contextLength) ??
    positiveIntegerValue(limits?.max_context_length) ??
    positiveIntegerValue(limits?.maxContextLength) ??
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
    positiveIntegerValue(value.max_tokens) ??
    positiveIntegerValue(value.maxTokens) ??
    positiveIntegerValue(limits?.max_completion_tokens) ??
    positiveIntegerValue(limits?.maxCompletionTokens) ??
    positiveIntegerValue(limits?.max_output_tokens) ??
    positiveIntegerValue(limits?.maxOutputTokens) ??
    Math.min(normalizeContextWindow(value), DEFAULT_MAX_TOKENS)
  );
}

function modelName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  const cleaned = id
    .split("/")
    .pop()
    ?.replace(/[._-]/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
  return cleaned && cleaned.trim().length > 0 ? cleaned : id;
}

function modelSupportsChat(model: Record<string, unknown>, id: string): boolean {
  const object = stringValue(model.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const status = stringValue(model.status)?.toLowerCase();
  if (status && !["active", "available", "enabled"].includes(status)) {
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
  if (
    metadata.some((entry) =>
      [
        "audio",
        "embedding",
        "embeddings",
        "image-generation",
        "image_generation",
        "moderation",
        "rerank",
        "text-to-image",
        "text_to_image",
        "tts",
        "video-generation",
        "video_generation",
      ].includes(entry),
    )
  ) {
    return false;
  }
  const capabilities = nestedRecord(model, "capabilities");
  const chatCapability =
    booleanValue(capabilities?.chat) ??
    booleanValue(capabilities?.chat_completion) ??
    booleanValue(capabilities?.chatCompletions) ??
    booleanValue(capabilities?.completion_chat);
  if (chatCapability === false) {
    return false;
  }
  return true;
}

export function normalizeRutaApiModel(value: unknown): RutaApiModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model);
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
): Promise<RutaApiModel[]> {
  if (!apiKey) {
    throw new Error(
      "RutaAPI model discovery requires an api_key Plugin Setting or RUTAAPI_API_KEY.",
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
      `RutaAPI model discovery returned HTTP ${response.status} ${response.statusText}`,
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
    throw new Error("RutaAPI model discovery response did not include a model array.");
  }
  return entries.flatMap((entry) => {
    const model = normalizeRutaApiModel(entry);
    return model ? [model] : [];
  });
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "rutaapi",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      let models: RutaApiModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `RutaAPI model discovery failed; RutaAPI catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "RutaAPI",
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
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
