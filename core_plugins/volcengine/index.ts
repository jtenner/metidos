import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_SETTING = "api_key";
const API_KEY_ENVS = ["ARK_API_KEY", "VOLCENGINE_API_KEY"] as const;
const API_KEY_SENTINEL = "METIDOS_VOLCENGINE_ARK_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const DEFAULT_COMPAT = {
  supportsDeveloperRole: false,
  supportsStore: false,
};
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: "ARK_API_KEY" },
  { kind: "api_key", source: "env", value: "VOLCENGINE_API_KEY" },
] as const;

export const VOLCENGINE_ARK_MODELS = [
  {
    contextWindow: 256_000,
    id: "doubao-seed-2-0-pro-260215",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Doubao Seed 2.0 Pro",
    reasoning: true,
  },
  {
    contextWindow: 256_000,
    id: "doubao-seed-2-0-lite-260215",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Doubao Seed 2.0 Lite",
    reasoning: true,
  },
  {
    contextWindow: 256_000,
    id: "doubao-seed-2-0-mini-260215",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Doubao Seed 2.0 Mini",
    reasoning: true,
  },
  {
    contextWindow: 256_000,
    id: "doubao-seed-1-8-251228",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Doubao Seed 1.8",
    reasoning: true,
  },
  {
    contextWindow: 256_000,
    id: "doubao-seed-1-6-251015",
    input: ["text"],
    maxTokens: 32_768,
    name: "Doubao Seed 1.6",
    reasoning: false,
  },
  {
    contextWindow: 256_000,
    id: "doubao-seed-1-6-vision-250815",
    input: ["text", "image"],
    maxTokens: 32_768,
    name: "Doubao Seed 1.6 Vision",
    reasoning: false,
  },
] as const;

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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

function modelConfiguration(model: (typeof VOLCENGINE_ARK_MODELS)[number]) {
  return {
    api: "openai-completions",
    compat: DEFAULT_COMPAT,
    contextWindow: model.contextWindow,
    cost: DEFAULT_COST,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "volcengine",
    timeoutMs: 30_000,
    getProviderConfigurations() {
      const apiKey = configuredGlobalOrEnvApiKey(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Volcengine Ark API key is not configured. Set the volcengine api_key setting, ARK_API_KEY, or VOLCENGINE_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Volcengine Ark",
          models: VOLCENGINE_ARK_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
