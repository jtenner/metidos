import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type HuggingFaceModel = {
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

const API_KEY_ENV = "HF_TOKEN";
const API_KEY_ENV_FALLBACK = "HUGGINGFACE_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://router.huggingface.co/v1";
const DISCOVERY_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;
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
  "clip",
  "diffusion",
  "embed",
  "embedding",
  "flux",
  "image-generation",
  "moderation",
  "rerank",
  "sdxl",
  "stable-diffusion",
  "text-to-image",
  "tts",
  "whisper",
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
    ? Math.floor(value)
    : null;
}

function costValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV)) ??
    stringValue(metidos.env.get(API_KEY_ENV_FALLBACK))
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
      .replace(/[\/_-]/gu, " ")
      .replace(/\bapi\b/giu, "API")
      .replace(/\bbert\b/giu, "BERT")
      .replace(/\bdeepseek\b/giu, "DeepSeek")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\boss\b/giu, "OSS")
      .replace(/\bqwen\b/giu, "Qwen")
      .replace(/\bvl\b/giu, "VL"),
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

function architectureForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.architecture) ? model.architecture : null;
}

function providersForModel(
  model: Record<string, unknown>,
): Record<string, unknown>[] {
  if (!Array.isArray(model.providers)) {
    return [];
  }
  return model.providers.filter(isRecord);
}

function liveProviders(model: Record<string, unknown>): Record<string, unknown>[] {
  return providersForModel(model).filter((provider) => {
    const status = stringValue(provider.status)?.toLowerCase();
    return !status || status === "live";
  });
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function normalizedMetadata(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.model_type),
    stringValue(model.modelType),
    ...(stringArrayValue(model.tags) ?? []),
    ...(stringArrayValue(model.endpoints) ?? []),
    ...(stringArrayValue(architecture?.output_modalities) ?? []),
    ...(stringArrayValue(architecture?.outputModalities) ?? []),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function modelOutputModalities(model: Record<string, unknown>): string[] | null {
  const architecture = architectureForModel(model);
  return (
    stringArrayValue(architecture?.output_modalities) ??
    stringArrayValue(architecture?.outputModalities) ??
    stringArrayValue(model.supported_output_modalities) ??
    stringArrayValue(model.supportedOutputModalities)
  );
}

function isChatModel(model: Record<string, unknown>, id: string): boolean {
  const normalized = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalized.includes(part))) {
    return false;
  }
  const object = stringValue(model.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const status = stringValue(model.status)?.toLowerCase();
  if (status && status !== "active" && status !== "live") {
    return false;
  }
  const metadata = normalizedMetadata(model);
  if (
    metadata.some((entry) =>
      [
        "audio",
        "automatic-speech-recognition",
        "embedding",
        "feature-extraction",
        "image",
        "image-to-text",
        "moderation",
        "rerank",
        "sentence-similarity",
        "text-to-image",
        "text-to-speech",
      ].includes(entry),
    )
  ) {
    return false;
  }
  const outputModalities = modelOutputModalities(model);
  if (
    outputModalities &&
    outputModalities.length > 0 &&
    !outputModalities.some((entry) => entry.toLowerCase() === "text")
  ) {
    return false;
  }
  const endpoints = stringArrayValue(model.endpoints);
  if (endpoints && endpoints.length > 0) {
    const normalizedEndpoints = endpoints.map((endpoint) => endpoint.toLowerCase());
    if (
      normalizedEndpoints.some((endpoint) =>
        ["chat", "chat-completions", "chat_completions", "conversational"].includes(
          endpoint,
        ),
      )
    ) {
      return true;
    }
    return false;
  }
  const providers = providersForModel(model);
  return providers.length === 0 || liveProviders(model).length > 0;
}

function modelInput(
  model: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const architecture = architectureForModel(model);
  const inputModalities = [
    ...(stringArrayValue(architecture?.input_modalities) ?? []),
    ...(stringArrayValue(architecture?.inputModalities) ?? []),
    ...(stringArrayValue(model.supported_input_modalities) ?? []),
    ...(stringArrayValue(model.supportedInputModalities) ?? []),
  ].map((entry) => entry.toLowerCase());
  const hasVision =
    inputModalities.some((entry) =>
      ["image", "image_url", "image-input", "image_input"].includes(entry),
    ) || /(?:vision|vl|multimodal|llava|maverick|scout)/iu.test(id);
  return hasVision ? ["text", "image"] : ["text"];
}

function maxProviderNumber(
  providers: Record<string, unknown>[],
  key: string,
): number | null {
  const values = providers.flatMap((provider) => {
    const value = numberValue(provider[key]);
    return value ? [value] : [];
  });
  return values.length > 0 ? Math.max(...values) : null;
}

function normalizeContextWindow(value: Record<string, unknown>): number {
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
    numberValue(value.max_input_tokens) ??
    numberValue(value.maxInputTokens) ??
    numberValue(limits?.context_length) ??
    numberValue(limits?.contextLength) ??
    numberValue(limits?.max_context_length) ??
    numberValue(limits?.maxContextLength) ??
    maxProviderNumber(liveProviders(value), "context_length") ??
    maxProviderNumber(liveProviders(value), "contextLength") ??
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

function cheapestProviderCost(
  providers: Record<string, unknown>[],
  key: string,
): number {
  const values = providers.flatMap((provider) => {
    const pricing = nestedRecord(provider, "pricing") ?? nestedRecord(provider, "cost");
    const value = costValue(pricing?.[key]);
    return value > 0 ? [value] : [];
  });
  return values.length > 0 ? Math.min(...values) : 0;
}

function normalizeCost(value: Record<string, unknown>): HuggingFaceModel["cost"] {
  const providers = liveProviders(value);
  return {
    cacheRead: cheapestProviderCost(providers, "cache_input"),
    cacheWrite: cheapestProviderCost(providers, "cache_write"),
    input: cheapestProviderCost(providers, "input"),
    output: cheapestProviderCost(providers, "output"),
  };
}

export function normalizeHuggingFaceModel(value: unknown): HuggingFaceModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model) ?? stringValue(value.name);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: normalizeCost(value),
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Hugging Face routes to several upstream providers, and reasoning controls
    // vary by selected provider/model. Keep Pi thinking-level controls disabled
    // until provider-specific reasoning metadata is modeled directly.
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
): Promise<HuggingFaceModel[]> {
  if (!apiKey) {
    throw new Error(
      "Hugging Face model discovery requires a api_key Plugin Setting, HF_TOKEN, or HUGGINGFACE_API_KEY.",
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
      `Hugging Face model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "Hugging Face model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeHuggingFaceModel(entry);
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
    { kind: "api_key", source: "env", value: API_KEY_ENV_FALLBACK },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "huggingface",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: HuggingFaceModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Hugging Face model discovery failed; Hugging Face catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Hugging Face Inference Providers",
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
