import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type CloudflareModel = {
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

const ACCOUNT_ID_ENV = "CLOUDFLARE_ACCOUNT_ID";
const ACCOUNT_ID_SETTING = "account_id";
const API_TOKEN_ENV = "CLOUDFLARE_API_TOKEN";
const API_TOKEN_SETTING = "api_token";
const API_ROOT = "https://api.cloudflare.com/client/v4";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const EMBEDDINGS_PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_EMBEDDING_CONTEXT_WINDOW = 8_192;
const DEFAULT_MAX_TOKENS = 4_096;
const MODEL_COMPAT = {
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsStore: false,
};
const NON_CHAT_ID_PARTS = [
  "asr",
  "audio",
  "clip",
  "diffusion",
  "embed",
  "embedding",
  "image-generation",
  "moderation",
  "rerank",
  "speech",
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
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const parsed = Number.parseFloat(value.replace(/,/gu, "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
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

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function nestedRecord(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const nested = value[key];
  return isRecord(nested) ? nested : null;
}

function configuredAccountId(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(ACCOUNT_ID_SETTING)) ??
    stringValue(metidos.env.get(ACCOUNT_ID_ENV))
  );
}

function configuredApiToken(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_TOKEN_SETTING)) ??
    stringValue(metidos.env.get(API_TOKEN_ENV))
  );
}

export function cloudflareAccountId(value: unknown): string | null {
  const accountId = stringValue(value);
  if (!accountId || !/^[a-zA-Z0-9_-]{1,128}$/u.test(accountId)) {
    return null;
  }
  return accountId;
}

function cloudflareAiBaseUrl(accountId: string): string {
  return `${API_ROOT}/accounts/${accountId}/ai/v1`;
}

function cloudflareModelSearchUrl(accountId: string, task: string): string {
  return `${API_ROOT}/accounts/${accountId}/ai/models/search?task=${encodeURIComponent(task)}`;
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
      .replace(/\bcf\b/giu, "Cloudflare")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bqwen\b/giu, "Qwen"),
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

function taskMetadata(model: Record<string, unknown>): string[] {
  const task = isRecord(model.task) ? model.task : null;
  const architecture = isRecord(model.architecture) ? model.architecture : null;
  const tags = stringArrayValue(model.tags) ?? [];
  const tasks = stringArrayValue(model.tasks) ?? [];
  const endpoints = stringArrayValue(model.endpoints) ?? [];
  const inputs = stringArrayValue(model.input) ?? [];
  return [
    stringValue(model.task),
    stringValue(task?.id),
    stringValue(task?.name),
    stringValue(model.task_name),
    stringValue(model.taskName),
    stringValue(model.type),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(architecture?.modality),
    ...tags,
    ...tasks,
    ...endpoints,
    ...inputs,
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function propertyValue(
  model: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  const properties = model.properties;
  if (!Array.isArray(properties)) {
    return undefined;
  }
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  for (const property of properties) {
    if (!isRecord(property)) {
      continue;
    }
    const name =
      stringValue(property.id) ??
      stringValue(property.name) ??
      stringValue(property.key) ??
      stringValue(property.property_id) ??
      stringValue(property.propertyId);
    if (name && normalizedKeys.includes(name.toLowerCase())) {
      return property.value ?? property.default ?? property.description;
    }
  }
  return undefined;
}

function normalizeContextWindow(
  value: Record<string, unknown>,
  fallback: number,
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
    numberValue(
      propertyValue(value, [
        "context_length",
        "context window",
        "context_window",
        "max_context_length",
      ]),
    ) ??
    fallback
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
    numberValue(
      propertyValue(value, ["max_tokens", "max output tokens", "max_output"]),
    ) ??
    DEFAULT_MAX_TOKENS
  );
}

function normalizeCost(value: Record<string, unknown>): CloudflareModel["cost"] {
  const pricing = nestedRecord(value, "pricing");
  const cost = nestedRecord(value, "cost");
  const source = pricing ?? cost;
  return {
    cacheRead: costValue(source?.cache_input ?? source?.cacheInput),
    cacheWrite: costValue(source?.cache_write ?? source?.cacheWrite),
    input: costValue(source?.input ?? source?.prompt),
    output: costValue(source?.output ?? source?.completion),
  };
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
  if (status && status !== "active") {
    return false;
  }
  const metadata = taskMetadata(model);
  if (
    metadata.some((entry) =>
      [
        "automatic-speech-recognition",
        "image-generation",
        "image-to-text",
        "moderation",
        "rerank",
        "text embeddings",
        "text-embeddings",
        "text-to-image",
      ].includes(entry),
    )
  ) {
    return false;
  }
  if (
    metadata.some((entry) =>
      ["chat", "chat-completions", "text generation", "text-generation"].includes(
        entry,
      ),
    )
  ) {
    return true;
  }
  const capabilities = isRecord(model.capabilities) ? model.capabilities : null;
  const supportsChat =
    booleanValue(capabilities?.completion_chat) ??
    booleanValue(capabilities?.chat_completion) ??
    booleanValue(capabilities?.chat);
  return supportsChat !== false;
}

function modelInput(model: Record<string, unknown>, id: string): ("text" | "image")[] {
  const metadata = taskMetadata(model);
  const capabilities = isRecord(model.capabilities) ? model.capabilities : null;
  const hasVision =
    capabilities?.vision === true ||
    capabilities?.image_input === true ||
    capabilities?.multimodal === true ||
    model.supports_image_in === true ||
    metadata.some((entry) =>
      ["image", "image-input", "image_input", "text+image->text"].includes(
        entry,
      ),
    ) ||
    /(?:vision|vl|multimodal|llava|maverick|scout)/iu.test(id);
  return hasVision ? ["text", "image"] : ["text"];
}

export function normalizeCloudflareChatModel(value: unknown): CloudflareModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id =
    stringValue(value.id) ??
    stringValue(value.model) ??
    stringValue(value.name) ??
    stringValue(value.path);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value, DEFAULT_CONTEXT_WINDOW),
    cost: normalizeCost(value),
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Workers AI serves some reasoning-capable models, but Pi thinking-level
    // controls stay disabled until provider-specific reasoning controls are
    // represented in Metidos.
    reasoning: false,
  };
}

