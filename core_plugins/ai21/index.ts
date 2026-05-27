import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_ENV = "AI21_API_KEY";
const API_KEY_SETTING = "api_key";
const API_KEY_SENTINEL = "METIDOS_AI21_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://api.ai21.com/studio/v1";
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
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;

export const AI21_MODELS = [
  {
    contextWindow: 256_000,
    id: "jamba-large",
    maxTokens: 4_096,
    name: "Jamba Large",
  },
  {
    contextWindow: 256_000,
    id: "jamba-mini",
    maxTokens: 4_096,
    name: "Jamba Mini",
  },
  {
    contextWindow: 256_000,
    id: "jamba-large-1.7",
    maxTokens: 4_096,
    name: "Jamba Large 1.7",
  },
  {
    contextWindow: 256_000,
    id: "jamba-mini-2",
    maxTokens: 4_096,
    name: "Jamba Mini 2",
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

function modelConfiguration(model: (typeof AI21_MODELS)[number]) {
  return {
    api: "openai-completions",
    compat: DEFAULT_COMPAT,
    contextWindow: model.contextWindow,
    cost: DEFAULT_COST,
    id: model.id,
    input: ["text"],
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: false,
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "ai21",
    timeoutMs: 30_000,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "AI21 API key is not configured. Set the AI21 api_key setting or AI21_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "AI21",
          models: AI21_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
