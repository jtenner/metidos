/**
 * @file src/bun/plugin/model-providers.ts
 * @description Plugin System v1 model provider catalog and Pi registry helpers.
 */

import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  createAssistantMessageEventStream,
  getProviders,
  type Model,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ModelRegistry } from "@mariozechner/pi-coding-agent";

export const PLUGIN_MODEL_PROVIDER_NO_MODELS_ID = "__no_models__";

const DEFAULT_PLUGIN_MODEL_API_KEY =
  "METIDOS_PLUGIN_MODEL_API_KEY_NOT_REQUIRED";
const DEFAULT_PLUGIN_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_PLUGIN_MODEL_MAX_TOKENS = 16_384;
const DEFAULT_PLUGIN_MODEL_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
};
const PI_BUILT_IN_PROVIDER_IDS = new Set<string>(getProviders());

type PiModelRegistryProviderConfig = Parameters<
  ModelRegistry["registerProvider"]
>[1];
type PiModelRegistryModelConfig = NonNullable<
  PiModelRegistryProviderConfig["models"]
>[number];
type PiModelRegistryModelCost = PiModelRegistryModelConfig["cost"];

export type PluginModelProviderRegistration = {
  configuration: Record<string, unknown>;
  configurationId: string;
  configurationLabel: string | null;
  directoryName: string;
  embedHandle?: string | null;
  executeHandle: string | null;
  pluginId: string;
  pluginName: string | null;
  providerId: string;
  providerName: string | null;
  providesEmbeddings?: boolean;
  refreshError: string | null;
  timeoutMs: number | null;
};

export type PluginModelProviderExecutionContext = {
  ownerUserId?: number | null;
  projectId: number;
  threadId: number;
  worktreePath: string;
};

export type PluginModelProviderExecutionAdapter = (input: {
  configuration: Record<string, unknown>;
  configurationId: string;
  context: PluginModelProviderExecutionContext & {
    contextKind: "providerExecution";
  };
  model: Model<Api>;
  modelContext: Context;
  options?: SimpleStreamOptions | undefined;
  pluginId: string;
  providerId: string;
  signal?: AbortSignal | undefined;
  timeoutMs?: number | null | undefined;
}) => Promise<unknown>;

export type PluginModelProviderRegistrationOptions = {
  execution?: {
    context: PluginModelProviderExecutionContext;
    execute: PluginModelProviderExecutionAdapter;
  };
};

export type PluginModelProviderCatalogStatus = {
  available: boolean;
  configurationId: string;
  hasModels: boolean;
  note: string | null;
  providerId: string;
  providerLabel: string;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringRecordValue(value: unknown): Record<string, string> | undefined {
  const record = objectValue(value);
  if (!record) {
    return undefined;
  }
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function thinkingLevelMapValue(
  value: unknown,
): PiModelRegistryModelConfig["thinkingLevelMap"] | undefined {
  const record = objectValue(value);
  if (!record) {
    return undefined;
  }
  const allowedLevels = new Set([
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ]);
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string | null] =>
      allowedLevels.has(entry[0]) &&
      (typeof entry[1] === "string" || entry[1] === null),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function inputKindsValue(value: unknown): ("text" | "image")[] {
  if (!Array.isArray(value)) {
    return ["text"];
  }
  const kinds = value.filter(
    (kind): kind is "text" | "image" => kind === "text" || kind === "image",
  );
  return kinds.length > 0 ? [...new Set(kinds)] : ["text"];
}

function modelReasoningValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  const record = objectValue(value);
  if (!record || !Array.isArray(record.efforts)) {
    return false;
  }
  return record.efforts.some(
    (effort) => typeof effort === "string" && effort.trim().length > 0,
  );
}

function costValue(value: unknown): PiModelRegistryModelCost {
  const record = objectValue(value);
  if (!record) {
    return { ...DEFAULT_PLUGIN_MODEL_COST };
  }
  return {
    cacheRead:
      typeof record.cacheRead === "number" && Number.isFinite(record.cacheRead)
        ? record.cacheRead
        : DEFAULT_PLUGIN_MODEL_COST.cacheRead,
    cacheWrite:
      typeof record.cacheWrite === "number" &&
      Number.isFinite(record.cacheWrite)
        ? record.cacheWrite
        : DEFAULT_PLUGIN_MODEL_COST.cacheWrite,
    input:
      typeof record.input === "number" && Number.isFinite(record.input)
        ? record.input
        : DEFAULT_PLUGIN_MODEL_COST.input,
    output:
      typeof record.output === "number" && Number.isFinite(record.output)
        ? record.output
        : DEFAULT_PLUGIN_MODEL_COST.output,
  };
}

export function pluginProviderRegistryId(input: {
  configurationId: string;
  pluginId: string;
  providerId: string;
}): string {
  return `${input.pluginId}/${input.providerId}/${input.configurationId}`;
}

export function resolvedPluginProviderRegistryId(input: {
  configurationId: string;
  pluginId: string;
  providerId: string;
}): string {
  return isPiBuiltInModelProviderId(input.providerId)
    ? input.providerId
    : pluginProviderRegistryId(input);
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    cacheRead: 0,
    cacheWrite: 0,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
      total: 0,
    },
    input: 0,
    output: 0,
    totalTokens: 0,
  };
}

