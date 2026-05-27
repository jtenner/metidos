import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type NvidiaBuildModel = {
  compat?: Record<string, unknown>;
  id: string;
  name: string;
  reasoning?: boolean;
};

const API_KEY_ENV = "NVIDIA_API_KEY";
const API_KEY_SETTING = "api_key";
const API_KEY_SENTINEL = "METIDOS_NVIDIA_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://integrate.api.nvidia.com/v1";
const MODELS_URL = `${BASE_URL}/models`;
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_COST = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };
const DEFAULT_COMPAT = {
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
};

const NON_CHAT_MODEL_TOKENS = [
  "audio",
  "bria",
  "clip",
  "cv-",
  "embed",
  "embedding",
  "image",
  "omni",
  "rerank",
  "retriev",
  "segmentation",
  "speech",
  "stable-diffusion",
  "tts",
  "video",
  "vision-encoder",
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

export function nvidiaBuildApiKeyValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const withoutBearerPrefix = raw.replace(/^Bearer\s+/iu, "").trim();
  return withoutBearerPrefix.length > 0 ? withoutBearerPrefix : null;
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    nvidiaBuildApiKeyValue(metidos.settings.get(API_KEY_SETTING)) ??
    nvidiaBuildApiKeyValue(metidos.env.get(API_KEY_ENV))
  );
}

function displayName(id: string): string {
  const parts = id.split("/");
  const last = parts.length > 0 ? (parts[parts.length - 1] ?? id) : id;
  return last
    .split(/[-_.]/u)
    .filter(Boolean)
    .map((part) =>
      part.length <= 3
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function isProbablyChatModel(id: string): boolean {
  const normalized = id.toLowerCase();
  return !NON_CHAT_MODEL_TOKENS.some((token) => normalized.includes(token));
}

function isReasoningModel(id: string): boolean {
  const normalized = id.toLowerCase();
  return (
    normalized.includes("thinking") ||
    normalized.includes("reasoning") ||
    normalized.includes("deepseek-v4-pro")
  );
}

export function uniqueNvidiaBuildModels(
  models: readonly NvidiaBuildModel[],
): NvidiaBuildModel[] {
  const seenIds = new Set<string>();
  const uniqueModels: NvidiaBuildModel[] = [];
  for (const model of models) {
    const normalizedId = model.id.trim().toLowerCase();
    if (!normalizedId || seenIds.has(normalizedId)) {
      continue;
    }
    seenIds.add(normalizedId);
    uniqueModels.push(model);
  }
  return uniqueModels;
}

function normalizeModel(value: unknown): NvidiaBuildModel | null {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id) ?? stringValue(value.name);
  if (!id || !isProbablyChatModel(id)) return null;
  return {
    id,
    name:
      stringValue(value.name) ??
      stringValue(value.display_name) ??
      displayName(id),
    ...(isReasoningModel(id) ? { reasoning: true } : {}),
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
): Promise<NvidiaBuildModel[]> {
  if (!apiKey) {
    await logWarning(
      metidos,
      "Build NVIDIA model discovery skipped because no API key is configured.",
    );
    return [];
  }
  try {
    const response = await metidos.fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "GET",
    });
    if (!response.ok) {
      throw new Error(
        `Build NVIDIA model discovery returned HTTP ${response.status} ${response.statusText}`,
      );
    }
    const payload = await response.json();
    const data =
      isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const models: NvidiaBuildModel[] = [];
    for (const entry of data) {
      const normalized = normalizeModel(entry);
      if (normalized) {
        models.push(normalized);
      }
    }
    if (models.length === 0) {
      await logWarning(
        metidos,
        "Build NVIDIA model discovery returned no chat-capable models.",
      );
    }
    return uniqueNvidiaBuildModels(models);
  } catch (error) {
    await logWarning(
      metidos,
      `Build NVIDIA model discovery failed; no models discovered: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "nvidia_build",
    refreshIntervalMs: REFRESH_INTERVAL_MS,
    timeoutMs: 30_000,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Build NVIDIA API key is not configured. Set the Build NVIDIA api_key setting or NVIDIA_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Build NVIDIA",
          piAuth: [
            {
              kind: "api_key",
              source: "setting",
              value: API_KEY_SETTING,
            },
            { kind: "api_key", source: "env", value: API_KEY_ENV },
          ],
          models: (await discoverModels(metidos, apiKey)).map((model) => ({
            api: "openai-completions",
            compat: { ...DEFAULT_COMPAT, ...(model.compat ?? {}) },
            contextWindow: 128_000,
            cost: DEFAULT_COST,
            id: model.id,
            input: ["text"],
            maxTokens: 16_384,
            name: model.name,
            reasoning: model.reasoning ?? false,
          })),
        },
      ];
    },
  });
});
