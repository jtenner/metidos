import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type BedrockRegion = (typeof BEDROCK_REGIONS)[number];

export type BedrockModel = {
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
const REGION_SETTING = "region";
const BEDROCK_API_KEY_ENV = "BEDROCK_API_KEY";
const AWS_BEARER_TOKEN_ENV = "AWS_BEARER_TOKEN_BEDROCK";
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
  "embed",
  "embedding",
  "image-generation",
  "image-generator",
  "moderation",
  "rerank",
  "stable-diffusion",
  "titan-embed",
  "video",
];

export const BEDROCK_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-northeast-1",
  "ap-south-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "eu-central-1",
  "eu-north-1",
  "eu-south-1",
  "eu-west-1",
  "eu-west-2",
  "sa-east-1",
] as const;

export const BEDROCK_MODEL_DISCOVERY_URLS = BEDROCK_REGIONS.map(
  (region) => `${bedrockBaseUrl(region)}/models`,
);

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
  return value.flatMap((entry) => {
    const text = stringValue(entry);
    return text ? [text] : [];
  });
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
    stringValue(metidos.env.get(BEDROCK_API_KEY_ENV)) ??
    stringValue(metidos.env.get(AWS_BEARER_TOKEN_ENV))
  );
}

export function bedrockRegion(value: unknown): BedrockRegion {
  const raw = stringValue(value);
  return BEDROCK_REGIONS.includes(raw as BedrockRegion)
    ? (raw as BedrockRegion)
    : "us-east-1";
}

export function bedrockBaseUrl(region: BedrockRegion): string {
  return `https://bedrock-mantle.${region}.api.aws/v1`;
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
      .replace(
        /^(?:[a-z]{2}-)?(?:amazon|anthropic|cohere|meta|mistral)\./iu,
        "",
      )
      .replace(/[:._/-]+/gu, " ")
      .replace(/\bai\b/giu, "AI")
      .replace(/\baws\b/giu, "AWS")
      .replace(/\bclaude\b/giu, "Claude")
      .replace(/\bgpt\b/giu, "GPT")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bnova\b/giu, "Nova"),
  );
}

function normalizedMetadata(model: Record<string, unknown>): string[] {
  const architecture = nestedRecord(model, "architecture");
  const capabilities = nestedRecord(model, "capabilities");
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.modality),
    stringValue(model.pipeline_tag),
    stringValue(model.pipelineTag),
    stringValue(model.model_type),
    stringValue(model.modelType),
    stringValue(architecture?.modality),
    stringValue(capabilities?.modality),
    ...(stringArrayValue(model.supported_features) ?? []),
    ...(stringArrayValue(model.supportedFeatures) ?? []),
    ...(stringArrayValue(model.endpoints) ?? []),
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
  const metadata = normalizedMetadata(model);
  if (
    metadata.some((entry) =>
      [
        "embedding",
        "embeddings",
        "image",
        "image-generation",
        "moderation",
        "rerank",
        "text-to-image",
        "video",
      ].includes(entry),
    )
  ) {
    return false;
  }
  const endpoints = stringArrayValue(model.endpoints);
  if (endpoints && endpoints.length > 0) {
    const normalizedEndpoints = endpoints.map((endpoint) =>
      endpoint.toLowerCase(),
    );
    return normalizedEndpoints.some((endpoint) =>
      ["chat", "chat-completions", "chat_completions", "responses"].includes(
        endpoint,
      ),
    );
  }
  const capabilities = nestedRecord(model, "capabilities");
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
  const capabilities = nestedRecord(model, "capabilities");
  const metadata = normalizedMetadata(model);
  const normalizedId = id.toLowerCase();
  const hasImageInput =
    capabilities?.vision === true ||
    capabilities?.image_input === true ||
    capabilities?.multimodal === true ||
    model.supports_image_in === true ||
    metadata.some((entry) =>
      ["image-input", "image_input", "text+image->text"].includes(entry),
    ) ||
    /(?:vision|multimodal)/iu.test(normalizedId);
  return hasImageInput ? ["text", "image"] : ["text"];
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

export function normalizeBedrockModel(value: unknown): BedrockModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(value, id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(
      id,
      stringValue(value.display_name) ?? stringValue(value.name),
    ),
    // Bedrock exposes reasoning-capable model families, but Pi thinking-level
    // controls stay disabled until Bedrock-specific parameters are represented.
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
  region: BedrockRegion,
): Promise<BedrockModel[]> {
  if (!apiKey) {
    throw new Error(
      "Amazon Bedrock model discovery requires an api_key Plugin Setting, BEDROCK_API_KEY, or AWS_BEARER_TOKEN_BEDROCK.",
    );
  }
  const response = await metidos.fetch(`${bedrockBaseUrl(region)}/models`, {
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
      `Amazon Bedrock model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "Amazon Bedrock model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeBedrockModel(entry);
    return model ? [model] : [];
  });
}

function piAuthRecords(): Record<string, string>[] {
  return [
    { kind: "api_key", source: "setting", value: API_KEY_SETTING },
    { kind: "api_key", source: "env", value: BEDROCK_API_KEY_ENV },
    { kind: "api_key", source: "env", value: AWS_BEARER_TOKEN_ENV },
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "bedrock",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const region = bedrockRegion(metidos.settings.get(REGION_SETTING));
      let models: BedrockModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey, region);
      } catch (error) {
        await logWarning(
          metidos,
          `Amazon Bedrock model discovery failed; Bedrock catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: bedrockBaseUrl(region),
          id: region,
          label: `Amazon Bedrock (${region})`,
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
