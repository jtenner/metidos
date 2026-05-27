import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type AlephAlphaModel = {
  api: "openai-completions";
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

const API_KEY_ENV = "ALEPH_ALPHA_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.aleph-alpha.com/v1";
const MODEL_SETTINGS_URL = `${BASE_URL}/model-settings`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 8_192;
const DEFAULT_MAX_TOKENS = 4_096;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const MODEL_COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function positiveInteger(value: unknown): number | null {
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

function modelName(id: string, description: string | null): string {
  if (description && description.length <= 80) {
    return description;
  }
  return titleCaseWords(
    id
      .replace(/[\/_-]/gu, " ")
      .replace(/\bllm\b/giu, "LLM")
      .replace(/\bpharia\b/giu, "Pharia")
      .replace(/\bcontrol\b/giu, "Control"),
  );
}

function isAvailableChatModel(
  model: Record<string, unknown>,
  id: string,
): boolean {
  const normalized = id.toLowerCase();
  if (/(?:^|[\/_-])(?:embed|embedding|rerank|transcribe|translate)(?:$|[\/_-])/u.test(normalized)) {
    return false;
  }

  const status = stringValue(model.status)?.toLowerCase();
  if (status && status !== "available") {
    return false;
  }

  const chat = booleanValue(model.chat);
  if (chat !== null) {
    return chat;
  }

  return stringValue(model.completion_type)?.toLowerCase() === "full";
}

export function normalizeAlephAlphaChatModel(
  value: unknown,
): AlephAlphaModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.name) ?? stringValue(value.id);
  if (!id || !isAvailableChatModel(value, id)) {
    return null;
  }

  const contextWindow =
    positiveInteger(value.max_context_size) ??
    positiveInteger(value.context_window) ??
    DEFAULT_CONTEXT_WINDOW;
  const maxTokens = Math.min(contextWindow, DEFAULT_MAX_TOKENS);
  const multimodal = booleanValue(value.multimodal) === true;

  return {
    api: "openai-completions",
    contextWindow,
    cost: { ...DEFAULT_COST },
    id,
    input: multimodal ? ["text", "image"] : ["text"],
    maxTokens,
    name: modelName(id, stringValue(value.description)),
    // The public model-settings response does not declare a stable
    // OpenAI-compatible reasoning-effort parameter for Pharia models.
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
): Promise<AlephAlphaModel[]> {
  if (!apiKey) {
    throw new Error(
      "Aleph Alpha model discovery requires an api_key Plugin Setting or ALEPH_ALPHA_API_KEY.",
    );
  }
  const response = await metidos.fetch(MODEL_SETTINGS_URL, {
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
      `Aleph Alpha model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) {
    throw new Error(
      "Aleph Alpha model discovery response did not include a model array.",
    );
  }
  return payload.flatMap((entry) => {
    const model = normalizeAlephAlphaChatModel(entry);
    return model ? [model] : [];
  });
}

function modelConfiguration(model: AlephAlphaModel): Record<string, unknown> {
  return {
    api: model.api,
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
    id: "aleph_alpha",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: AlephAlphaModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `Aleph Alpha model discovery failed; Aleph Alpha catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Aleph Alpha",
          models: models.map(modelConfiguration),
          piAuth: piAuthRecords(),
        },
      ];
    },
  });
});
