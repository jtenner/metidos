/**
 * @file src/bun/project-procedures/model-catalog.ts
 * @description Pi-backed model catalog and model-identity helpers.
 */

import { join } from "node:path";
import {
  type Api,
  getModel,
  getSupportedThinkingLevels,
  type Model,
} from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";
import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  getAppDataDirectoryPath,
} from "../db";
import {
  isPiBuiltInModelProviderId,
  isPluginModelProviderId,
  PLUGIN_MODEL_PROVIDER_NO_MODELS_ID,
  resolvedPluginProviderRegistryId,
  type PluginModelProviderCatalogStatus,
  type PluginModelProviderRegistration,
  registerPluginModelProviderConfigurations,
} from "../plugin/model-providers";
import type {
  AppRPCSchema,
  RpcModelCatalog,
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
  RpcRequestContext,
} from "../rpc-schema";
import { requireLocalOperatorUserId } from "./local-operator";
import {
  getModelCatalogStateGeneration,
  invalidateModelCatalogState,
} from "./model-catalog-cache";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;
const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");
const PI_AGENT_DIRECTORY_NAME = "pi-agent";
const PI_AUTH_FILE_NAME = "auth.json";
const PI_MODELS_FILE_NAME = "models.json";
const FALLBACK_DEFAULT_MODEL_PROVIDER = "openai-codex";

type ModelCatalogEntry = {
  contextWindowTokens: number;
  key: string;
  modelId: string;
  option: RpcModelOption;
  provider: string;
  providerAvailabilityNote: string | null;
  providerAvailable: boolean;
  supportsEmbeddings: boolean;
  supportsImageInput: boolean;
  supportsReasoningEffort: boolean;
};

export type ResolvedCodexModelDescriptor = Pick<
  ModelCatalogEntry,
  | "contextWindowTokens"
  | "key"
  | "modelId"
  | "provider"
  | "providerAvailabilityNote"
  | "providerAvailable"
  | "supportsEmbeddings"
  | "supportsImageInput"
  | "supportsReasoningEffort"
>;

type ModelCatalogState = {
  byCanonicalKey: Map<string, ModelCatalogEntry>;
  byLegacyId: Map<string, ModelCatalogEntry>;
  defaultModel: ModelCatalogEntry;
  models: ModelCatalogEntry[];
};

type CachedModelCatalogState = {
  generation: number;
  state: ModelCatalogState;
};

const REASONING_EFFORT_OPTIONS: RpcReasoningEffortOption[] = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
];

const reasoningEffortOptionMap = new Map(
  REASONING_EFFORT_OPTIONS.map((option) => [option.id, option]),
);
const reasoningEffortIds = new Set<RpcReasoningEffort>(
  REASONING_EFFORT_OPTIONS.map((option) => option.id),
);
let cachedModelCatalogState: CachedModelCatalogState | null = null;
let pluginModelProviderSource:
  | (() => readonly PluginModelProviderRegistration[])
  | null = null;
let activeBuiltInModelProviderSource: (() => readonly string[]) | null = null;

export { invalidateModelCatalogState };

export function setPluginModelProviderCatalogSource(
  source: (() => readonly PluginModelProviderRegistration[]) | null,
): void {
  pluginModelProviderSource = source;
  invalidateModelCatalogState();
}

export function setActiveBuiltInModelProviderSource(
  source: (() => readonly string[]) | null,
): void {
  activeBuiltInModelProviderSource = source;
  invalidateModelCatalogState();
}

function piAgentDirectoryPath(): string {
  return join(getAppDataDirectoryPath(), PI_AGENT_DIRECTORY_NAME);
}

function canonicalModelKey(provider: string, modelId: string): string {
  if (isPluginModelProviderId(provider)) {
    return `${provider}/${modelId}`;
  }
  return `${provider}:${modelId}`;
}