export function normalizeCloudflareEmbeddingModel(
  value: unknown,
): CloudflareModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id =
    stringValue(value.id) ??
    stringValue(value.model) ??
    stringValue(value.name) ??
    stringValue(value.path);
  if (!id) {
    return null;
  }
  const metadata = taskMetadata(value);
  const supportsEmbeddings =
    id.toLowerCase().includes("embed") ||
    metadata.some((entry) =>
      ["embedding", "embeddings", "text embeddings", "text-embeddings"].includes(
        entry,
      ),
    );
  if (!supportsEmbeddings) {
    return null;
  }
  const contextWindow = normalizeContextWindow(
    value,
    DEFAULT_EMBEDDING_CONTEXT_WINDOW,
  );
  return {
    contextWindow,
    cost: normalizeCost(value),
    id,
    input: ["text"],
    maxTokens:
      numberValue(value.max_input_tokens) ??
      numberValue(value.maxInputTokens) ??
      contextWindow,
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    reasoning: false,
  };
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
  throw new Error("Cloudflare Workers AI embeddings require non-empty text input.");
}

function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      "Cloudflare Workers AI embedding response did not include a vector.",
    );
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "Cloudflare Workers AI embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

export function firstEmbeddingFromCloudflareResponse(
  value: unknown,
): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("Cloudflare Workers AI embedding response was not an object.");
  }
  const data = value.data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (isRecord(first)) {
      return normalizeEmbeddingVector(first.embedding);
    }
  }
  const result = isRecord(value.result) ? value.result : null;
  const resultData = result?.data;
  if (Array.isArray(resultData) && Array.isArray(resultData[0])) {
    return normalizeEmbeddingVector(resultData[0]);
  }
  if (Array.isArray(result?.embedding)) {
    return normalizeEmbeddingVector(result.embedding);
  }
  throw new Error("Cloudflare Workers AI embedding response did not include data.");
}

