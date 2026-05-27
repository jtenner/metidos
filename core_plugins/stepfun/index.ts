import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type StepFunModel = {
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
const API_KEY_ENVS = ["STEPFUN_API_KEY", "STEP_API_KEY"] as const;
const BASE_URL = "https://api.stepfun.ai/v1";
const DISCOVERY_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const NON_CHAT_ID_PARTS = [
  "asr",
  "audio",
  "embed",
  "embedding",
  "image-edit",
  "image-generation",
  "moderation",
  "rerank",
  "speech",
  "step-image",
  "text-to-image",
  "tts",
  "voice",
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

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  const settingKey = stringValue(metidos.settings.get(API_KEY_SETTING));
  if (settingKey) {
    return settingKey;
  }
  for (const envKey of API_KEY_ENVS) {
    const envValue = stringValue(metidos.env.get(envKey));
    if (envValue) {
      return envValue;
    }
  }
  return null;
}

function normalizedTextValues(model: Record<string, unknown>): string[] {
  const nested = [
    nestedRecord(model, "capabilities"),
    nestedRecord(model, "metadata"),
    nestedRecord(model, "pricing"),
  ];
  return [
    stringValue(model.type),
    stringValue(model.task),
    stringValue(model.endpoint),
    stringValue(model.object),
    stringValue(model.modality),
    stringValue(model.mode),
    stringValue(model.category),
    stringValue(model.owned_by),
    stringValue(model.ownedBy),
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
    ...nested.flatMap((record) =>
      record
        ? Object.values(record).flatMap((entry) => {
            const normalized = stringValue(entry);
            return normalized ? [normalized] : [];
          })
        : [],
    ),
  ].flatMap((entry) => (entry ? [entry.toLowerCase()] : []));
}

function inputModalities(model: Record<string, unknown>): string[] | null {
  return (
    (
      stringArrayValue(model.supported_input_modalities) ??
      stringArrayValue(model.supportedInputModalities) ??
      stringArrayValue(model.input_modalities) ??
      stringArrayValue(model.inputModalities)
    )?.map((entry) => entry.toLowerCase()) ?? null
  );
}

function outputModalities(model: Record<string, unknown>): string[] | null {
  return (
    (
      stringArrayValue(model.supported_output_modalities) ??
      stringArrayValue(model.supportedOutputModalities) ??
      stringArrayValue(model.output_modalities) ??
      stringArrayValue(model.outputModalities)
    )?.map((entry) => entry.toLowerCase()) ?? null
  );
}

function supportedInputKinds(
  model: Record<string, unknown>,
  id: string,
): ("text" | "image")[] {
  const modalities = inputModalities(model);
  if (modalities && modalities.length > 0) {
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

  const normalizedId = id.toLowerCase();
  if (
    normalizedId.includes("vision") ||
    normalizedId.includes("step-r1-v") ||
    normalizedId.includes("step-3")
  ) {
    return ["text", "image"];
  }
  return ["text"];
}

function pricingRecord(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return nestedRecord(model, "pricing") ?? nestedRecord(model, "price");
}

function normalizeCost(value: unknown): number {
  if (isRecord(value)) {
    return normalizeCost(value.usd);
  }
  const normalized = numberValue(value);
  return normalized === null ? 0 : normalized;
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

function inferContextWindow(id: string): number {
  const normalizedId = id.toLowerCase();
  const explicitK = normalizedId.match(/(?:^|[-_])([1-9][0-9]*)k(?:[-_]|$)/u);
  if (explicitK) {
    return Number(explicitK[1]) * 1024;
  }
  if (normalizedId.includes("3.5") || normalizedId.includes("3-5")) {
    return 256_000;
  }
  if (normalizedId.includes("step-r1-v")) {
    return 100_000;
  }
  if (normalizedId.includes("step-3")) {
    return 64_000;
  }
  if (normalizedId.includes("vision") || normalizedId.includes("step-2-mini")) {
    return 32_000;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function normalizeContextWindow(
  model: Record<string, unknown>,
  id: string,
): number {
  const limits = nestedRecord(model, "limits");
  return (
    positiveIntegerValue(model.context_length) ??
    positiveIntegerValue(model.contextLength) ??
    positiveIntegerValue(model.context_window) ??
    positiveIntegerValue(model.contextWindow) ??
    positiveIntegerValue(model.max_context_length) ??
    positiveIntegerValue(model.maxContextLength) ??
    positiveIntegerValue(model.max_model_len) ??
    positiveIntegerValue(model.maxModelLen) ??
    positiveIntegerValue(model.max_input_tokens) ??
    positiveIntegerValue(model.maxInputTokens) ??
    positiveIntegerValue(limits?.context_length) ??
    positiveIntegerValue(limits?.contextLength) ??
    positiveIntegerValue(limits?.max_context_length) ??
    positiveIntegerValue(limits?.maxContextLength) ??
    positiveIntegerValue(limits?.max_model_len) ??
    positiveIntegerValue(limits?.maxModelLen) ??
    inferContextWindow(id)
  );
}

function normalizeMaxTokens(
  model: Record<string, unknown>,
  id: string,
): number {
  const limits = nestedRecord(model, "limits");
  return (
    positiveIntegerValue(model.max_completion_tokens) ??
    positiveIntegerValue(model.maxCompletionTokens) ??
    positiveIntegerValue(model.max_output_tokens) ??
    positiveIntegerValue(model.maxOutputTokens) ??
    positiveIntegerValue(model.max_output_length) ??
    positiveIntegerValue(model.maxOutputLength) ??
    positiveIntegerValue(model.max_tokens) ??
    positiveIntegerValue(model.maxTokens) ??
    positiveIntegerValue(limits?.max_completion_tokens) ??
    positiveIntegerValue(limits?.maxCompletionTokens) ??
    positiveIntegerValue(limits?.max_output_tokens) ??
    positiveIntegerValue(limits?.maxOutputTokens) ??
    Math.min(normalizeContextWindow(model, id), DEFAULT_MAX_TOKENS)
  );
}

function modelName(id: string, rawName: string | null): string {
  if (rawName) {
    return rawName;
  }
  const cleaned = id
    .replace(/[-_](20\d{4}|\d{6})$/u, "")
    .replace(/[._-]/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
  return cleaned.trim().length > 0 ? cleaned : id;
}

function modelSupportsChat(
  model: Record<string, unknown>,
  id: string,
): boolean {
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
      ].includes(entry),
    )
  ) {
    return false;
  }
  return true;
}

export function normalizeStepFunModel(value: unknown): StepFunModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.model);
  if (!id || !modelSupportsChat(value, id)) {
    return null;
  }
  const pricing = pricingRecord(value);
  return {
    contextWindow: normalizeContextWindow(value, id),
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
    input: supportedInputKinds(value, id),
    maxTokens: normalizeMaxTokens(value, id),
    name: modelName(
      id,
      stringValue(value.name) ??
        stringValue(value.display_name) ??
        stringValue(value.displayName),
    ),
    reasoning: /(?:^|[-_])(3(?:[.-]5)?|r1)(?:[-_]|$)/u.test(id.toLowerCase()),
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
): Promise<StepFunModel[]> {
  if (!apiKey) {
    throw new Error(
      "StepFun model discovery requires an api_key Plugin Setting, STEPFUN_API_KEY, or STEP_API_KEY.",
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
      `StepFun model discovery returned HTTP ${response.status} ${response.statusText}`,
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
      "StepFun model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeStepFunModel(entry);
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
    ...API_KEY_ENVS.map((envKey) => ({
      kind: "api_key",
      source: "env",
      value: envKey,
    })),
  ];
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "stepfun",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: StepFunModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `StepFun model discovery failed; StepFun catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "StepFun",
          models: models.map((model) => ({
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