function providerLabel(
  provider: string,
  providerLabels: ReadonlyMap<string, string> = new Map(),
): string {
  const pluginLabel = providerLabels.get(provider);
  if (pluginLabel) {
    return pluginLabel;
  }
  return provider
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function supportsConfigurableReasoningEffort(model: Model<Api>): boolean {
  return Boolean(model.reasoning);
}

function supportedReasoningEffortsForModel(
  model: Model<Api>,
): RpcReasoningEffort[] {
  if (!supportsConfigurableReasoningEffort(model)) {
    return [];
  }
  return getSupportedThinkingLevels(model).filter(
    (level): level is RpcReasoningEffort =>
      reasoningEffortIds.has(level as RpcReasoningEffort),
  );
}

function buildModelSummary(
  model: Model<Api>,
  providerLabels: ReadonlyMap<string, string> = new Map(),
): string {
  const providerName = providerLabel(model.provider, providerLabels);
  return [
    `Provider: ${providerName}.`,
    `Model ID: ${model.id}.`,
    `Inputs: ${model.input.join(", ")}.`,
    supportsConfigurableReasoningEffort(model)
      ? "Supports thinking level control."
      : "No thinking-level control.",
    `Context window: ${TOKEN_FORMATTER.format(model.contextWindow)} tokens.`,
  ].join(" ");
}

function publicCatalogModelOption(
  model: Model<Api>,
  providerLabels: ReadonlyMap<string, string> = new Map(),
  embeddingProviderIds: ReadonlySet<string> = new Set(),
): ModelCatalogEntry {
  const providerName = providerLabel(model.provider, providerLabels);
  const key = canonicalModelKey(model.provider, model.id);
  const supportsReasoningEffort = supportsConfigurableReasoningEffort(model);
  const supportedReasoningEfforts = supportedReasoningEffortsForModel(model);
  const supportsEmbeddings =
    embeddingProviderIds.has(model.provider) ||
    (model as unknown as { api?: unknown }).api === "embeddings" ||
    (model as unknown as { compat?: { providesEmbeddings?: unknown } }).compat
      ?.providesEmbeddings === true;
  return {
    contextWindowTokens: model.contextWindow,
    key,
    modelId: model.id,
    option: {
      contextWindowTokens: model.contextWindow,
      deprecated: false,
      group: providerName,
      id: key,
      isPlaceholder: false,
      label: model.name,
      modelId: model.id,
      // Registry models are available at construction time; plugin provider
      // status is applied immediately after this entry is built and can replace
      // these optimistic fields with unavailable metadata.
      providerAvailable: true,
      providerAvailabilityNote: null,
      providerId: model.provider,
      providerLabel: providerName,
      summary: buildModelSummary(model, providerLabels),
      supportsEmbeddings,
      supportsImageInput: model.input.includes("image"),
      supportsReasoningEffort,
      supportedReasoningEfforts,
    },
    provider: model.provider,
    providerAvailabilityNote: null,
    providerAvailable: true,
    supportsEmbeddings,
    supportsImageInput: model.input.includes("image"),
    supportsReasoningEffort,
  };
}

function unavailablePluginProviderModelEntry(
  entry: ModelCatalogEntry,
  status: PluginModelProviderCatalogStatus,
): ModelCatalogEntry {
  const note = status.note ?? "Plugin model provider refresh failed.";
  const option: RpcModelOption = {
    ...entry.option,
    providerAvailable: false,
    providerAvailabilityNote: note,
    summary: `${entry.option.summary} ${note}`,
  };
  return {
    ...entry,
    option,
    providerAvailabilityNote: note,
    providerAvailable: false,
  };
}

function pluginModelProviderPlaceholderEntry(
  status: PluginModelProviderCatalogStatus,
): ModelCatalogEntry {
  const note = status.note ?? "No models";
  const key = canonicalModelKey(
    status.providerId,
    PLUGIN_MODEL_PROVIDER_NO_MODELS_ID,
  );
  return {
    contextWindowTokens: 0,
    key,
    modelId: PLUGIN_MODEL_PROVIDER_NO_MODELS_ID,
    option: {
      contextWindowTokens: 0,
      deprecated: false,
      group: status.providerLabel,
      id: key,
      isPlaceholder: true,
      label: status.hasModels ? "Unavailable" : "No models",
      modelId: PLUGIN_MODEL_PROVIDER_NO_MODELS_ID,
      providerAvailable: false,
      providerAvailabilityNote: note,
      providerId: status.providerId,
      providerLabel: status.providerLabel,
      summary: status.hasModels
        ? `Plugin model provider configuration is unavailable. ${note}`
        : "Plugin model provider configuration is active but did not expose any models.",
      supportsEmbeddings: false,
      supportsImageInput: false,
      supportsReasoningEffort: false,
    },
    provider: status.providerId,
    providerAvailabilityNote: note,
    providerAvailable: false,
    supportsEmbeddings: false,
    supportsImageInput: false,
    supportsReasoningEffort: false,
  };
}

function unavailableDefaultModelEntry(): ModelCatalogEntry {
  const fallbackModel =
    getModel(FALLBACK_DEFAULT_MODEL_PROVIDER, DEFAULT_THREAD_MODEL) ??
    getModel("openai", DEFAULT_THREAD_MODEL);
  const provider = fallbackModel?.provider ?? FALLBACK_DEFAULT_MODEL_PROVIDER;
  const providerName = providerLabel(provider);
  const modelLabel = fallbackModel?.name ?? DEFAULT_THREAD_MODEL;
  const contextWindowTokens = fallbackModel?.contextWindow ?? 128_000;
  const supportsReasoningEffort = fallbackModel
    ? supportsConfigurableReasoningEffort(fallbackModel)
    : true;
  const supportedReasoningEfforts = fallbackModel
    ? supportedReasoningEffortsForModel(fallbackModel)
    : REASONING_EFFORT_OPTIONS.map((option) => option.id);
  const note =
    "No model providers are active. Configure a model provider before starting a thread.";
  const key = canonicalModelKey(provider, DEFAULT_THREAD_MODEL);
  return {
    contextWindowTokens,
    key,
    modelId: DEFAULT_THREAD_MODEL,
    option: {
      contextWindowTokens,
      deprecated: false,
      group: providerName,
      id: key,
      isPlaceholder: false,
      label: modelLabel,
      modelId: DEFAULT_THREAD_MODEL,
      providerAvailable: false,
      providerAvailabilityNote: note,
      providerId: provider,
      providerLabel: providerName,
      summary: fallbackModel
        ? `${buildModelSummary(fallbackModel)} ${note}`
        : `Provider: ${providerName}. Model ID: ${DEFAULT_THREAD_MODEL}. ${note}`,
      supportsEmbeddings: false,
      supportsImageInput: fallbackModel?.input.includes("image") ?? false,
      supportsReasoningEffort,
      supportedReasoningEfforts,
    },
    provider,
    providerAvailabilityNote: note,
    providerAvailable: false,
    supportsEmbeddings: false,
    supportsImageInput: fallbackModel?.input.includes("image") ?? false,
    supportsReasoningEffort,
  };
}

function compareCatalogEntries(
  left: ModelCatalogEntry,
  right: ModelCatalogEntry,
): number {
  if (left.option.providerLabel !== right.option.providerLabel) {
    return left.option.providerLabel.localeCompare(right.option.providerLabel);
  }
  if (left.option.label !== right.option.label) {
    return left.option.label.localeCompare(right.option.label);
  }
  return left.modelId.localeCompare(right.modelId);
}

function buildModelCatalogState(): ModelCatalogState {
  const agentDirectory = piAgentDirectoryPath();
  const authStorage = AuthStorage.create(
    join(agentDirectory, PI_AUTH_FILE_NAME),
  );
  const registry = ModelRegistry.create(
    authStorage,
    join(agentDirectory, PI_MODELS_FILE_NAME),
  );
  const pluginModelProviderRegistrations = pluginModelProviderSource?.() ?? [];
  const pluginModelProviderStatuses = registerPluginModelProviderConfigurations(
    registry,
    pluginModelProviderRegistrations,
  );
  const pluginOwnedProviderIds = new Set<string>();
  for (const registration of pluginModelProviderRegistrations) {
    if (isPiBuiltInModelProviderId(registration.providerId)) {
      continue;
    }
    pluginOwnedProviderIds.add(registration.providerId);
  }
  const pluginProviderLabels = new Map<string, string>();
  const embeddingProviderIds = new Set(
    pluginModelProviderRegistrations
      .filter((registration) => registration.providesEmbeddings)
      .map((registration) => resolvedPluginProviderRegistryId(registration)),
  );
  const pluginModelProviderStatusByProviderId = new Map<
    string,
    PluginModelProviderCatalogStatus
  >();
  const suppressedBuiltInProviderIds = new Set<string>();
  for (const status of pluginModelProviderStatuses) {
    pluginProviderLabels.set(status.providerId, status.providerLabel);
    pluginModelProviderStatusByProviderId.set(status.providerId, status);
    if (isPiBuiltInModelProviderId(status.providerId) && !status.available) {
      suppressedBuiltInProviderIds.add(status.providerId);
    }
  }
  const activeBuiltInModelProviderIds = activeBuiltInModelProviderSource
    ? new Set(activeBuiltInModelProviderSource())
    : null;
  const shouldFilterBuiltInProviders = activeBuiltInModelProviderIds !== null;

  const entries = registry
    .getAll()
    .filter((model) => {
      if (isPluginModelProviderId(model.provider)) {
        return true;
      }
      if (suppressedBuiltInProviderIds.has(model.provider)) {
        return false;
      }
      if (pluginOwnedProviderIds.has(model.provider)) {
        return false;
      }
      return (
        !shouldFilterBuiltInProviders ||
        activeBuiltInModelProviderIds.has(model.provider)
      );
    })
    .map((model) => {
      const entry = publicCatalogModelOption(
        model,
        pluginProviderLabels,
        embeddingProviderIds,
      );
      const status = pluginModelProviderStatusByProviderId.get(entry.provider);
      return status && !status.available
        ? unavailablePluginProviderModelEntry(entry, status)
        : entry;
    });
  const providerIdsWithModels = new Set(entries.map((entry) => entry.provider));
  for (const status of pluginModelProviderStatuses) {
    if (!providerIdsWithModels.has(status.providerId)) {
      entries.push(pluginModelProviderPlaceholderEntry(status));
    }
  }

  const entriesByKey = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    const previous = entriesByKey.get(entry.key);
    if (!previous || (!previous.providerAvailable && entry.providerAvailable)) {
      entriesByKey.set(entry.key, entry);
    }
  }
  entries.splice(0, entries.length, ...entriesByKey.values());

  entries.sort(compareCatalogEntries);
  if (entries.length === 0) {
    entries.push(unavailableDefaultModelEntry());
  }

  const byCanonicalKey = new Map<string, ModelCatalogEntry>();
  const byLegacyId = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    byCanonicalKey.set(entry.key, entry);
    if (!byLegacyId.has(entry.modelId)) {
      byLegacyId.set(entry.modelId, entry);
    }
  }
  const defaultModel =
    byLegacyId.get(DEFAULT_THREAD_MODEL) ??
    byCanonicalKey.get(DEFAULT_THREAD_MODEL) ??
    entries.find((entry) => entry.providerAvailable) ??
    (entries[0] as ModelCatalogEntry);

  return {
    byCanonicalKey,
    byLegacyId,
    defaultModel,
    models: entries,
  };
}

