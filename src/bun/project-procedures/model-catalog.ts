/**
 * @file src/bun/project-procedures/model-catalog.ts
 * @description Pi-backed model catalog and model-identity helpers.
 */

import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getProviders } from "@mariozechner/pi-ai";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  getAppDataDirectoryPath,
} from "../db";
import type {
  RpcModelCatalog,
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../rpc-schema";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;
const PI_AGENT_DIRECTORY_NAME = "pi-agent";
const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");
const BUILT_IN_PROVIDER_SET = new Set<string>(getProviders());
const BUILT_IN_PROVIDER_ALLOWLIST = new Set([
  "amazon-bedrock",
  "anthropic",
  "azure-openai-responses",
  "google",
  "google-vertex",
  "groq",
  "mistral",
  "openai",
  "openrouter",
  "xai",
]);
const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  google: "Google",
  "google-vertex": "Google Vertex",
  groq: "Groq",
  mistral: "Mistral",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
};
const PROVIDER_ORDER = [
  "openai",
  "xai",
  "anthropic",
  "google",
  "google-vertex",
  "mistral",
  "groq",
  "amazon-bedrock",
  "azure-openai-responses",
  "openrouter",
] as const;
const PROVIDER_ORDER_INDEX = new Map<string, number>(
  PROVIDER_ORDER.map((provider, index) => [provider, index] as const),
);
const LEGACY_MODEL_ALIASES = {
  "grok-4-1-fast-reasoning": {
    modelId: "grok-4-1-fast",
    provider: "xai",
  },
  "grok-4.20-reasoning": {
    modelId: "grok-4.20-0309-reasoning",
    provider: "xai",
  },
} satisfies Record<string, { modelId: string; provider: string }>;

type ModelCatalogEntry = {
  contextWindowTokens: number;
  key: string;
  modelId: string;
  option: RpcModelOption;
  provider: string;
  supportsReasoningEffort: boolean;
};

export type ResolvedCodexModelDescriptor = Pick<
  ModelCatalogEntry,
  | "contextWindowTokens"
  | "key"
  | "modelId"
  | "provider"
  | "supportsReasoningEffort"
>;

type ModelCatalogState = {
  byCanonicalKey: Map<string, ModelCatalogEntry>;
  byLegacyId: Map<string, ModelCatalogEntry>;
  defaultModel: ModelCatalogEntry;
  models: ModelCatalogEntry[];
};

/**
 * Available reasoning-effort values mirrored from supported model controls.
 */
const REASONING_EFFORT_OPTIONS: RpcReasoningEffortOption[] = [
  {
    id: "minimal",
    label: "Minimal",
  },
  {
    id: "low",
    label: "Low",
  },
  {
    id: "medium",
    label: "Medium",
  },
  {
    id: "high",
    label: "High",
  },
  {
    id: "xhigh",
    label: "Extra High",
  },
];

const reasoningEffortOptionMap = new Map(
  REASONING_EFFORT_OPTIONS.map((option) => [option.id, option]),
);

let cachedModelCatalogState: ModelCatalogState | null = null;

function canonicalModelKey(provider: string, modelId: string): string {
  return `${provider}:${modelId}`;
}

