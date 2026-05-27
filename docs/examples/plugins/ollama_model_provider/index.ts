import {
  definePlugin,
  type MetidosModelProviderExecutionRequest,
  type MetidosModelProviderExecutionResult,
  type MetidosPluginApi,
  type MetidosProviderConfiguration,
} from "@metidos/plugin-api";

type OllamaModel = {
  contextWindow?: number;
  id: string;
  maxTokens?: number;
  name?: string;
};

type OllamaProviderConfig = {
  baseUrl: string;
  discoverModels: boolean;
  id: string;
  label?: string;
  models: OllamaModel[];
};

type OllamaProviderConfiguration = MetidosProviderConfiguration & {
  baseUrl: string;
  id: string;
  label?: string;
  models: Array<{
    api: "chat";
    contextWindow: number;
    cost: {
      cacheRead: number;
      cacheWrite: number;
      input: number;
      output: number;
    };
    id: string;
    input: ["text"];
    maxTokens: number;
    name: string;
  }>;
};

const DEFAULT_PROVIDERS: OllamaProviderConfig[] = [
  {
    baseUrl: "http://localhost:11434",
    discoverModels: true,
    id: "local",
    label: "Local Ollama",
    models: [],
  },
];

function sanitizeId(value: unknown, fallback: string): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  const normalized = raw.replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z][a-z0-9_]{0,63}$/.test(normalized) ? normalized : fallback;
}

function normalizeBaseUrl(value: unknown): string {
  const raw =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "http://localhost:11434";
  const withoutTrailingSlash = raw.replace(/\/+$/g, "");
  if (
    withoutTrailingSlash === "http://localhost:11434" ||
    withoutTrailingSlash === "http://127.0.0.1:11434"
  ) {
    return withoutTrailingSlash;
  }
  throw new Error(
    `Ollama baseUrl ${withoutTrailingSlash} is not covered by this example manifest allowlist.`,
  );
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : fallback;
}

function configuredModel(value: unknown): OllamaModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  if (!id) {
    return null;
  }
  return {
    contextWindow: positiveInteger(record.contextWindow, 131_072),
    id,
    maxTokens: positiveInteger(record.maxTokens, 8192),
    name:
      typeof record.name === "string" && record.name.trim()
        ? record.name.trim()
        : id,
  };
}

function providerConfig(
  value: unknown,
  index: number,
): OllamaProviderConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const models = Array.isArray(record.models)
    ? record.models.flatMap((model) => {
        const parsed = configuredModel(model);
        return parsed ? [parsed] : [];
      })
    : [];
  const label =
    typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : undefined;
  return {
    baseUrl: normalizeBaseUrl(record.baseUrl),
    discoverModels: record.discoverModels !== false,
    id: sanitizeId(record.id, `ollama_${index + 1}`),
    ...(label ? { label } : {}),
    models,
  };
}

async function logWarning(
  metidos: MetidosPluginApi,
  message: string,
): Promise<void> {
  try {
    await metidos.log?.("warn", message);
  } catch {
    // Logging is optional in this example; never fail provider startup for diagnostics.
  }
}

async function loadProviderConfigs(
  metidos: MetidosPluginApi,
): Promise<OllamaProviderConfig[]> {
  try {
    const parsed = JSON.parse(
      await metidos.fs.readText("~/providers.json"),
    ) as { providers?: unknown };
    const providers = Array.isArray(parsed.providers)
      ? parsed.providers.flatMap((provider, index) => {
          const config = providerConfig(provider, index);
          return config ? [config] : [];
        })
      : [];
    return providers.length > 0 ? providers : DEFAULT_PROVIDERS;
  } catch (error) {
    await logWarning(
      metidos,
      `Falling back to default Ollama provider config: ${error instanceof Error ? error.message : String(error)}`,
    );
    return DEFAULT_PROVIDERS;
  }
}

function normalizeOllamaTagModel(value: unknown): OllamaModel | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : null;
  return id ? { id, name: id } : null;
}

