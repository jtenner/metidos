import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type SageMakerRegion = (typeof SAGEMAKER_REGIONS)[number];

export type SageMakerModel = {
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

const BEARER_TOKEN_ENV = "SAGEMAKER_BEARER_TOKEN";
const AWS_BEARER_TOKEN_ENV = "AWS_BEARER_TOKEN_SAGEMAKER";
const BEARER_TOKEN_SETTING = "bearer_token";
const ENDPOINT_NAME_ENV = "SAGEMAKER_ENDPOINT_NAME";
const ENDPOINT_NAME_SETTING = "endpoint_name";
const INFERENCE_COMPONENT_ENV = "SAGEMAKER_INFERENCE_COMPONENT_NAME";
const INFERENCE_COMPONENT_SETTING = "inference_component_name";
const MODEL_IDS_ENV = "SAGEMAKER_MODEL_IDS";
const MODEL_IDS_SETTING = "model_ids";
const REGION_SETTING = "region";
const API_KEY_SENTINEL = "METIDOS_SAGEMAKER_BEARER_TOKEN_NOT_CONFIGURED";
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
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsStore: false,
} as const;
const PI_AUTH = [
  {
    kind: "api_key",
    source: "setting",
    value: BEARER_TOKEN_SETTING,
  },
  { kind: "api_key", source: "env", value: BEARER_TOKEN_ENV },
  { kind: "api_key", source: "env", value: AWS_BEARER_TOKEN_ENV },
] as const;

export const SAGEMAKER_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "af-south-1",
  "ap-east-1",
  "ap-south-1",
  "ap-south-2",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ca-central-1",
  "ca-west-1",
  "eu-central-1",
  "eu-central-2",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-north-1",
  "eu-south-1",
  "eu-south-2",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
  "sa-east-1",
] as const;

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

function splitCommaSeparated(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function configuredBearerToken(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(BEARER_TOKEN_SETTING)) ??
    stringValue(metidos.env.get(BEARER_TOKEN_ENV)) ??
    stringValue(metidos.env.get(AWS_BEARER_TOKEN_ENV))
  );
}

export function sagemakerRegion(value: unknown): SageMakerRegion {
  const raw = stringValue(value);
  return SAGEMAKER_REGIONS.includes(raw as SageMakerRegion)
    ? (raw as SageMakerRegion)
    : "us-east-1";
}

function configuredRegion(metidos: MetidosPluginApi): SageMakerRegion {
  return sagemakerRegion(metidos.settings.get(REGION_SETTING));
}

export function normalizeSageMakerEndpointName(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 63) {
    return null;
  }
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u.test(
    normalized,
  )
    ? normalized
    : null;
}

function configuredEndpointName(metidos: MetidosPluginApi): string | null {
  return (
    normalizeSageMakerEndpointName(metidos.settings.get(ENDPOINT_NAME_SETTING)) ??
    normalizeSageMakerEndpointName(metidos.env.get(ENDPOINT_NAME_ENV))
  );
}

export function normalizeSageMakerModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

export function normalizeSageMakerModels(values: readonly unknown[]): SageMakerModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeSageMakerModelId(entry);
    if (!id || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [
      {
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        cost: DEFAULT_COST,
        id,
        input: ["text"],
        maxTokens: DEFAULT_MAX_TOKENS,
        name: sagemakerModelName(id),
        reasoning: false,
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): SageMakerModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeSageMakerModels(settingModels ?? envModels);
}

function sagemakerModelName(id: string): string {
  const cleaned = id
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function sagemakerBaseUrl(input: {
  endpointName: string;
  inferenceComponentName?: string | null;
  region: SageMakerRegion;
}): string {
  const endpointBase = `https://runtime.sagemaker.${input.region}.amazonaws.com/endpoints/${input.endpointName}`;
  const inferenceComponentName = normalizeSageMakerEndpointName(
    input.inferenceComponentName,
  );
  return inferenceComponentName
    ? `${endpointBase}/inference-components/${inferenceComponentName}/openai/v1`
    : `${endpointBase}/openai/v1`;
}

function configuredInferenceComponentName(
  metidos: MetidosPluginApi,
): string | null {
  return (
    normalizeSageMakerEndpointName(
      metidos.settings.get(INFERENCE_COMPONENT_SETTING),
    ) ?? normalizeSageMakerEndpointName(metidos.env.get(INFERENCE_COMPONENT_ENV))
  );
}

function modelConfiguration(model: SageMakerModel) {
  return {
    api: "openai-completions",
    compat: MODEL_COMPAT,
    contextWindow: model.contextWindow,
    cost: model.cost,
    id: model.id,
    input: model.input,
    maxTokens: model.maxTokens,
    name: model.name,
    reasoning: model.reasoning,
  };
}

export default definePlugin((metidos) => {
  metidos.providers.addProvider({
    id: "sagemaker",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const bearerToken = configuredBearerToken(metidos);
      const endpointName = configuredEndpointName(metidos);
      const inferenceComponentName = configuredInferenceComponentName(metidos);
      const region = configuredRegion(metidos);
      const models = endpointName ? configuredModels(metidos) : [];
      return [
        {
          api: "openai-completions",
          apiKey: bearerToken ?? API_KEY_SENTINEL,
          apiKeyMissing: bearerToken === null,
          apiKeyMissingMessage:
            "Amazon SageMaker bearer token is not configured. Generate a short-lived token outside Metidos and set bearer_token, SAGEMAKER_BEARER_TOKEN, or AWS_BEARER_TOKEN_SAGEMAKER.",
          authHeader: true,
          baseUrl: endpointName
            ? sagemakerBaseUrl({ endpointName, inferenceComponentName, region })
            : "https://runtime.sagemaker.us-east-1.amazonaws.com/endpoints/example/openai/v1",
          configurationMissing: endpointName === null,
          configurationMissingMessage:
            "Amazon SageMaker endpoint name is not configured. Set endpoint_name or SAGEMAKER_ENDPOINT_NAME, and add one or more model_ids or SAGEMAKER_MODEL_IDS.",
          id: "default",
          label: `Amazon SageMaker AI (${region})`,
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