function providerLabel(provider: string): string {
  const override = PROVIDER_LABEL_OVERRIDES[provider];
  if (override) {
    return override;
  }

  return provider
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function providerSortKey(provider: string): [number, string] {
  return [
    PROVIDER_ORDER_INDEX.get(provider) ?? PROVIDER_ORDER.length,
    provider,
  ];
}

function shouldIncludeModel(model: Model<Api>): boolean {
  return (
    BUILT_IN_PROVIDER_ALLOWLIST.has(model.provider) ||
    !BUILT_IN_PROVIDER_SET.has(model.provider)
  );
}

function compareCatalogEntries(
  left: ModelCatalogEntry,
  right: ModelCatalogEntry,
): number {
  const [leftProviderRank, leftProviderName] = providerSortKey(left.provider);
  const [rightProviderRank, rightProviderName] = providerSortKey(
    right.provider,
  );
  if (leftProviderRank !== rightProviderRank) {
    return leftProviderRank - rightProviderRank;
  }
  if (leftProviderName !== rightProviderName) {
    return leftProviderName.localeCompare(rightProviderName);
  }
  if (left.option.label !== right.option.label) {
    return left.option.label.localeCompare(right.option.label);
  }
  return left.modelId.localeCompare(right.modelId);
}

function buildModelSummary(model: Model<Api>): string {
  const inputKinds = model.input.join(", ");
  return [
    `Provider: ${providerLabel(model.provider)}.`,
    `Inputs: ${inputKinds}.`,
    model.reasoning
      ? "Supports reasoning effort."
      : "No reasoning-effort control.",
    `Context window: ${TOKEN_FORMATTER.format(model.contextWindow)} tokens.`,
  ].join(" ");
}

function publicCatalogModelOption(model: Model<Api>): ModelCatalogEntry {
  return {
    contextWindowTokens: model.contextWindow,
    key: canonicalModelKey(model.provider, model.id),
    modelId: model.id,
    option: {
      contextWindowTokens: model.contextWindow,
      deprecated: false,
      group: providerLabel(model.provider),
      id: canonicalModelKey(model.provider, model.id),
      label: model.name,
      summary: buildModelSummary(model),
    },
    provider: model.provider,
    supportsReasoningEffort: model.reasoning,
  };
}

function createModelRegistry(): ModelRegistry {
  const agentDirectory = join(
    getAppDataDirectoryPath(),
    PI_AGENT_DIRECTORY_NAME,
  );
  const authStorage = AuthStorage.create(join(agentDirectory, "auth.json"));
  return ModelRegistry.create(authStorage, join(agentDirectory, "models.json"));
}

function buildModelCatalogState(): ModelCatalogState {
  const entries = createModelRegistry()
    .getAll()
    .filter(shouldIncludeModel)
    .map(publicCatalogModelOption)
    .sort(compareCatalogEntries);
  if (entries.length === 0) {
    throw new Error("Pi model registry did not expose any catalog entries.");
  }

  const byCanonicalKey = new Map<string, ModelCatalogEntry>();
  const byLegacyId = new Map<string, ModelCatalogEntry>();
  for (const entry of entries) {
    byCanonicalKey.set(entry.key, entry);
    if (!byLegacyId.has(entry.modelId)) {
      byLegacyId.set(entry.modelId, entry);
    }
  }
  for (const [legacyId, target] of Object.entries(LEGACY_MODEL_ALIASES)) {
    const canonicalKey = canonicalModelKey(target.provider, target.modelId);
    const targetEntry = byCanonicalKey.get(canonicalKey);
    if (targetEntry) {
      byLegacyId.set(legacyId, targetEntry);
    }
  }

  const defaultModel =
    byLegacyId.get(DEFAULT_THREAD_MODEL) ??
    byCanonicalKey.get(DEFAULT_THREAD_MODEL) ??
    entries[0];
  if (!defaultModel) {
    throw new Error("Pi model catalog did not resolve a default model.");
  }

  return {
    byCanonicalKey,
    byLegacyId,
    defaultModel,
    models: entries,
  };
}

function getModelCatalogState(): ModelCatalogState {
  if (cachedModelCatalogState) {
    return cachedModelCatalogState;
  }
  cachedModelCatalogState = buildModelCatalogState();
  return cachedModelCatalogState;
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

/**
 * Build the full model catalog payload consumed by front-end settings.
 */
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
 * Resolve the catalog descriptor for a model string.
 * Accepts canonical provider-qualified ids and legacy raw ids.
 */
export function resolveCodexModelDescriptor(
  model: string | null | undefined,
): ResolvedCodexModelDescriptor {
  const normalized = model?.trim();
  const entry = findCatalogModelEntry(normalized);
  if (!entry) {
    throw new Error(`Unsupported model: ${normalized}`);
  }
  return {
    contextWindowTokens: entry.contextWindowTokens,
    key: entry.key,
    modelId: entry.modelId,
    provider: entry.provider,
    supportsReasoningEffort: entry.supportsReasoningEffort,
  };
}

/**
 * Resolve a model to its declared context-window size.
 * Unknown/null values fall back to the default catalog entry.
 */
export function contextWindowTokensForModel(
  model: string | null | undefined,
): number {
  return (
    findCatalogModelEntry(model)?.contextWindowTokens ??
    getModelCatalogState().defaultModel.contextWindowTokens
  );
}

/**
 * Estimate when to trigger context compaction for a given model.
 * Uses a fixed ratio to avoid filling context windows to the edge.
 */
export function heuristicCompactionTriggerTokens(
  model: string | null | undefined,
): number {
  return Math.round(
    contextWindowTokensForModel(model) * DEFAULT_COMPACTION_ESTIMATE_RATIO,
  );
}

/**
 * Validate and return a canonical provider-qualified model id.
 * Throws if the model is not recognized.
 */
export function resolveCodexModel(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).key;
}

/**
 * Normalize persisted model ids.
 * Unknown values are silently reset to the default catalog model.
 */
export function normalizeStoredCodexModel(
  model: string | null | undefined,
): string {
  return (
    findCatalogModelEntry(model)?.key ?? getModelCatalogState().defaultModel.key
  );
}

/**
 * Resolve the API provider backing a configured model id.
 * Unknown/null values normalize through the default model first.
 */
export function codexModelProvider(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).provider;
}

/**
 * Resolve the provider-native model id used by Pi and remaining Codex-era helpers.
 */
export function codexModelApiId(model: string | null | undefined): string {
  return resolveCodexModelDescriptor(model).modelId;
}

/**
 * Whether the selected model accepts a reasoning-effort override.
 */
export function codexModelSupportsReasoningEffort(
  model: string | null | undefined,
): boolean {
  return resolveCodexModelDescriptor(model).supportsReasoningEffort;
}

/**
 * Validate and return a reasoning-effort value.
 * Throws if the value is not supported.
 */
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

/**
 * Normalize persisted reasoning-effort values.
 * Unknown values are silently reset to the default effort.
 */
export function normalizeStoredCodexReasoningEffort(
  reasoningEffort: string | null | undefined,
): RpcReasoningEffort {
  const normalized = reasoningEffort?.trim() as RpcReasoningEffort | undefined;
  if (!normalized || !reasoningEffortOptionMap.has(normalized)) {
    return DEFAULT_THREAD_REASONING_EFFORT;
  }
  return normalized;
}
