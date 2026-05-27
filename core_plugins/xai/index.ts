import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type XaiModel = {
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

const API_KEY_ENV = "XAI_API_KEY";
const API_KEY_SETTING = "api_key";
const BASE_URL = "https://api.x.ai/v1";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredGlobalOrEnvApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function isChatModelId(id: string): boolean {
  return id.startsWith("grok-") && !id.startsWith("grok-imagine-");
}

function modelName(id: string): string {
  const normalized = id
    .replace(/^grok-/u, "")
    .replace(/^4-1-/u, "4.1-")
    .replace(/-0309/u, "")
    .replace(/-0709/u, " (0709)")
    .replace(/-/gu, " ");
  const titled = normalized.replace(/\b[a-z]/gu, (value) =>
    value.toUpperCase(),
  );
  return `Grok ${titled}`
    .replace(/\bNon Reasoning\b/u, "Non-Reasoning")
    .replace(/\bMulti Agent\b/u, "Multi-Agent");
}

function modelInput(id: string): ("text" | "image")[] {
  return /(?:grok-4-1-fast|grok-4-fast|grok-4\.20)/u.test(id)
    ? ["text", "image"]
    : ["text"];
}

function modelContextWindow(id: string): number {
  if (/(?:grok-4-1-fast|grok-4-fast|grok-4\.20)/u.test(id)) {
    return 2_000_000;
  }
  if (id.startsWith("grok-4") || id.startsWith("grok-code-")) {
    return 256_000;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function modelMaxTokens(id: string): number {
  if (/(?:grok-4-1-fast|grok-4-fast|grok-4\.20)/u.test(id)) {
    return 30_000;
  }
  if (id.startsWith("grok-4")) {
    return 64_000;
  }
  if (id.startsWith("grok-code-")) {
    return 10_000;
  }
  return DEFAULT_MAX_TOKENS;
}

function normalizeModel(value: unknown): XaiModel | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = stringValue(value.id);
  if (!id || !isChatModelId(id)) {
    return null;
  }
  return {
    contextWindow: modelContextWindow(id),
    cost: { ...DEFAULT_COST },
    id,
    input: modelInput(id),
    maxTokens: modelMaxTokens(id),
    name: modelName(id),
    // xAI exposes reasoning-capable Grok variants, but its OpenAI-compatible
    // chat endpoint does not support Metidos/Pi's configurable thinking levels.
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
): Promise<XaiModel[]> {
  if (!apiKey) {
    throw new Error(
      "xAI model discovery requires a api_key Plugin Setting or XAI_API_KEY.",
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
      `xAI model discovery returned HTTP ${response.status} ${response.statusText}`,
    );
  }
  const payload = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    throw new Error(
      "xAI model discovery response did not include a data array.",
    );
  }
  return payload.data.flatMap((entry) => {
    const model = normalizeModel(entry);
    return model ? [model] : [];
  });
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "xai",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      let models: XaiModel[] = [];
      try {
        models = await discoverModels(metidos, apiKey);
      } catch (error) {
        await logWarning(
          metidos,
          `xAI model discovery failed; xAI catalog will remain unavailable until discovery succeeds: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      return [
        {
          api: "openai-completions",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "xAI",
          models: models.map((model) => ({
            contextWindow: model.contextWindow,
            cost: model.cost,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: model.reasoning,
          })),
          piAuth: [
            {
              kind: "api_key",
              source: "setting",
              value: API_KEY_SETTING,
            },
            { kind: "api_key", source: "env", value: API_KEY_ENV },
          ],
        },
      ];
    },
  });
});