function assistantMessageForPluginProvider(input: {
  errorMessage?: string | undefined;
  model: Model<Api>;
  stopReason: AssistantMessage["stopReason"];
  text: string;
}): AssistantMessage {
  const content =
    input.text.length > 0 ? [{ text: input.text, type: "text" as const }] : [];
  return {
    api: input.model.api,
    content,
    ...(input.errorMessage ? { errorMessage: input.errorMessage } : {}),
    model: input.model.id,
    provider: input.model.provider,
    role: "assistant",
    stopReason: input.stopReason,
    timestamp: Date.now(),
    usage: emptyUsage(),
  };
}

function pluginProviderExecutionText(result: unknown): {
  stopReason: "length" | "stop" | "toolUse";
  text: string;
} {
  if (typeof result === "string") {
    return { stopReason: "stop", text: result };
  }
  const record = objectValue(result);
  if (record) {
    const text = typeof record.text === "string" ? record.text : null;
    if (text !== null) {
      const stopReason =
        record.stopReason === "length" || record.stopReason === "toolUse"
          ? record.stopReason
          : "stop";
      return { stopReason, text };
    }
  }
  return { stopReason: "stop", text: JSON.stringify(result) ?? String(result) };
}

function createPluginModelProviderStream(input: {
  context: Context;
  execute: PluginModelProviderExecutionAdapter;
  executionContext: PluginModelProviderExecutionContext;
  model: Model<Api>;
  options?: SimpleStreamOptions | undefined;
  registration: PluginModelProviderRegistration;
}): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    try {
      const startMessage = assistantMessageForPluginProvider({
        model: input.model,
        stopReason: "stop",
        text: "",
      });
      stream.push({ partial: startMessage, type: "start" });
      const result = await input.execute({
        configuration: input.registration.configuration,
        configurationId: input.registration.configurationId,
        context: {
          ...input.executionContext,
          contextKind: "providerExecution",
        },
        model: input.model,
        modelContext: input.context,
        options: input.options,
        pluginId: input.registration.pluginId,
        providerId: input.registration.providerId,
        signal: input.options?.signal,
        timeoutMs: input.registration.timeoutMs,
      });
      const { stopReason, text } = pluginProviderExecutionText(result);
      const message = assistantMessageForPluginProvider({
        model: input.model,
        stopReason,
        text,
      });
      if (text.length > 0) {
        stream.push({
          contentIndex: 0,
          partial: startMessage,
          type: "text_start",
        });
        stream.push({
          contentIndex: 0,
          delta: text,
          partial: message,
          type: "text_delta",
        });
        stream.push({
          content: text,
          contentIndex: 0,
          partial: message,
          type: "text_end",
        });
      }
      stream.push({ message, reason: stopReason, type: "done" });
      stream.end();
    } catch (error) {
      const reason = input.options?.signal?.aborted ? "aborted" : "error";
      const message = assistantMessageForPluginProvider({
        errorMessage: error instanceof Error ? error.message : String(error),
        model: input.model,
        stopReason: reason,
        text: "",
      });
      stream.push({ error: message, reason, type: "error" });
      stream.end();
    }
  })();
  return stream;
}

export function isPluginModelProviderId(providerId: string): boolean {
  return providerId.split("/").length >= 3;
}

export function isPiBuiltInModelProviderId(providerId: string): boolean {
  return PI_BUILT_IN_PROVIDER_IDS.has(providerId);
}

export function pluginModelProviderKey(input: {
  configurationId: string;
  modelId: string;
  pluginId: string;
  providerId: string;
}): string {
  return `${input.pluginId}/${input.providerId}/${input.configurationId}/${input.modelId}`;
}

export function pluginModelProviderLabel(
  registration: PluginModelProviderRegistration,
): string {
  const providerName = registration.providerName ?? registration.providerId;
  const configurationName =
    registration.configurationLabel ?? registration.configurationId;
  return providerName === configurationName
    ? providerName
    : `${providerName}: ${configurationName}`;
}

