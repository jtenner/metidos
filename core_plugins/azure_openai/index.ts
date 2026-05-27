import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const API_KEY_ENV = "AZURE_OPENAI_API_KEY";
const API_KEY_SETTING = "api_key";
const DEPLOYMENTS_ENV = "AZURE_OPENAI_DEPLOYMENTS";
const DEPLOYMENTS_SETTING = "deployment_names";
const RESOURCE_NAME_ENV = "AZURE_OPENAI_RESOURCE_NAME";
const RESOURCE_NAME_SETTING = "resource_name";
const API_KEY_SENTINEL = "METIDOS_AZURE_OPENAI_API_KEY_NOT_CONFIGURED";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 16_384;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const MODEL_COMPAT = {
  supportsStore: false,
} as const;
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: API_KEY_SETTING,
  },
  { kind: "api_key", source: "env", value: API_KEY_ENV },
] as const;

export type AzureOpenAiDeploymentModel = {
  contextWindow: number;
  id: string;
  maxTokens: number;
  name: string;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.flatMap((entry) => {
    const normalized = stringValue(entry);
    return normalized ? [normalized] : [];
  });
  return entries.length > 0 ? entries : null;
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

export function normalizeAzureResourceName(value: unknown): string | null {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function configuredResourceName(metidos: MetidosPluginApi): string | null {
  return (
    normalizeAzureResourceName(metidos.settings.get(RESOURCE_NAME_SETTING)) ??
    normalizeAzureResourceName(metidos.env.get(RESOURCE_NAME_ENV))
  );
}

function splitCommaSeparated(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function normalizeAzureDeploymentName(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 128) {
    return null;
  }
  if (!/^[A-Za-z0-9._:-]+$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeAzureDeploymentModels(
  values: readonly unknown[],
): AzureOpenAiDeploymentModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeAzureDeploymentName(entry);
    if (!id || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [
      {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        id,
        maxTokens: DEFAULT_MAX_TOKENS,
        name: deploymentDisplayName(id),
      },
    ];
  });
}

function configuredDeploymentModels(
  metidos: MetidosPluginApi,
): AzureOpenAiDeploymentModel[] {
  const settingDeployments = stringArrayValue(
    metidos.settings.get(DEPLOYMENTS_SETTING),
  );
  const envDeployments = splitCommaSeparated(
    stringValue(metidos.env.get(DEPLOYMENTS_ENV)),
  );
  return normalizeAzureDeploymentModels(settingDeployments ?? envDeployments);
}

function deploymentDisplayName(id: string): string {
  const cleaned = id
    .replace(/[._:-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function azureOpenAiBaseUrl(resourceName: string): string {
  return `https://${resourceName}.openai.azure.com/openai/v1`;
}

function modelConfiguration(model: AzureOpenAiDeploymentModel) {
  return {
    api: "azure-openai-responses",
    compat: MODEL_COMPAT,
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
    id: "azure_openai",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const apiKey = configuredApiKey(metidos);
      const resourceName = configuredResourceName(metidos);
      const models = resourceName ? configuredDeploymentModels(metidos) : [];
      return [
        {
          api: "azure-openai-responses",
          apiKey: apiKey ?? API_KEY_SENTINEL,
          apiKeyMissing: apiKey === null,
          apiKeyMissingMessage:
            "Azure OpenAI API key is not configured. Set the Azure OpenAI api_key setting or AZURE_OPENAI_API_KEY.",
          authHeader: true,
          baseUrl: resourceName
            ? azureOpenAiBaseUrl(resourceName)
            : "https://example.openai.azure.com/openai/v1",
          configurationMissing: resourceName === null,
          configurationMissingMessage:
            "Azure OpenAI resource name is not configured. Set the resource_name Plugin Setting or AZURE_OPENAI_RESOURCE_NAME, and add one or more deployment_names.",
          id: "default",
          label: "Azure OpenAI",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