async function discoverModels(
  metidos: MetidosPluginApi,
  config: OllamaProviderConfig,
): Promise<OllamaModel[]> {
  if (!config.discoverModels) {
    return config.models;
  }
  try {
    const response = await metidos.fetch(`${config.baseUrl}/api/tags`, {
      method: "GET",
    });
    const payload = (await response.json()) as { models?: unknown };
    const discovered = Array.isArray(payload.models)
      ? payload.models.flatMap((model) => {
          const parsed = normalizeOllamaTagModel(model);
          return parsed ? [parsed] : [];
        })
      : [];
    return discovered;
  } catch (error) {
    await logWarning(
      metidos,
      `Ollama model discovery failed for ${config.id}; no models discovered: ${error instanceof Error ? error.message : String(error)}`,
    );
    return [];
  }
}

function providerModel(
  model: OllamaModel,
): OllamaProviderConfiguration["models"][number] {
  return {
    api: "chat",
    contextWindow: positiveInteger(model.contextWindow, 131_072),
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: model.id,
    input: ["text"],
    maxTokens: positiveInteger(model.maxTokens, 8192),
    name: model.name ?? model.id,
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part &&
        typeof part === "object" &&
        typeof (part as { text?: unknown }).text === "string"
          ? (part as { text: string }).text
          : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function ollamaMessages(
  messages: unknown,
): Array<{ content: string; role: "assistant" | "system" | "user" }> {
  if (!Array.isArray(messages)) {
    return [{ content: "Hello from Metidos.", role: "user" }];
  }
  const converted = messages.flatMap((message) => {
    if (!message || typeof message !== "object") {
      return [];
    }
    const record = message as Record<string, unknown>;
    const role: "assistant" | "system" | "user" =
      record.role === "assistant" || record.role === "system"
        ? record.role
        : "user";
    const content = contentText(record.content);
    return content ? [{ content, role }] : [];
  });
  return converted.length > 0
    ? converted
    : [{ content: "Hello from Metidos.", role: "user" }];
}

async function executeOllama(
  metidos: MetidosPluginApi,
  request: MetidosModelProviderExecutionRequest,
): Promise<MetidosModelProviderExecutionResult> {
  const baseUrl = normalizeBaseUrl(request.configuration.baseUrl);
  const model =
    typeof request.model.id === "string" && request.model.id.trim()
      ? request.model.id.trim()
      : typeof request.model.name === "string" && request.model.name.trim()
        ? request.model.name.trim()
        : "llama3.2";
  const response = await metidos.fetch(`${baseUrl}/api/chat`, {
    body: JSON.stringify({
      messages: ollamaMessages(request.modelContext?.messages),
      model,
      stream: false,
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const payload = (await response.json()) as {
    done_reason?: unknown;
    message?: { content?: unknown };
    response?: unknown;
  };
  const text =
    typeof payload.message?.content === "string"
      ? payload.message.content
      : typeof payload.response === "string"
        ? payload.response
        : "";
  return {
    stopReason: payload.done_reason === "length" ? "length" : "stop",
    text,
  };
}

function refreshIntervalMs(metidos: MetidosPluginApi): number {
  let configuredMinutes: unknown;
  try {
    configuredMinutes = metidos.settings.get("refresh_interval_minutes");
  } catch {
    configuredMinutes = undefined;
  }
  const minutes = positiveInteger(configuredMinutes, 10);
  return Math.max(1, minutes) * 60_000;
}

export default definePlugin((rawMetidos) => {
  const metidos = rawMetidos;
  metidos.providers.addProvider({
    id: "ollama",
    refreshIntervalMs: refreshIntervalMs(metidos),
    timeoutMs: 30_000,
    async getProviderConfigurations() {
      const configs = await loadProviderConfigs(metidos);
      return Promise.all(
        configs.map(async (config) => {
          const models = (await discoverModels(metidos, config)).map(
            providerModel,
          );
          return {
            baseUrl: config.baseUrl,
            id: config.id,
            ...(config.label ? { label: config.label } : {}),
            models,
          };
        }),
      );
    },
    async execute(_context, request) {
      return executeOllama(metidos, request);
    },
  });
});
