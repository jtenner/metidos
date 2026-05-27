import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_ENV = "UPSTAGE_API_KEY";
const API_KEY_SETTING = "api_key";
const API_KEY_SENTINEL = "METIDOS_UPSTAGE_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://api.upstage.ai/v1";
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const DEFAULT_COMPAT = {
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsStore: false,
};
const REASONING_LEVEL_MAP = {
  high: "high",
  low: "minimal",
  medium: "high",
  minimal: "minimal",
  xhigh: null,
};
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;

export const UPSTAGE_MODELS = [
  {
    contextWindow: 128_000,
    id: "solar-pro3",
    maxTokens: 8_192,
    name: "Solar Pro 3",
    reasoning: true,
    thinkingLevelMap: REASONING_LEVEL_MAP,
  },
  {
    contextWindow: 65_536,
    id: "solar-pro2",
    maxTokens: 8_192,
    name: "Solar Pro 2",
    reasoning: true,
    thinkingLevelMap: REASONING_LEVEL_MAP,
  },
  {
    contextWindow: 32_768,
    id: "solar-mini",
    maxTokens: 4_096,
    name: "Solar Mini",
    reasoning: false,
  },
] as const;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

function modelConfiguration(model: (typeof UPSTAGE_MODELS)[number]) {
  return {
    api: "openai-completions",
    compat: DEFAULT_COMPAT,
    contextWindow: model.contextWindow,
    cost: DEFAULT_COST,
    id: model.id,
    input: ["text"],
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
    ...(model.reasoning ? { thinkingLevelMap: model.thinkingLevelMap } : {}),
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "upstage",
    timeoutMs: 30_000,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Upstage API key is not configured. Set the Upstage api_key setting or UPSTAGE_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Upstage",
          models: UPSTAGE_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