function modelEntriesFromResponse(payload: unknown): unknown[] | null {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (!isRecord(payload)) {
    return null;
  }
  const result = isRecord(payload.result) ? payload.result : null;
  if (Array.isArray(payload.data)) {
    return payload.data;
  }
  if (Array.isArray(payload.models)) {
    return payload.models;
  }
  if (Array.isArray(payload.result)) {
    return payload.result;
  }
  if (result && Array.isArray(result.data)) {
    return result.data;
  }
  if (result && Array.isArray(result.models)) {
    return result.models;
  }
  return null;
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
  accountId: string | null,
  apiToken: string | null,
): Promise<CloudflareModel[]> {
  const safeAccountId = cloudflareAccountId(accountId);
  if (!safeAccountId) {
    throw new Error(
      "Cloudflare Workers AI model discovery requires a valid account_id Plugin Setting or CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  if (!apiToken) {
    throw new Error(
      "Cloudflare Workers AI model discovery requires an api_token Plugin Setting or CLOUDFLARE_API_TOKEN.",
    );
  }
  const response = await metidos.fetch(
    cloudflareModelSearchUrl(safeAccountId, "Text Generation"),
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare Workers AI model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const entries = modelEntriesFromResponse(await response.json());
  if (!entries) {
    throw new Error(
      "Cloudflare Workers AI model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeCloudflareChatModel(entry);
    return model ? [model] : [];
  });
}

async function discoverEmbeddingModels(
  metidos: MetidosPluginApi,
  accountId: string | null,
  apiToken: string | null,
): Promise<CloudflareModel[]> {
  const safeAccountId = cloudflareAccountId(accountId);
  if (!safeAccountId) {
    throw new Error(
      "Cloudflare Workers AI embedding model discovery requires a valid account_id Plugin Setting or CLOUDFLARE_ACCOUNT_ID.",
    );
  }
  if (!apiToken) {
    throw new Error(
      "Cloudflare Workers AI embedding model discovery requires an api_token Plugin Setting or CLOUDFLARE_API_TOKEN.",
    );
  }
  const response = await metidos.fetch(
    cloudflareModelSearchUrl(safeAccountId, "Text Embeddings"),
    {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      method: "GET",
    },
  );
  if (!response.ok) {
    throw new Error(
      `Cloudflare Workers AI embedding model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const entries = modelEntriesFromResponse(await response.json());
  if (!entries) {
    throw new Error(
      "Cloudflare Workers AI embedding discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeCloudflareEmbeddingModel(entry);
    return model ? [model] : [];
  });
}

function piAuthRecords(): Record<string, string>[] {
  return [
    {
      kind: "api_key",
      source: "setting",
      value: API_TOKEN_SETTING,
    },
    { kind: "api_key", source: "env", value: API_TOKEN_ENV },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "cloudflare",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const accountId = configuredAccountId(metidos);
      const safeAccountId = cloudflareAccountId(accountId);
      if (!safeAccountId) {
        await logWarning(
          metidos,
          "Cloudflare Workers AI provider configuration requires a valid account_id Plugin Setting or CLOUDFLARE_ACCOUNT_ID.",
        );
        return [];
      }
      const apiToken = configuredApiToken(metidos);
      let models: CloudflareModel[] = [];
      try {
        models = await discoverModels(metidos, safeAccountId, apiToken);
      } catch (error) {
        await logWarning(
          metidos,
          `Cloudflare Workers AI model discovery failed; Cloudflare catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: cloudflareAiBaseUrl(safeAccountId),
          id: safeAccountId,
          label: "Cloudflare Workers AI",
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
    id: "cloudflare_embeddings",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: EMBEDDINGS_PROVIDER_TIMEOUT_MS,
    async embed(_context, request) {
      const accountId = cloudflareAccountId(configuredAccountId(metidos));
      if (!accountId) {
        throw new Error(
          "Cloudflare Workers AI embeddings require a valid account_id Plugin Setting or CLOUDFLARE_ACCOUNT_ID.",
        );
      }
      const apiToken = configuredApiToken(metidos);
      if (!apiToken) {
        throw new Error(
          "Cloudflare Workers AI embeddings require an api_token Plugin Setting or CLOUDFLARE_API_TOKEN.",
        );
      }
      const response = await metidos.fetch(
        `${cloudflareAiBaseUrl(accountId)}/embeddings`,
        {
          body: JSON.stringify({
            input: textEmbeddingInput(request.input),
            model: stringValue(request.model.id),
            ...(request.options && typeof request.options === "object"
              ? request.options
              : {}),
          }),
          headers: {
            Authorization: `Bearer ${apiToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      if (!response.ok) {
        throw new Error(
          `Cloudflare Workers AI embeddings returned HTTP ${response.status} ${response.statusText}`,
        );
      }
      return firstEmbeddingFromCloudflareResponse(await response.json());
    },
    async getProviderConfigurations() {
      const accountId = configuredAccountId(metidos);
      const safeAccountId = cloudflareAccountId(accountId);
      if (!safeAccountId) {
        await logWarning(
          metidos,
          "Cloudflare Workers AI embeddings require a valid account_id Plugin Setting or CLOUDFLARE_ACCOUNT_ID.",
        );
        return [];
      }
      const apiToken = configuredApiToken(metidos);
      let models: CloudflareModel[] = [];
      try {
        models = await discoverEmbeddingModels(metidos, safeAccountId, apiToken);
      } catch (error) {
        await logWarning(
          metidos,
          `Cloudflare Workers AI embedding model discovery failed; Cloudflare embeddings will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return [
        {
          id: safeAccountId,
          label: "Cloudflare Workers AI Embeddings",
          models: models.map((model) => ({
            api: "embeddings",
            compat: { providesEmbeddings: true },
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
