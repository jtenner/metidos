import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type ZaiEndpointMode = "general_api" | "coding_plan";

type ZaiModel = {
  contextWindow: number;
  id: string;
  input: ("text" | "image")[];
  maxTokens: number;
  name: string;
};

const API_KEY_ENV = "ZAI_API_KEY";
const API_KEY_SETTING = "api_key";
const ENDPOINT_SETTING = "endpoint";
const GENERAL_API_BASE_URL = "https://api.z.ai/api/paas/v4";
const CODING_PLAN_BASE_URL = "https://api.z.ai/api/coding/paas/v4";
const API_KEY_SENTINEL = "METIDOS_ZAI_API_KEY_NOT_CONFIGURED";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;
const MODEL_COMPAT = {
  supportsDeveloperRole: false,
  thinkingFormat: "zai",
  zaiToolStream: true,
} as const;
const ZAI_MODELS: ZaiModel[] = [
  {
    contextWindow: 131_072,
    id: "glm-4.5-air",
    input: ["text"],
    maxTokens: 98_304,
    name: "GLM-4.5-Air",
  },
  {
    contextWindow: 204_800,
    id: "glm-4.7",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-4.7",
  },
  {
    contextWindow: 202_800,
    id: "glm-5.1",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5.1",
  },
  {
    contextWindow: 202_800,
    id: "glm-5",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5",
  },
  {
    contextWindow: 200_000,
    id: "glm-5-turbo",
    input: ["text"],
    maxTokens: 131_072,
    name: "GLM-5-Turbo",
  },
  {
    contextWindow: 200_000,
    id: "glm-5v-turbo",
    input: ["text", "image"],
    maxTokens: 131_072,
    name: "GLM-5V-Turbo",
  },
];

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

function endpointMode(value: unknown): ZaiEndpointMode {
  return value === "coding_plan" ? "coding_plan" : "general_api";
}

function baseUrlForEndpoint(mode: ZaiEndpointMode): string {
  return mode === "coding_plan" ? CODING_PLAN_BASE_URL : GENERAL_API_BASE_URL;
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "zai",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    async getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const baseUrl = baseUrlForEndpoint(
        endpointMode(metidos.settings.get(ENDPOINT_SETTING)),
      );

      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Z.AI API key is not configured. Set the Z.AI api_key setting or ZAI_API_KEY.",
          authHeader: true,
          baseUrl,
          id: "default",
          label: "Z.AI",
          models: ZAI_MODELS.map((model) => ({
            compat: MODEL_COMPAT,
            contextWindow: model.contextWindow,
            cost: DEFAULT_COST,
            id: model.id,
            input: model.input,
            maxTokens: model.maxTokens,
            name: model.name,
            reasoning: true,
          })),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
