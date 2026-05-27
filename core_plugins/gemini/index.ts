import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type GeminiModel = {
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

const API_KEY_ENV = "GEMINI_API_KEY";
const GOOGLE_API_KEY_ENV = "GOOGLE_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DISCOVERY_URL = `${BASE_URL}/models`;
const GEMINI_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const EMBEDDING_MODEL_ID = "models/gemini-embedding-001";
const EMBEDDING_ENDPOINT_URL = `${GEMINI_NATIVE_BASE_URL}/${EMBEDDING_MODEL_ID}:embedContent`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
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

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV)) ??
    stringValue(metidos.env.get(GOOGLE_API_KEY_ENV))
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
      .replace(/\bdeepseek\b/giu, "DeepSeek")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bgemini\b/giu, "Google Gemini")
      .replace(/\boss\b/giu, "OSS")
      .replace(/\bqwen\b/giu, "Qwen")
      .replace(/\bvl\b/giu, "VL"),
  );
}

function capabilitiesForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.capabilities) ? model.capabilities : null;
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

function normalizedMetadata(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.model_type),
    stringValue(model.modelType),
    stringValue(architecture?.modality),
    ...(stringArrayValue(model.supported_features) ?? []),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
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
  if (status && status !== "active") {
    return false;
  }
  const metadata = normalizedMetadata(model);
  if (
    metadata.some((entry) =>
      ["embedding", "moderation", "rerank", "text-to-image"].includes(entry),
    )
  ) {
    return false;
  }
  const endpoints = stringArrayValue(model.endpoints);
  if (endpoints && endpoints.length > 0) {
    const normalizedEndpoints = endpoints.map((endpoint) => endpoint.toLowerCase());
    if (
      normalizedEndpoints.some((endpoint) =>
        ["chat", "chat-completions", "chat_completions"].includes(endpoint),
      )
    ) {
      return true;
    }
    return false;
  }
  const capabilities = capabilitiesForModel(model);
  const supportsChat =
    booleanValue(capabilities?.completion_chat) ??
    booleanValue(capabilities?.chat_completion) ??
    booleanValue(capabilities?.chat);
  return supportsChat !== false;
}

function modelInput(
  model: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const capabilities = capabilitiesForModel(model);
  const metadata = normalizedMetadata(model);
  const hasVision =
    capabilities?.vision === true ||
    capabilities?.image_input === true ||
    capabilities?.multimodal === true ||
    model.supports_image_in === true ||
    metadata.some((entry) =>
      ["image", "image-input", "image_input", "text+image->text"].includes(entry),
    ) ||
    /(?:vision|vl|multimodal|llava|maverick|scout)/iu.test(id);
  return hasVision ? ["text", "image"] : ["text"];
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
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
    numberValue(limits?.context_length) ??
    numberValue(limits?.contextLength) ??
    numberValue(limits?.max_context_length) ??
    numberValue(limits?.maxContextLength) ??
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

export function normalizeGeminiModel(value: unknown): GeminiModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model) ?? stringValue(value.name);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Google Gemini serves reasoning-capable upstream models, but Pi thinking-level
    // controls stay disabled until model-specific reasoning parameters are
    // represented in Metidos.
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
): Promise<GeminiModel[]> {
  if (!apiKey) {
    throw new Error(
      "Google Gemini model discovery requires a api_key Plugin Setting, GEMINI_API_KEY, or GOOGLE_API_KEY.",
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
      `Google Gemini model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "Google Gemini model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeGeminiModel(entry);
    return model ? [model] : [];
  });
}

function textEmbeddingInput(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  throw new Error("Google Gemini embeddings require a non-empty text input.");
}

function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Google Gemini embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "Google Gemini embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

export function firstEmbeddingFromGeminiResponse(value: unknown): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("Google Gemini embedding response was not an object.");
  }
  const embedding = value.embedding;
  if (!isRecord(embedding)) {
    throw new Error("Google Gemini embedding response did not include embedding data.");
  }
  return normalizeEmbeddingVector(embedding.values);
}

function piAuthRecords(): Record<string, string>[] {
  return [
    {
      kind: "api_key",
      source: "setting",
      value: API_KEY_SETTING,
    },
    { kind: "api_key", source: "env", value: API_KEY_ENV },
    { kind: "api_key", source: "env", value: GOOGLE_API_KEY_ENV },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "gemini",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: GeminiModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Google Gemini model discovery failed; Google Gemini catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Google Gemini",
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

  metidos.providers.addProvider({
    id: "gemini_embeddings",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      if (!apiKey) {
        throw new Error(
          "Google Gemini embeddings require an api_key Plugin Setting, GEMINI_API_KEY, or GOOGLE_API_KEY.",
        );
      }
      const response = await metidos.fetch(EMBEDDING_ENDPOINT_URL, {
        body: JSON.stringify({
          content: { parts: [{ text: textEmbeddingInput(request.input) }] },
          model: EMBEDDING_MODEL_ID,
          ...(request.options && typeof request.options === "object"
            ? request.options
            : {}),
        }),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(
          `Google Gemini embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromGeminiResponse(await response.json());
    },
    getProviderConfigurations() {
      return [
        {
          id: "default",
          label: "Google Gemini Embeddings",
          models: [
            {
              api: "embeddings",
              compat: { providesEmbeddings: true },
              contextWindow: 2_048,
              cost: { ...DEFAULT_COST },
              id: EMBEDDING_MODEL_ID,
              input: ["text"],
              maxTokens: 2_048,
              name: "Gemini Embedding 001",
              reasoning: false,
            },
          ],
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
