import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type TokenMixModel = {
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
  output: ("text" | "image")[];
  reasoning: boolean;
};

const API_KEY_ENV = "TOKENMIX_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.tokenmix.ai/v1";
const MODELS_URL = `${BASE_URL}/models`;
const EMBEDDINGS_URL = `${BASE_URL}/embeddings`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 60_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const CHAT_BLOCKLIST_PARTS = [
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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
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
    ? value.flatMap((item) => {
        const text = stringValue(item);
        return text ? [text] : [];
      })
    : [];
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
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
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllm\b/giu, "LLM")
      .replace(/\btts\b/giu, "TTS")
      .replace(/\bvl\b/giu, "VL"),
  );
}

function architectureForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.architecture) ? model.architecture : null;
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function modelId(value: Record<string, unknown>): string | null {
  return (
    stringValue(value.id) ??
    stringValue(value.model) ??
    stringValue(value.name) ??
    stringValue(value.slug)
  );
}

function normalizedMetadata(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return [
    stringValue(model.object),
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.endpoint),
    ...(stringArrayValue(model.endpoints)),
    ...(stringArrayValue(model.tags)),
    ...(stringArrayValue(model.capabilities)),
    ...(stringArrayValue(model.supported_parameters)),
    ...(stringArrayValue(model.supportedParameters)),
    ...(stringArrayValue(architecture?.input_modalities)),
    ...(stringArrayValue(architecture?.inputModalities)),
    ...(stringArrayValue(architecture?.output_modalities)),
    ...(stringArrayValue(architecture?.outputModalities)),
    ...(stringArrayValue(model.input_modalities)),
    ...(stringArrayValue(model.inputModalities)),
    ...(stringArrayValue(model.output_modalities)),
    ...(stringArrayValue(model.outputModalities)),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function modelInputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return [
    ...stringArrayValue(architecture?.input_modalities),
    ...stringArrayValue(architecture?.inputModalities),
    ...stringArrayValue(model.input_modalities),
    ...stringArrayValue(model.inputModalities),
    ...stringArrayValue(model.supported_input_modalities),
    ...stringArrayValue(model.supportedInputModalities),
  ].map((modality) => modality.toLowerCase());
}

function modelOutputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return [
    ...stringArrayValue(architecture?.output_modalities),
    ...stringArrayValue(architecture?.outputModalities),
    ...stringArrayValue(model.output_modalities),
    ...stringArrayValue(model.outputModalities),
    ...stringArrayValue(model.supported_output_modalities),
    ...stringArrayValue(model.supportedOutputModalities),
  ].map((modality) => modality.toLowerCase());
}

function modelSupportsImageInput(
  model: Record<string, unknown>,
  id: string,
): boolean {
  const inputModalities = modelInputModalities(model);
  return (
    inputModalities.some((modality) =>
      ["image", "image_url", "image-input", "image_input", "vision"].includes(
        modality,
      ),
    ) || /(?:vision|vl|multimodal|llava|maverick|scout)/iu.test(id)
  );
}

function modelOutputKinds(
  model: Record<string, unknown>,
): ("text" | "image")[] {
  const outputModalities = modelOutputModalities(model);
  const output = new Set<"text" | "image">();
  if (outputModalities.length === 0 || outputModalities.includes("text")) {
    output.add("text");
  }
  if (
    outputModalities.some((modality) =>
      ["image", "image_url", "image-output", "image_output"].includes(
        modality,
      ),
    )
  ) {
    output.add("image");
  }
  return [...output];
}

function modelSupportsEmbeddings(
  model: Record<string, unknown>,
  id: string,
): boolean {
  const normalizedId = id.toLowerCase();
  const metadata = normalizedMetadata(model);
  return (
    /(?:^|[\/_-])(?:embed|embedding|embeddings)(?:$|[\/_-])/iu.test(
      normalizedId,
    ) ||
    metadata.some((entry) =>
      [
        "embedding",
        "embeddings",
        "feature-extraction",
        "sentence-similarity",
        "text-embedding",
        "text-embeddings",
      ].includes(entry),
    )
  );
}

