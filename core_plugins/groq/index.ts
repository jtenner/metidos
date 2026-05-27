import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type GroqModel = {
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

const API_KEY_ENV = "GROQ_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.groq.com/openai/v1";
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_MAX_TOKENS = 8_192;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const NON_CHAT_ID_PARTS = [
  "audio",
  "embed",
  "embedding",
  "guard",
  "moderation",
  "playai-tts",
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

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function isChatModelId(id: string): boolean {
  const normalized = id.toLowerCase();
  return !NON_CHAT_ID_PARTS.some((part) => normalized.includes(part));
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
      .replace(/[-_]/gu, " ")
      .replace(/\bllama\b/giu, "Llama")
      .replace(/\bqwen\b/giu, "Qwen")
      .replace(/\bdeepseek\b/giu, "DeepSeek")
      .replace(/\bgpt\b/giu, "GPT"),
  );
}

function modelInput(id: string): ("text" | "image")[] {
  return /(?:vision|scout|llama-4|maverick)/iu.test(id)
    ? ["text", "image"]
    : ["text"];
}

function normalizeContextWindow(value: Record<string, unknown>): number {
  return (
    numberValue(value.context_window) ??
    numberValue(value.contextWindow) ??
    numberValue(value.max_context_length) ??
    numberValue(value.maxContextLength) ??
    DEFAULT_CONTEXT_WINDOW
  );
}

function normalizeMaxTokens(value: Record<string, unknown>): number {
  return (
    numberValue(value.max_completion_tokens) ??
    numberValue(value.maxCompletionTokens) ??
    numberValue(value.max_output_tokens) ??
    numberValue(value.maxOutputTokens) ??
    numberValue(value.max_tokens) ??
    numberValue(value.maxTokens) ??
    DEFAULT_MAX_TOKENS
  );
}

export function normalizeGroqModel(value: unknown): GroqModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id || !isChatModelId(id)) {
    return null;
  }
  return {
    contextWindow: normalizeContextWindow(value),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(id),
    maxTokens: normalizeMaxTokens(value),
    name: modelName(id, stringValue(value.name)),
    // Groq exposes some reasoning-capable models, but its OpenAI-compatible
    // chat endpoint has provider-specific reasoning controls. Keep Metidos/Pi
    // thinking-level controls disabled until compatibility is modeled directly.
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
): Promise<GroqModel[]> {
  if (!apiKey) {
    throw new Error(
      "Groq model discovery requires a api_key Plugin Setting or GROQ_API_KEY.",
    );
  }
  const response = await metidos.fetch(`${BASE_URL}/models`, {
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
      `Groq model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error("Groq model discovery response did not include a data array.");
  }
  return payload.data.flatMap((entry) => {
    const model = normalizeGroqModel(entry);
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
    id: "groq",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: GroqModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Groq model discovery failed; Groq catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Groq",
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
