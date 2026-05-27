import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_ENV = "INCEPTION_API_KEY";
const API_KEY_SETTING = "api_key";
const API_KEY_SENTINEL = "METIDOS_INCEPTION_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://api.inceptionlabs.ai/v1";
const DEFAULT_COST = {
  cacheRead: 0.025,
  cacheWrite: 0.25,
  input: 0.25,
  output: 0.75,
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

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "mercury",
    timeoutMs: 30_000,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Inception API key is not configured. Set the Inception api_key setting or INCEPTION_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          id: "default",
          label: "Inception Labs Mercury",
          piAuth: PI_AUTH,
          models: [
            {
              api: "openai-completions",
              compat: DEFAULT_COMPAT,
              contextWindow: 128_000,
              cost: DEFAULT_COST,
              id: "mercury-2",
              input: ["text"],
              maxTokens: 50_000,
              name: "Mercury 2",
              reasoning: true,
              thinkingLevelMap: {
                minimal: "instant",
                low: "low",
                medium: "medium",
                high: "high",
                xhigh: null,
              },
            },
          ],
        },
      ];
    },
  });
});
