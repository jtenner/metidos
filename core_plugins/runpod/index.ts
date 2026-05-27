import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type RunpodModel = {
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

const API_KEY_ENV = "RUNPOD_API_KEY";
const API_KEY_SETTING = "api_key";
const ENDPOINT_ID_ENV = "RUNPOD_ENDPOINT_ID";
const ENDPOINT_ID_SETTING = "endpoint_id";
const MODEL_IDS_ENV = "RUNPOD_MODEL_IDS";
const MODEL_IDS_SETTING = "model_ids";
const API_BASE_URL = "https://api.runpod.ai/v2";
const OPENAI_PATH_SUFFIX = "/openai/v1";
const API_KEY_SENTINEL = "METIDOS_RUNPOD_API_KEY_NOT_CONFIGURED";
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
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
  supportsReasoningEffort: false,
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
  "sdxl",
  "speech",
  "tts",
  "video",
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
    ? Math.floor(value)
    : null;
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

function splitCommaSeparated(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

export function normalizeRunpodEndpointId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 128) {
    return null;
  }
  return /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/u.test(
    normalized,
  )
    ? normalized
    : null;
}

function configuredEndpointId(metidos: MetidosPluginApi): string | null {
  return (
    normalizeRunpodEndpointId(metidos.settings.get(ENDPOINT_ID_SETTING)) ??
    normalizeRunpodEndpointId(metidos.env.get(ENDPOINT_ID_ENV))
  );
}

export function runpodBaseUrl(endpointId: string): string {
  return `${API_BASE_URL}/${endpointId}${OPENAI_PATH_SUFFIX}`;
}

function runpodDiscoveryUrl(endpointId: string): string {
  return `${runpodBaseUrl(endpointId)}/models`;
}

function normalizedTextValues(model: Record<string, unknown>): string[] {
  const metadata = nestedRecord(model, "metadata");
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.endpoint),
    stringValue(model.object),
    stringValue(model.modality),
    stringValue(model.mode),
    stringValue(model.category),
    ...(stringArrayValue(model.capabilities) ?? []),
    ...(stringArrayValue(model.endpoints) ?? []),
    ...(stringArrayValue(model.supported_features) ?? []),
    ...(stringArrayValue(model.supportedFeatures) ?? []),
    ...(stringArrayValue(model.supported_input_modalities) ?? []),
    ...(stringArrayValue(model.supportedInputModalities) ?? []),
    ...(stringArrayValue(model.supported_output_modalities) ?? []),
    ...(stringArrayValue(model.supportedOutputModalities) ?? []),
    stringValue(metadata?.type),
    stringValue(metadata?.task),
    stringValue(metadata?.modality),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function normalizeContextWindow(value: Record<string, unknown>): number {
  const metadata = nestedRecord(value, "metadata");
  return (
    numberValue(value.context_length) ??
    numberValue(value.contextLength) ??
    numberValue(value.context_window) ??
    numberValue(value.contextWindow) ??
    numberValue(value.max_context_length) ??
    numberValue(value.maxContextLength) ??
    numberValue(value.max_model_len) ??
    numberValue(value.maxModelLen) ??
    numberValue(metadata?.context_length) ??
    numberValue(metadata?.contextLength) ??
    numberValue(metadata?.max_model_len) ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(value: Record<string, unknown>): number {
  const metadata = nestedRecord(value, "metadata");
  return (
    numberValue(value.max_completion_tokens) ??
    numberValue(value.maxCompletionTokens) ??
    numberValue(value.max_output_tokens) ??
    numberValue(value.maxOutputTokens) ??
    numberValue(value.max_tokens) ??
    numberValue(value.maxTokens) ??
    numberValue(metadata?.max_completion_tokens) ??
    numberValue(metadata?.maxCompletionTokens) ??
    numberValue(metadata?.max_output_tokens) ??
    numberValue(metadata?.maxOutputTokens) ??
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
  return titleCaseWords(
    id
      .split("/")
      .pop()!
      .replace(/[._:-]+/gu, " ")
      .replace(/\bapi\b/giu, "API")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bqwen\b/giu, "Qwen")
      .replace(/\bvl\b/giu, "VL")
      .replace(/\bai\b/giu, "AI")
      .replace(/\b(\d+)b\b/giu, "$1B")
      .trim(),
  );
}

function modelSupportsChat(model: Record<string, unknown>, id: string): boolean {
  const object = stringValue(model.object)?.toLowerCase();
  if (object && object !== "model") {
    return false;
  }
  const normalizedId = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalizedId.includes(part))) {
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
    booleanValue(capabilities?.chatCompletions);
  return chatCapability !== false;
}

export function normalizeRunpodModel(value: unknown): RunpodModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model);
  if (!id || !modelSupportsChat(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: DEFAULT_COST,
    id,
    input: ["text"],
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

export function normalizeRunpodModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeRunpodModels(values: readonly unknown[]): RunpodModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeRunpodModelId(entry);
    if (!id || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [
      {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        cost: DEFAULT_COST,
        id,
        input: ["text"],
        maxTokens: DEFAULT_MAX_TOKENS,
        name: modelName(id, null),
        reasoning: /reason|thinking|r1|qwq/u.test(id.toLowerCase()),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): RunpodModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeRunpodModels(settingModels ?? envModels);
}

function modelConfiguration(model: RunpodModel) {
  return {
    api: "openai-completions",
    compat: MODEL_COMPAT,
    contextWindow: model.contextWindow,
    cost: model.cost,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
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
  endpointId: string,
  apiKey: string,
): Promise<RunpodModel[]> {
  const response = await metidos.fetch(runpodDiscoveryUrl(endpointId), {
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
      `Runpod model discovery returned HTTP ${response.status} ${response.statusText}`,
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
    throw new Error("Runpod model discovery response did not include a model array.");
  }
  return entries.flatMap((entry) => {
    const model = normalizeRunpodModel(entry);
    return model ? [model] : [];
  });
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "runpod",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const endpointId = configuredEndpointId(metidos);
      const fallbackModels = configuredModels(metidos);
      let models = fallbackModels;

      if (endpointId && apiKey) {
        try {
          const discoveredModels = await discoverModels(metidos, endpointId, apiKey);
          models = discoveredModels.length > 0 ? discoveredModels : fallbackModels;
        } catch (error) {
          await logWarning(
            metidos,
            `Runpod model discovery failed; using configured model_ids if present: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Runpod API key is not configured. Set the Runpod api_key setting or RUNPOD_API_KEY.",
          authHeader: true,
          baseUrl: endpointId
            ? runpodBaseUrl(endpointId)
            : "https://api.runpod.ai/v2/example/openai/v1",
          configurationMissing: endpointId === null,
          configurationMissingMessage:
            "Runpod endpoint_id is not configured. Set endpoint_id or RUNPOD_ENDPOINT_ID for a serverless endpoint that exposes /openai/v1, and optionally set model_ids or RUNPOD_MODEL_IDS as a fallback catalog.",
          id: "default",
          label: endpointId ? `Runpod (${endpointId})` : "Runpod",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
