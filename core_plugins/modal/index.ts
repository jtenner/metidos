import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

export type ModalModel = {
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

const BASE_URL_ENV = "MODAL_BASE_URL";
const API_KEY_ENV = "MODAL_BEARER_TOKEN";
const MODEL_IDS_ENV = "MODAL_MODEL_IDS";
const BASE_URL_SETTING = "base_url";
const API_KEY_SETTING = "api_key";
const MODEL_IDS_SETTING = "model_ids";
const PLACEHOLDER_BASE_URL = "https://workspace--example-vllm-inference-serve.modal.run/v1";
const PROVIDER_TIMEOUT_MS = 30_000;
const DEFAULT_CONTEXT_WINDOW = 131_072;
const DEFAULT_MAX_TOKENS = 8192;
const DEFAULT_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const MODEL_COMPAT = {
  maxTokensField: "max_tokens",
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
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

function isAllowedModalHost(host: string): boolean {
  const normalized = host.toLowerCase();
  return normalized !== "modal.run" && normalized.endsWith(".modal.run");
}

export function normalizeModalBaseUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw || /[?#@]/u.test(raw)) {
    return null;
  }

  const match = raw.match(
    /^https:\/\/([A-Za-z0-9.-]+)(?::(443|[0-9]{1,5}))?(?:\/(?:v1\/?)?)?$/u,
  );
  if (!match) {
    return null;
  }

  const host = match[1]?.toLowerCase();
  const port = match[2] ?? null;
  if (!host || (port !== null && port !== "443") || !isAllowedModalHost(host)) {
    return null;
  }

  const normalizedPort = port ? `:${port}` : "";
  return `https://${host}${normalizedPort}/v1`;
}

function configuredBaseUrl(metidos: MetidosPluginApi): string | null {
  return normalizeModalBaseUrl(
    metidos.settings.get(BASE_URL_SETTING) ?? metidos.env.get(BASE_URL_ENV),
  );
}

function configuredApiKey(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(API_KEY_SETTING)) ??
    stringValue(metidos.env.get(API_KEY_ENV))
  );
}

export function normalizeModalModelId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized || normalized.length > 256 || /\s/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function modalModelName(id: string): string {
  const displayId = id.split("/").pop() ?? id;
  const cleaned = displayId
    .replace(/[._:/-]+/gu, " ")
    .replace(/\b[a-z]/gu, (letter) => letter.toUpperCase())
    .replace(/\bai\b/giu, "AI")
    .replace(/\bgpt\b/giu, "GPT")
    .replace(/\bllm\b/giu, "LLM")
    .replace(/\bvl\b/giu, "VL")
    .replace(/\b(\d+)b\b/giu, "$1B")
    .trim();
  return cleaned.length > 0 ? cleaned : id;
}

export function normalizeModalModels(values: readonly unknown[]): ModalModel[] {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const id = normalizeModalModelId(entry);
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
        name: modalModelName(id),
        reasoning: /reason|thinking|r1|qwq|o[1-9]|gpt-oss/iu.test(id),
      },
    ];
  });
}

function configuredModels(metidos: MetidosPluginApi): ModalModel[] {
  const settingModels = stringArrayValue(metidos.settings.get(MODEL_IDS_SETTING));
  const envModels = splitCommaSeparated(stringValue(metidos.env.get(MODEL_IDS_ENV)));
  return normalizeModalModels(settingModels ?? envModels);
}

function modelConfiguration(model: ModalModel) {
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
    id: "modal",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const baseUrl = configuredBaseUrl(metidos);
      const apiKey = configuredApiKey(metidos);
      const models = baseUrl ? configuredModels(metidos) : [];
      const hasModels = models.length > 0;

      return [
        {
          api: "openai-completions",
          ...(apiKey ? { apiKey, authHeader: true } : { authHeader: false }),
          baseUrl: baseUrl ?? PLACEHOLDER_BASE_URL,
          configurationMissing: baseUrl === null || !hasModels,
          configurationMissingMessage:
            baseUrl === null
              ? "Modal base_url is not configured or is not an HTTPS modal.run Web Function origin ending in /v1 or with no path. Set base_url or MODAL_BASE_URL from a deployed OpenAI-compatible Modal web server."
              : "Modal model IDs are not configured. Set model_ids or comma-separated MODAL_MODEL_IDS from the deployed vLLM served model name or /v1/models response.",
          id: "default",
          label: "Modal OpenAI-Compatible Endpoint",
          models: models.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