function modelSupportsReasoning(model: Record<string, unknown>): boolean {
  const metadata = normalizedMetadata(model);
  return metadata.some((entry) => /reason|thinking/u.test(entry));
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
    positiveIntegerValue(value.max_context_tokens) ??
    positiveIntegerValue(value.maxContextTokens) ??
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
    DEFAULT_MAX_TOKENS
  );
}

function normalizeModel(
  value: unknown,
  api: TokenMixModel["api"],
): TokenMixModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = modelId(value);
  if (!id) {
    return null;
  }
  const output = api === "embeddings" ? [] : modelOutputKinds(value);
  return {
    api,
    contextWindow: normalizeContextWindow(value),
    cost: DEFAULT_COST,
    id,
    input: modelSupportsImageInput(value, id) ? ["text", "image"] : ["text"],
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    output,
    reasoning: api === "openai-completions" && modelSupportsReasoning(value),
  };
}

export function normalizeTokenMixChatModel(
  value: unknown,
): TokenMixModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = modelId(value);
  if (!id || modelSupportsEmbeddings(value, id)) {
    return null;
  }
  const normalizedId = id.toLowerCase();
  if (CHAT_BLOCKLIST_PARTS.some((part) => normalizedId.includes(part))) {
    return null;
  }
  const object = stringValue(value.object)?.toLowerCase();
  if (object && object !== "model") {
    return null;
  }
  const output = modelOutputKinds(value);
  if (output.length === 0) {
    return null;
  }
  return normalizeModel(value, "openai-completions");
}

export function normalizeTokenMixEmbeddingModel(
  value: unknown,
): TokenMixModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = modelId(value);
  if (!id || !modelSupportsEmbeddings(value, id)) {
    return null;
  }
  return normalizeModel(value, "embeddings");
}

export function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("TokenMix embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "TokenMix embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

export function firstEmbeddingFromTokenMixResponse(
  value: unknown,
): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("TokenMix embedding response was not an object.");
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("TokenMix embedding response did not include data.");
  }
  const first = data[0];
  if (!isRecord(first)) {
    throw new Error("TokenMix embedding response item was invalid.");
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
  apiKey: string | null,
): Promise<unknown[]> {
  if (!apiKey) {
    throw new Error(
      "TokenMix model discovery requires an api_key Plugin Setting or TOKENMIX_API_KEY.",
    );
  }
  const response = await metidos.fetch(MODELS_URL, {
    headers: authHeaders(apiKey),
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(
      `TokenMix model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "TokenMix model discovery response did not include a model array.",
    );
  }
  return entries;
}

async function discoverChatModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<TokenMixModel[]> {
  const data = await fetchModelCatalog(metidos, apiKey);
  return data.flatMap((entry) => {
    const model = normalizeTokenMixChatModel(entry);
    return model ? [model] : [];
  });
}

async function discoverEmbeddingModels(
  metidos: MetidosPluginApi,
  apiKey: string | null,
): Promise<TokenMixModel[]> {
  const data = await fetchModelCatalog(metidos, apiKey);
  return data.flatMap((entry) => {
    const model = normalizeTokenMixEmbeddingModel(entry);
    return model ? [model] : [];
  });
}

function modelConfiguration(model: TokenMixModel): Record<string, unknown> {
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
    output: model.output,
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
    id: "tokenmix",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: TokenMixModel[] = [];
      try {
        models = await discoverChatModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `TokenMix model discovery failed; TokenMix catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "TokenMix",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });

  metidos.providers.addProvider({
    id: "tokenmix_embeddings",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      if (!apiKey) {
        throw new Error(
          "TokenMix embeddings require an api_key Plugin Setting or TOKENMIX_API_KEY.",
        );
      }
      const response = await metidos.fetch(EMBEDDINGS_URL, {
        body: JSON.stringify({
          input: request.input,
          model: stringValue(request.model.id),
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
          `TokenMix embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromTokenMixResponse(await response.json());
    },
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: TokenMixModel[] = [];
      try {
        models = await discoverEmbeddingModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `TokenMix embedding model discovery failed; TokenMix embeddings will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          id: "default",
          label: "TokenMix Embeddings",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
