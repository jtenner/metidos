import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_SETTING = "api_key";
const APP_ID_SETTING = "app_id";
const QIANFAN_API_KEY_ENV = "QIANFAN_API_KEY";
const BAIDU_QIANFAN_API_KEY_ENV = "BAIDU_QIANFAN_API_KEY";
const BAIDU_API_KEY_ENV = "BAIDU_API_KEY";
const API_KEY_SENTINEL = "METIDOS_QIANFAN_API_KEY_NOT_CONFIGURED";
const BASE_URL = "https://api.baiduqianfan.ai/v1";
const PROVIDER_TIMEOUT_MS = 30_000;
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
  { kind: "api_key", source: "env", value: QIANFAN_API_KEY_ENV },
  { kind: "api_key", source: "env", value: BAIDU_QIANFAN_API_KEY_ENV },
  { kind: "api_key", source: "env", value: BAIDU_API_KEY_ENV },
] as const;

type QianfanModel = {
  contextWindow: number;
  id: string;
  maxTokens: number;
  name: string;
};

export const QIANFAN_MODELS: readonly QianfanModel[] = [
  {
    contextWindow: 128_000,
    id: "ernie-5.0",
    maxTokens: 65_536,
    name: "ERNIE 5.0",
  },
  {
    contextWindow: 128_000,
    id: "deepseek-v3.2",
    maxTokens: 32_768,
    name: "DeepSeek V3.2",
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
    stringValue(metidos.env.get(QIANFAN_API_KEY_ENV)) ??
    stringValue(metidos.env.get(BAIDU_QIANFAN_API_KEY_ENV)) ??
    stringValue(metidos.env.get(BAIDU_API_KEY_ENV))
  );
}

function configuredHeaders(
  metidos: MetidosPluginApi,
): Record<string, string> | null {
  const appId = stringValue(metidos.settings.get(APP_ID_SETTING));
  return appId ? { appid: appId } : null;
}

function modelConfiguration(model: QianfanModel) {
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
    id: "qianfan",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const headers = configuredHeaders(metidos);
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Baidu Qianfan API key is not configured. Set the Qianfan api_key setting, QIANFAN_API_KEY, BAIDU_QIANFAN_API_KEY, or BAIDU_API_KEY.",
          authHeader: true,
          baseUrl: BASE_URL,
          ...(headers ? { headers } : {}),
          id: "default",
          label: "Baidu Qianfan",
          models: QIANFAN_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
