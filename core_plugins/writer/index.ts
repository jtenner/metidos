import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type WriterModel = {
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

const API_KEY_ENV = "WRITER_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.writer.com/v1";
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
  "embed",
  "embedding",
  "moderation",
  "rerank",
  "tts",
  "vision",
];
const MODEL_METADATA: Record<
  string,
  { contextWindow: number; maxTokens: number; name: string }
> = {
  "palmyra-creative": {
    contextWindow: 128_000,
    maxTokens: 8_192,
    name: "Palmyra Creative",
  },
  "palmyra-fin": {
    contextWindow: 128_000,
    maxTokens: 8_192,
    name: "Palmyra Fin",
  },
  "palmyra-med": {
    contextWindow: 128_000,
    maxTokens: 8_192,
    name: "Palmyra Med",
  },
  "palmyra-x4": {
    contextWindow: 128_000,
    maxTokens: 8_192,
    name: "Palmyra X4",
  },
  "palmyra-x5": {
    contextWindow: 1_000_000,
    maxTokens: 8_192,
    name: "Palmyra X5",
  },
  "palmyra-x5-mini": {
    contextWindow: 128_000,
    maxTokens: 8_192,
    name: "Palmyra X5 Mini",
  },
};

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
  const metadata = MODEL_METADATA[id];
  if (metadata) {
    return metadata.name;
  }
  return titleCaseWords(
    id
      .replace(/[\/_-]/gu, " ")
      .replace(/\bllm\b/giu, "LLM")
      .replace(/\bpalmyra\b/giu, "Palmyra"),
  );
}

function isChatModel(model: Record<string, unknown>, id: string): boolean {
  const normalized = id.toLowerCase();
  if (NON_CHAT_ID_PARTS.some((part) => normalized.includes(part))) {
    return false;
  }
  const type = stringValue(model.type)?.toLowerCase();
  if (type && ["embedding", "image", "moderation", "rerank"].includes(type)) {
    return false;
  }
  return true;
}

function normalizeContextWindow(
  model: Record<string, unknown>,
  id: string,
): number {
  const metadata = MODEL_METADATA[id];
  return (
    numberValue(model.context_window) ??
    numberValue(model.contextWindow) ??
    numberValue(model.max_context_length) ??
    numberValue(model.maxContextLength) ??
    numberValue(model.context_length) ??
    numberValue(model.contextLength) ??
    metadata?.contextWindow ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(model: Record<string, unknown>, id: string): number {
  const metadata = MODEL_METADATA[id];
  return (
    numberValue(model.max_completion_tokens) ??
    numberValue(model.maxCompletionTokens) ??
    numberValue(model.max_output_tokens) ??
    numberValue(model.maxOutputTokens) ??
    numberValue(model.max_tokens) ??
    numberValue(model.maxTokens) ??
    metadata?.maxTokens ??
    DEFAULT_MAX_TOKENS
  );
}

export function normalizeWriterModel(value: unknown): WriterModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id) ?? stringValue(value.name);
  if (!id || !isChatModel(value, id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value, id),
    cost: { ...DEFAULT_COST },
    id,
    input: ["text"],
    maxTokens: normalizeMaxTokens(value, id),
    name: modelName(id, stringValue(value.display_name) ?? stringValue(value.name)),
    // Writer exposes Palmyra reasoning/specialized models, but its model-list
    // metadata does not declare a stable OpenAI-compatible thinking parameter.
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
): Promise<WriterModel[]> {
  if (!apiKey) {
    throw new Error(
      "Writer model discovery requires a api_key Plugin Setting or WRITER_API_KEY.",
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
      `Writer model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  const entries = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.models)
      ? payload.models
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : null;
  if (!entries) {
    throw new Error(
      "Writer model discovery response did not include a model array.",
    );
  }
  return entries.flatMap((entry) => {
    const model = normalizeWriterModel(entry);
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
    id: "writer",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: WriterModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Writer model discovery failed; Writer catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Writer",
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