function getModelCatalogState(): ModelCatalogState {
  const generation = getModelCatalogStateGeneration();
  if (
    cachedModelCatalogState &&
    cachedModelCatalogState.generation === generation
  ) {
    return cachedModelCatalogState.state;
  }

  const state = buildModelCatalogState();
  cachedModelCatalogState = {
    generation,
    state,
  };
  return state;
}

function findCatalogModelEntry(
  model: string | null | undefined,
): ModelCatalogEntry | null {
  const normalized = model?.trim();
  if (!normalized) {
    return getModelCatalogState().defaultModel;
  }

  const state = getModelCatalogState();
  return (
    state.byCanonicalKey.get(normalized) ??
    state.byLegacyId.get(normalized) ??
    null
  );
}

function requireCatalogModelEntry(
  model: string | null | undefined,
): ModelCatalogEntry {
  const normalized = model?.trim();
  const entry = findCatalogModelEntry(normalized);
  if (!entry) {
    throw new Error(`Unsupported model: ${normalized}`);
  }
  return entry;
}

function unavailableCatalogModelMessage(entry: ModelCatalogEntry): string {
  const guidance =
    entry.providerAvailabilityNote ??
    `Configure ${entry.option.providerLabel} before using it.`;
  return `${entry.option.providerLabel} is unavailable for ${entry.option.label}. ${guidance}`;
}

