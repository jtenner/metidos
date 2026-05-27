import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

type TokenHubRegion =
  | "guangzhou"
  | "guangzhou_legacy"
  | "singapore"
  | "singapore_legacy";

type TokenHubModel = {
  contextWindow: number;
  id: string;
  input: ["text"];
  maxTokens: number;
  name: string;
  reasoning: boolean;
};

const API_KEY_SETTING = "api_key";
const REGION_SETTING = "region";
const TOKENHUB_API_KEY_ENV = "TENCENT_TOKENHUB_API_KEY";
const TENCENT_MAAS_API_KEY_ENV = "TENCENT_MAAS_API_KEY";
const HUNYUAN_API_KEY_ENV = "HUNYUAN_API_KEY";
const API_KEY_SENTINEL = "METIDOS_TOKENHUB_API_KEY_NOT_CONFIGURED";
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
const REASONING_LEVEL_MAP = {
  high: "high",
  low: "low",
  medium: "medium",
  minimal: null,
  xhigh: null,
};
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: TOKENHUB_API_KEY_ENV },
  { kind: "api_key", source: "env", value: TENCENT_MAAS_API_KEY_ENV },
  { kind: "api_key", source: "env", value: HUNYUAN_API_KEY_ENV },
] as const;

const BASE_URLS: Record<TokenHubRegion, string> = {
  guangzhou: "https://tokenhub.tencentcloudmaas.com/v1",
  guangzhou_legacy: "https://tokenhub.tencentmaas.com/v1",
  singapore: "https://tokenhub-intl.tencentcloudmaas.com/v1",
  singapore_legacy: "https://tokenhub-intl.tencentmaas.com/v1",
};

export const TOKENHUB_MODELS: readonly TokenHubModel[] = [
  {
    contextWindow: 256_000,
    id: "hy3-preview",
    input: ["text"],
    maxTokens: 128_000,
    name: "Hy3 Preview",
    reasoning: true,
  },
  {
    contextWindow: 192_000,
    id: "hunyuan-2.0-thinking-20251109",
    input: ["text"],
    maxTokens: 64_000,
    name: "Hunyuan 2.0 Think 09",
    reasoning: true,
  },
  {
    contextWindow: 144_000,
    id: "hunyuan-2.0-instruct-20251111",
    input: ["text"],
    maxTokens: 16_000,
    name: "Hunyuan 2.0 Instruct 11",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    id: "deepseek-v3.2",
    input: ["text"],
    maxTokens: 32_000,
    name: "DeepSeek V3.2",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    id: "deepseek-v3.1-terminus",
    input: ["text"],
    maxTokens: 32_000,
    name: "DeepSeek V3.1 Terminus",
    reasoning: false,
  },
  {
    contextWindow: 128_000,
    id: "deepseek-r1-0528",
    input: ["text"],
    maxTokens: 16_000,
    name: "DeepSeek R1 0528",
    reasoning: true,
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
    stringValue(metidos.env.get(TOKENHUB_API_KEY_ENV)) ??
    stringValue(metidos.env.get(TENCENT_MAAS_API_KEY_ENV)) ??
    stringValue(metidos.env.get(HUNYUAN_API_KEY_ENV))
  );
}

export function tokenHubRegion(value: unknown): TokenHubRegion {
  return value === "guangzhou" ||
    value === "guangzhou_legacy" ||
    value === "singapore_legacy"
    ? value
    : "singapore";
}

export function tokenHubBaseUrl(region: TokenHubRegion): string {
  return BASE_URLS[region];
}

function modelConfiguration(model: TokenHubModel) {
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
    ...(model.reasoning ? { thinkingLevelMap: REASONING_LEVEL_MAP } : {}),
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "tokenhub",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const region = tokenHubRegion(metidos.settings.get(REGION_SETTING));
      return [
        {
          api: "openai-completions",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Tencent TokenHub API key is not configured. Set the TokenHub api_key setting, TENCENT_TOKENHUB_API_KEY, TENCENT_MAAS_API_KEY, or HUNYUAN_API_KEY.",
          authHeader: true,
          baseUrl: tokenHubBaseUrl(region),
          id: region,
          label: `Tencent TokenHub (${region.replace("_", " ")})`,
          models: TOKENHUB_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
