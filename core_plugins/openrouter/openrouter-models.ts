export type OpenRouterModel = {
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

const DEFAULT_MAX_TOKENS = 16_384;
const COST_PER_TOKEN_TO_PER_MILLION = 1_000_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveNumberValue(value: unknown): number | null {
  const normalized = numberValue(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => (typeof item === "string" ? [item] : []))
    : [];
}

export function openRouterCostValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value * COST_PER_TOKEN_TO_PER_MILLION;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const normalized = Number.parseFloat(value.trim());
  return Number.isFinite(normalized) && normalized >= 0
    ? normalized * COST_PER_TOKEN_TO_PER_MILLION
    : 0;
}

function architectureForModel(
  model: Record<string, unknown>,
): Record<string, unknown> | null {
  return isRecord(model.architecture) ? model.architecture : null;
}

function modelInputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return stringArrayValue(architecture?.input_modalities).map((modality) =>
    modality.toLowerCase(),
  );
}

function modelOutputModalities(model: Record<string, unknown>): string[] {
  const architecture = architectureForModel(model);
  return stringArrayValue(architecture?.output_modalities).map((modality) =>
    modality.toLowerCase(),
  );
}

function modelSupportsImageInput(model: Record<string, unknown>): boolean {
  const inputModalities = modelInputModalities(model);
  if (inputModalities.some((modality) => modality === "image")) {
    return true;
  }
  const architecture = architectureForModel(model);
  const modality = stringValue(architecture?.modality)?.toLowerCase() ?? null;
  return modality?.includes("image") ?? false;
}

function modelSupportsReasoning(model: Record<string, unknown>): boolean {
  const supportedParameters = stringArrayValue(model.supported_parameters);
  return supportedParameters.some((parameter) =>
    /reason|thinking/u.test(parameter.toLowerCase()),
  );
}

function modelSupportsEmbeddings(
  model: Record<string, unknown>,
  assumeEmbedding = false,
): boolean {
  return (
    assumeEmbedding ||
    modelOutputModalities(model).some((modality) =>
      modality.includes("embedding"),
    )
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
  if (outputModalities.includes("image")) {
    output.add("image");
  }
  return [...output];
}

function normalizeModel(
  value: unknown,
  api: OpenRouterModel["api"],
): OpenRouterModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id) {
    return null;
  }
  const name = stringValue(value.name) ?? id;
  const contextWindow =
    positiveNumberValue(value.context_length) ?? DEFAULT_MAX_TOKENS;
  const topProvider = isRecord(value.top_provider) ? value.top_provider : null;
  const maxTokens =
    positiveNumberValue(topProvider?.max_completion_tokens) ?? contextWindow;
  const pricing = isRecord(value.pricing) ? value.pricing : null;
  const supportsImageInput = modelSupportsImageInput(value);
  const output = modelOutputKinds(value);
  return {
    api,
    contextWindow,
    cost: {
      cacheRead: openRouterCostValue(pricing?.cache_read),
      cacheWrite: openRouterCostValue(pricing?.cache_write),
      input: openRouterCostValue(pricing?.prompt),
      output: openRouterCostValue(pricing?.completion),
    },
    id,
    input: supportsImageInput ? ["text", "image"] : ["text"],
    maxTokens,
    name,
    output,
    reasoning: api === "openai-completions" && modelSupportsReasoning(value),
  };
}

export function normalizeChatModel(value: unknown): OpenRouterModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const output = modelOutputKinds(value);
  if (output.length === 0) {
    return null;
  }
  return normalizeModel(value, "openai-completions");
}

export function normalizeEmbeddingModel(
  value: unknown,
  options: { assumeEmbedding?: boolean } = {},
): OpenRouterModel | null {
  if (
    !isRecord(value) ||
    !modelSupportsEmbeddings(value, options.assumeEmbedding === true)
  ) {
    return null;
  }
  return normalizeModel(value, "embeddings");
}

export function normalizeEmbeddingVector(value: unknown): readonly number[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("OpenRouter embedding response did not include a vector.");
  }
  return value.map((item) => {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      throw new Error(
        "OpenRouter embedding response contained a non-finite number.",
      );
    }
    return item;
  });
}

export function firstEmbeddingFromResponse(value: unknown): readonly number[] {
  if (!isRecord(value)) {
    throw new Error("OpenRouter embedding response was not an object.");
  }
  const data = value.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("OpenRouter embedding response did not include data.");
  }
  const first = data[0];
  if (!isRecord(first)) {
    throw new Error("OpenRouter embedding response item was invalid.");
  }
  return normalizeEmbeddingVector(first.embedding);
}