export function buildModelCatalog(): RpcModelCatalog {
  const state = getModelCatalogState();
  return {
    defaultModel: state.defaultModel.key,
    defaultReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    models: state.models.map((model) => model.option),
    reasoningEfforts: REASONING_EFFORT_OPTIONS,
  };
}

/**
 * RPC procedure: return the current provider-backed model catalog.
 */

export async function getModelCatalogProcedure(
  params?: AppRPCSchema["requests"]["getModelCatalog"]["params"],
  context?: RpcRequestContext,
): Promise<RpcModelCatalog> {
  requireLocalOperatorUserId(context);
  if (params?.refresh || params?.refreshProviders) {
    invalidateModelCatalogState();
  }
  return buildModelCatalog();
}

export function resolveCodexModelDescriptor(
  model: string | null | undefined,
): ResolvedCodexModelDescriptor {
  const entry = requireCatalogModelEntry(model);
  return {
    contextWindowTokens: entry.contextWindowTokens,
    key: entry.key,
    modelId: entry.modelId,
    provider: entry.provider,
    providerAvailabilityNote: entry.providerAvailabilityNote,
    providerAvailable: entry.providerAvailable,
    supportsEmbeddings: entry.supportsEmbeddings,
    supportsImageInput: entry.supportsImageInput,
    supportsReasoningEffort: entry.supportsReasoningEffort,
  };
}

