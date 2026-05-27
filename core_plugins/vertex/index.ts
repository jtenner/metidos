import { definePlugin, type MetidosPluginApi } from "@metidos/plugin-api";

const ACCESS_TOKEN_SETTING = "access_token";
const ACCESS_TOKEN_ENVS = [
  "GOOGLE_VERTEX_ACCESS_TOKEN",
  "VERTEX_AI_ACCESS_TOKEN",
] as const;
const PROJECT_ID_SETTING = "project_id";
const PROJECT_ID_ENV = "GOOGLE_VERTEX_PROJECT_ID";
const LOCATION_SETTING = "location";
const LOCATION_ENV = "GOOGLE_VERTEX_LOCATION";
const DEFAULT_LOCATION = "global";
const PROVIDER_TIMEOUT_MS = 30_000;
const ACCESS_TOKEN_SENTINEL = "METIDOS_VERTEX_ACCESS_TOKEN_NOT_CONFIGURED";
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
    value: ACCESS_TOKEN_SETTING,
  },
  {
    kind: "api_key",
    source: "env",
    value: "GOOGLE_VERTEX_ACCESS_TOKEN",
  },
  {
    kind: "api_key",
    source: "env",
    value: "VERTEX_AI_ACCESS_TOKEN",
  },
] as const;

export type VertexModel = {
  contextWindow: number;
  id: string;
  input: ("image" | "text")[];
  maxTokens: number;
  name: string;
  reasoning: boolean;
};

const STATIC_VERTEX_CHAT_MODELS: readonly VertexModel[] = [
  {
    contextWindow: 1_048_576,
    id: "google/gemini-2.5-pro",
    input: ["text", "image"],
    maxTokens: 65_536,
    name: "Gemini 2.5 Pro",
    reasoning: true,
  },
  {
    contextWindow: 1_048_576,
    id: "google/gemini-2.5-flash",
    input: ["text", "image"],
    maxTokens: 65_536,
    name: "Gemini 2.5 Flash",
    reasoning: true,
  },
  {
    contextWindow: 1_048_576,
    id: "google/gemini-2.0-flash-001",
    input: ["text", "image"],
    maxTokens: 8_192,
    name: "Gemini 2.0 Flash",
    reasoning: false,
  },
  {
    contextWindow: 1_048_576,
    id: "google/gemini-2.0-flash-lite-001",
    input: ["text", "image"],
    maxTokens: 8_192,
    name: "Gemini 2.0 Flash-Lite",
    reasoning: false,
  },
];

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function configuredAccessToken(metidos: MetidosPluginApi): string | null {
  return (
    stringValue(metidos.settings.get(ACCESS_TOKEN_SETTING)) ??
    ACCESS_TOKEN_ENVS.map((key) => stringValue(metidos.env.get(key))).find(
      (value): value is string => value !== null,
    ) ??
    null
  );
}

export function normalizeVertexProjectId(value: unknown): string | null {
  const normalized = stringValue(value);
  if (!normalized) {
    return null;
  }
  if (normalized.length > 128) {
    return null;
  }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function configuredProjectId(metidos: MetidosPluginApi): string | null {
  return (
    normalizeVertexProjectId(metidos.settings.get(PROJECT_ID_SETTING)) ??
    normalizeVertexProjectId(metidos.env.get(PROJECT_ID_ENV))
  );
}

export function normalizeVertexLocation(value: unknown): string | null {
  const normalized = stringValue(value)?.toLowerCase();
  if (!normalized || !/^(?:global|[a-z]+-[a-z]+[0-9])$/u.test(normalized)) {
    return null;
  }
  return normalized;
}

function configuredLocation(metidos: MetidosPluginApi): string {
  return (
    normalizeVertexLocation(metidos.settings.get(LOCATION_SETTING)) ??
    normalizeVertexLocation(metidos.env.get(LOCATION_ENV)) ??
    DEFAULT_LOCATION
  );
}

export function vertexOpenAiBaseUrl(projectId: string, location: string): string {
  return `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/endpoints/openapi`;
}

function modelConfiguration(model: VertexModel) {
  return {
    api: "openai-completions",
    compat: MODEL_COMPAT,
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
    id: "vertex",
    timeoutMs: PROVIDER_TIMEOUT_MS,
    getProviderConfigurations() {
      const accessToken = configuredAccessToken(metidos);
      const projectId = configuredProjectId(metidos);
      const location = configuredLocation(metidos);
      const configurationMissing = projectId === null;
      return [
        {
          api: "openai-completions",
          apiKey: accessToken ?? ACCESS_TOKEN_SENTINEL,
          apiKeyMissing: accessToken === null,
          apiKeyMissingMessage:
            "Google Vertex AI access token is not configured. Set the access_token Plugin Setting, GOOGLE_VERTEX_ACCESS_TOKEN, or VERTEX_AI_ACCESS_TOKEN.",
          authHeader: true,
          baseUrl: projectId
            ? vertexOpenAiBaseUrl(projectId, location)
            : vertexOpenAiBaseUrl("example-project", location),
          configurationMissing,
          configurationMissingMessage:
            "Google Vertex AI project ID is not configured. Set the project_id Plugin Setting or GOOGLE_VERTEX_PROJECT_ID.",
          id: projectId ? `${projectId}-${location}` : "default",
          label: "Google Vertex AI",
          models: configurationMissing
            ? []
            : STATIC_VERTEX_CHAT_MODELS.map(modelConfiguration),
          piAuth: PI_AUTH,
        },
      ];
    },
  });
});