function normalizePluginModel(
  model: Record<string, unknown>,
  providerApi: Api | undefined,
): PiModelRegistryModelConfig | null {
  const id = stringValue(model.id);
  if (!id) {
    return null;
  }
  const normalized: PiModelRegistryModelConfig = {
    contextWindow: numberValue(
      model.contextWindow,
      DEFAULT_PLUGIN_MODEL_CONTEXT_WINDOW_TOKENS,
    ),
    cost: costValue(model.cost),
    id,
    input: inputKindsValue(model.input),
    maxTokens: numberValue(model.maxTokens, DEFAULT_PLUGIN_MODEL_MAX_TOKENS),
    name: stringValue(model.name) ?? id,
    reasoning: modelReasoningValue(model.reasoning),
  };
  const modelApi = stringValue(model.api) ?? providerApi;
  if (modelApi) {
    normalized.api = modelApi;
  }
  const compat = objectValue(model.compat);
  if (compat) {
    normalized.compat = structuredClone(
      compat,
    ) as PiModelRegistryModelConfig["compat"];
  }
  const headers = stringRecordValue(model.headers);
  if (headers) {
    normalized.headers = headers;
  }
  const thinkingLevelMap = thinkingLevelMapValue(model.thinkingLevelMap);
  if (thinkingLevelMap) {
    normalized.thinkingLevelMap = thinkingLevelMap;
  }
  return normalized;
}

export function buildPluginModelProviderStatus(
  registration: PluginModelProviderRegistration,
  input: { available: boolean; hasModels: boolean; note: string | null },
): PluginModelProviderCatalogStatus {
  return {
    available: input.available,
    configurationId: registration.configurationId,
    hasModels: input.hasModels,
    note: input.note,
    providerId: resolvedPluginProviderRegistryId(registration),
    providerLabel: pluginModelProviderLabel(registration),
  };
}

export function registerPluginModelProviderConfigurations(
  registry: ModelRegistry,
  registrations: readonly PluginModelProviderRegistration[],
  options: PluginModelProviderRegistrationOptions = {},
): PluginModelProviderCatalogStatus[] {
  const statuses: PluginModelProviderCatalogStatus[] = [];
  for (const registration of registrations) {
    const rawModels = Array.isArray(registration.configuration.models)
      ? registration.configuration.models
      : [];
    const modelRecords = rawModels.flatMap((model) => {
      const record = objectValue(model);
      return record ? [record] : [];
    });
    if (modelRecords.length === 0) {
      statuses.push(
        buildPluginModelProviderStatus(registration, {
          available: false,
          hasModels: false,
          note: registration.refreshError ?? "No models",
        }),
      );
      continue;
    }

    const providerApi = stringValue(registration.configuration.api) as
      | Api
      | undefined;
    const models = modelRecords.flatMap((model) => {
      const normalized = normalizePluginModel(model, providerApi);
      return normalized ? [normalized] : [];
    });
    if (models.length === 0) {
      statuses.push(
        buildPluginModelProviderStatus(registration, {
          available: false,
          hasModels: false,
          note: registration.refreshError ?? "No models",
        }),
      );
      continue;
    }

    const providerId = resolvedPluginProviderRegistryId(registration);
    const providerConfig: PiModelRegistryProviderConfig = {
      apiKey:
        stringValue(registration.configuration.apiKey) ??
        DEFAULT_PLUGIN_MODEL_API_KEY,
      authHeader: booleanValue(registration.configuration.authHeader, false),
      models,
    };
    const execution = options.execution;
    if (registration.executeHandle && execution) {
      providerConfig.streamSimple = (model, context, streamOptions) =>
        createPluginModelProviderStream({
          context,
          execute: execution.execute,
          executionContext: execution.context,
          model,
          options: streamOptions,
          registration,
        });
    }
    const baseUrl = stringValue(registration.configuration.baseUrl);
    if (baseUrl) {
      providerConfig.baseUrl = baseUrl;
    }
    if (providerApi) {
      providerConfig.api = providerApi;
    }
    const headers = stringRecordValue(registration.configuration.headers);
    if (headers) {
      providerConfig.headers = headers;
    }

    try {
      registry.registerProvider(providerId, providerConfig);
      statuses.push(
        buildPluginModelProviderStatus(registration, {
          available: registration.refreshError === null,
          hasModels: true,
          note: registration.refreshError,
        }),
      );
    } catch (error) {
      statuses.push(
        buildPluginModelProviderStatus(registration, {
          available: false,
          hasModels: true,
          note: `Plugin model provider configuration invalid: ${
            error instanceof Error ? error.message : String(error)
          }`,
        }),
      );
    }
  }
  return statuses.sort((left, right) =>
    left.providerId.localeCompare(right.providerId),
  );
}