export function contextWindowTokensForModel(
  model: string | null | undefined,
): number {
  return (
    findCatalogModelEntry(model)?.contextWindowTokens ??
    getModelCatalogState().defaultModel.contextWindowTokens
  );
}

export function heuristicCompactionTriggerTokens(
  model: string | null | undefined,
): number {
  return Math.round(
    contextWindowTokensForModel(model) * DEFAULT_COMPACTION_ESTIMATE_RATIO,
  );
}

export function resolveCodexModel(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).key;
}

export function assertCodexModelProviderAvailable(
  model: string | null | undefined,
): void {
  const entry = requireCatalogModelEntry(model);
  if (!entry.providerAvailable) {
    throw new Error(unavailableCatalogModelMessage(entry));
  }
}

export function resolveRunnableCodexModel(
  model: string | null | undefined,
): string {
  const entry = requireCatalogModelEntry(model);
  if (!entry.providerAvailable) {
    throw new Error(unavailableCatalogModelMessage(entry));
  }
  return entry.key;
}

export function normalizeStoredCodexModel(
  model: string | null | undefined,
): string {
  return (
    findCatalogModelEntry(model)?.key ?? getModelCatalogState().defaultModel.key
  );
}

export function codexModelProvider(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).provider;
}

export function codexModelApiId(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).modelId;
}

export function codexModelSupportsReasoningEffort(
  model: string | null | undefined,
): boolean {
  return resolveCodexModelDescriptor(model).supportsReasoningEffort;
}

export function resolveCodexReasoningEffort(
  reasoningEffort: string | null | undefined,
): RpcReasoningEffort {
  const normalized = reasoningEffort?.trim() as RpcReasoningEffort | undefined;
  if (!normalized) {
    return DEFAULT_THREAD_REASONING_EFFORT;
  }
  if (!reasoningEffortOptionMap.has(normalized)) {
    throw new Error(`Unsupported reasoning effort: ${normalized}`);
  }
  return normalized;
}

export function normalizeStoredCodexReasoningEffort(
  reasoningEffort: string | null | undefined,
): RpcReasoningEffort {
  const normalized = reasoningEffort?.trim() as RpcReasoningEffort | undefined;
  if (!normalized || !reasoningEffortOptionMap.has(normalized)) {
    return DEFAULT_THREAD_REASONING_EFFORT;
  }
  return normalized;
}
