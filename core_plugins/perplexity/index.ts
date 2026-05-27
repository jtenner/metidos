import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type PerplexityModel = {
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

const API_KEY_ENV = "PERPLEXITY_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.perplexity.ai";
const DISCOVERY_URL = `${BASE_URL}/v1/models`;
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
const STATIC_SONAR_MODELS: PerplexityModel[] = [
  {
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    cost: { ...DEFAULT_COST },
    id: "sonar",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Sonar",
    reasoning: false,
  },
  {
    contextWindow: 200_000,
    cost: { ...DEFAULT_COST },
    id: "sonar-pro",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Sonar Pro",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    cost: { ...DEFAULT_COST },
    id: "sonar-reasoning",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Sonar Reasoning",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    cost: { ...DEFAULT_COST },
    id: "sonar-reasoning-pro",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Sonar Reasoning Pro",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    cost: { ...DEFAULT_COST },
    id: "sonar-deep-research",
    input: ["text"],
    maxTokens: DEFAULT_MAX_TOKENS,
    name: "Sonar Deep Research",
    reasoning: false,
  },
];
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
  return titleCaseWords(
    id
      .replace(/^perplexity\//iu, "")
      .replace(/[\/_-]/gu, " ")
      .replace(/\bapi\b/giu, "API")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bsonar\b/giu, "Sonar"),
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

function normalizedMetadata(model: Record<string, unknown>): string[] {
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.model_type),
    stringValue(model.modelType),
    ...(stringArrayValue(model.capabilities) ?? []),
    ...(stringArrayValue(model.supported_features) ?? []),
    ...(stringArrayValue(model.supportedFeatures) ?? []),
    ...(stringArrayValue(model.supported_input_modalities) ?? []),
    ...(stringArrayValue(model.supportedInputModalities) ?? []),
    ...(stringArrayValue(model.supported_output_modalities) ?? []),
    ...(stringArrayValue(model.supportedOutputModalities) ?? []),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function normalizedPerplexityId(id: string): string | null {
  const trimmed = id.trim();
  const withoutPrefix = trimmed.replace(/^perplexity\//iu, "");
  const normalized = withoutPrefix.toLowerCase();
  if (!normalized.startsWith("sonar")) {
    return null;
  }
  if (NON_CHAT_ID_PARTS.some((part) => normalized.includes(part))) {
    return null;
  }
  return withoutPrefix;
}

function isChatModel(model: Record<string, unknown>, id: string): boolean {
  if (!normalizedPerplexityId(id)) {
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
  const outputModalities =
    stringArrayValue(model.supported_output_modalities) ??
    stringArrayValue(model.supportedOutputModalities);
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
        ["chat", "chat-completions", "chat_completions", "sonar"].includes(
          endpoint,
        ),
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
    numberValue(value.max_input_tokens) ??
    numberValue(value.maxInputTokens) ??
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

export function normalizePerplexityModel(value: unknown): PerplexityModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const rawId = stringValue(value.id) ?? stringValue(value.model) ?? stringValue(value.name);
  const id = rawId ? normalizedPerplexityId(rawId) : null;
  if (!rawId || !id || !isChatModel(value, rawId)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: { ...DEFAULT_COST },
    id,
    input: ["text"],
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Perplexity reasoning/search behavior is model-specific. Keep Pi
    // thinking-level controls disabled until provider-specific controls are
    // represented in Metidos.
    reasoning: false,
  };
}

function mergeModels(models: PerplexityModel[]): PerplexityModel[] {
  const byId = new Map<string, PerplexityModel>();
  for (const model of [...STATIC_SONAR_MODELS, ...models]) {
    byId.set(model.id, model);
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
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
): Promise<PerplexityModel[]> {
  if (!apiKey) {
    throw new Error(
      "Perplexity model discovery requires a api_key Plugin Setting or PERPLEXITY_API_KEY.",
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
      `Perplexity model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "Perplexity model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizePerplexityModel(entry);
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
    id: "perplexity",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: PerplexityModel[] = [];
      try {
        models = mergeModels(await discoverModels(metidos, apiKey));
      } catch (error) {
        await logWarning(
          metidos,
          `Perplexity model discovery failed; Perplexity catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Perplexity",
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
