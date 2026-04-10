/**
 * @file src/bun/project-procedures/model-catalog.ts
 * @description Pi-backed model catalog and model-identity helpers.
 */

import { join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getProviders } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  DEFAULT_THREAD_MODEL,
  DEFAULT_THREAD_REASONING_EFFORT,
  getAppDataDirectoryPath,
} from "../db";
import { createPiAuthStorage } from "../pi-codex-auth";
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
  "kimi-coding",
  "minimax",
  "mistral",
  "openai",
  "openai-codex",
  "openrouter",
  "xai",
  "zai",
]);
const PROVIDER_LABEL_OVERRIDES: Record<string, string> = {
  "amazon-bedrock": "Amazon Bedrock",
  anthropic: "Anthropic",
  "azure-openai-responses": "Azure OpenAI",
  google: "Google",
  "google-vertex": "Google Vertex",
  groq: "Groq",
  "kimi-coding": "Kimi Coding",
  minimax: "MiniMax",
  mistral: "Mistral",
  openai: "OpenAI API",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter",
  xai: "xAI",
  zai: "Z.AI",
};
const PROVIDER_ORDER = [
  "xai",
  "anthropic",
  "google",
  "google-vertex",
  "kimi-coding",
  "mistral",
  "minimax",
  "groq",
  "zai",
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
const RECENT_MODEL_ALLOWLIST_BY_PROVIDER = {
  "amazon-bedrock": [
    "amazon.nova-premier-v1:0",
    "amazon.nova-pro-v1:0",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "anthropic.claude-opus-4-6-v1",
    "anthropic.claude-sonnet-4-6",
  ],
  anthropic: [
    "claude-haiku-4-5",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-sonnet-4-6",
  ],
  "azure-openai-responses": [
    "gpt-5.2",
    "gpt-5.2-pro",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-pro",
  ],
  google: [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-flash-lite-preview",
    "gemini-3.1-pro-preview",
  ],
  "google-vertex": [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
  ],
  groq: [
    "groq/compound",
    "groq/compound-mini",
    "meta-llama/llama-4-maverick-17b-128e-instruct",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  "kimi-coding": ["k2p5", "kimi-k2-thinking"],
  minimax: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed"],
  mistral: [
    "codestral-latest",
    "devstral-medium-latest",
    "magistral-medium-latest",
    "mistral-medium-latest",
    "mistral-small-latest",
  ],
  openai: ["gpt-5.2", "gpt-5.2-pro", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-pro"],
  "openai-codex": [
    "gpt-5.2-codex",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.4",
    "gpt-5.4-mini",
  ],
  openrouter: [
    "openrouter/auto",
    "qwen/qwen3-coder-next",
    "qwen/qwen3-coder-plus",
    "qwen/qwen3-max-thinking",
    "qwen/qwen3.6-plus",
  ],
  xai: ["grok-4-1-fast", "grok-4.20-0309-reasoning", "grok-code-fast-1"],
  zai: ["glm-4.7", "glm-4.7-flashx", "glm-5", "glm-5-turbo", "glm-5.1"],
} satisfies Record<string, readonly string[]>;
const RECENT_MODEL_ALLOWLIST_SET_BY_PROVIDER = new Map<
  string,
  ReadonlySet<string>
>(
  Object.entries(RECENT_MODEL_ALLOWLIST_BY_PROVIDER).map(
    ([provider, modelIds]) => [provider, new Set(modelIds)],
  ),
);

type ModelCatalogEntry = {
  contextWindowTokens: number;
  key: string;
  modelId: string;
  option: RpcModelOption;
  provider: string;
  providerAvailabilityNote: string | null;
  providerAvailable: boolean;
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

function providerSortKey(
  provider: string,
  preferCodexProvider: boolean,
): [number, string] {
  if (provider === "openai-codex") {
    return [preferCodexProvider ? 0 : 1, provider];
  }
  if (provider === "openai") {
    return [preferCodexProvider ? 1 : 0, provider];
  }
  return [
    (PROVIDER_ORDER_INDEX.get(provider) ?? PROVIDER_ORDER.length) + 2,
    provider,
  ];
}

function shouldIncludeModel(model: Model<Api>): boolean {
  if (!BUILT_IN_PROVIDER_ALLOWLIST.has(model.provider)) {
    return !BUILT_IN_PROVIDER_SET.has(model.provider);
  }

  const curatedProviderModels = RECENT_MODEL_ALLOWLIST_SET_BY_PROVIDER.get(
    model.provider,
  );
  if (!curatedProviderModels) {
    return true;
  }
  return curatedProviderModels.has(model.id);
}

function compareCatalogEntries(
  left: ModelCatalogEntry,
  right: ModelCatalogEntry,
  preferCodexProvider: boolean,
): number {
  const [leftProviderRank, leftProviderName] = providerSortKey(
    left.provider,
    preferCodexProvider,
  );
  const [rightProviderRank, rightProviderName] = providerSortKey(
    right.provider,
    preferCodexProvider,
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
  const providerName = providerLabel(model.provider);
  return [
    `Provider: ${providerName}.`,
    `Model ID: ${model.id}.`,
    `Inputs: ${inputKinds}.`,
    model.reasoning
      ? "Supports thinking level control."
      : "No thinking-level control.",
    `Context window: ${TOKEN_FORMATTER.format(model.contextWindow)} tokens.`,
  ].join(" ");
}

function publicCatalogModelOption(
  model: Model<Api>,
  codexProviderAvailable: boolean,
  codexProviderAvailabilityNote: string | null,
): ModelCatalogEntry {
  const providerName = providerLabel(model.provider);
  const providerAvailable =
    model.provider !== "openai-codex" || codexProviderAvailable;
  const providerAvailabilityNote =
    model.provider === "openai-codex" && !providerAvailable
      ? (codexProviderAvailabilityNote ??
        'Requires Codex CLI sign-in via "codex login" with a usable shared auth file.')
      : null;
  return {
    contextWindowTokens: model.contextWindow,
    key: canonicalModelKey(model.provider, model.id),
    modelId: model.id,
    option: {
      contextWindowTokens: model.contextWindow,
      deprecated: false,
      group: providerName,
      id: canonicalModelKey(model.provider, model.id),
      label: model.name,
      modelId: model.id,
      providerAvailable,
      providerAvailabilityNote,
      providerId: model.provider,
      providerLabel: providerName,
      summary: buildModelSummary(model),
      supportsReasoningEffort: model.reasoning,
    },
    provider: model.provider,
    providerAvailabilityNote,
    providerAvailable,
    supportsReasoningEffort: model.reasoning,
  };
}

function unavailableCodexProviderNote(
  codexAuthState: ReturnType<typeof createPiAuthStorage>["codexAuthState"],
): string {
  switch (codexAuthState.codexCliAuthStatus) {
    case "logged_in_chatgpt":
      return 'Codex CLI is already signed in with ChatGPT, but Jolt cannot import that session automatically from OS or keyring storage. Switch Codex CLI to file storage and rerun "codex login", or use an existing shared auth.json cache.';
    case "logged_in_api_key":
      return 'Codex CLI is signed in with an API key. Use the separate OpenAI API provider, or rerun "codex login" for ChatGPT-plan-backed OpenAI Codex usage.';
    case "unknown":
      return codexAuthState.codexCliAuthDetail?.trim()
        ? `Codex CLI reported an unexpected auth state: ${codexAuthState.codexCliAuthDetail}`
        : 'Requires Codex CLI sign-in via "codex login" with a usable shared auth file.';
    default:
      return 'Requires Codex CLI sign-in via "codex login" with a usable shared auth file.';
  }
}

function buildModelCatalogState(): ModelCatalogState {
  const agentDirectory = join(
    getAppDataDirectoryPath(),
    PI_AGENT_DIRECTORY_NAME,
  );
  const { authStorage, codexAuthState } = createPiAuthStorage(agentDirectory);
  const preferCodexProvider = codexAuthState.source !== "none";
  const codexProviderAvailabilityNote = preferCodexProvider
    ? null
    : unavailableCodexProviderNote(codexAuthState);
  const entries = ModelRegistry.create(
    authStorage,
    join(agentDirectory, "models.json"),
  )
    .getAll()
    .filter(shouldIncludeModel)
    .map((model) =>
      publicCatalogModelOption(
        model,
        preferCodexProvider,
        codexProviderAvailabilityNote,
      ),
    )
    .sort((left, right) =>
      compareCatalogEntries(left, right, preferCodexProvider),
    );
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

  const preferredDefaultModel = byCanonicalKey.get(
    canonicalModelKey(
      preferCodexProvider ? "openai-codex" : "openai",
      DEFAULT_THREAD_MODEL,
    ),
  );
  const defaultModel =
    preferredDefaultModel ??
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
  return buildModelCatalogState();
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
    `Configure ${entry.option.providerLabel} in Settings before using it.`;
  return `${entry.option.providerLabel} is unavailable for ${entry.option.label}. ${guidance}`;
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
  const entry = requireCatalogModelEntry(model);
  return {
    contextWindowTokens: entry.contextWindowTokens,
    key: entry.key,
    modelId: entry.modelId,
    provider: entry.provider,
    providerAvailabilityNote: entry.providerAvailabilityNote,
    providerAvailable: entry.providerAvailable,
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
 * Validate that a model's backing provider is currently available.
 * Throws when the provider requires additional auth or setup before use.
 */
export function assertCodexModelProviderAvailable(
  model: string | null | undefined,
): void {
  const entry = requireCatalogModelEntry(model);
  if (!entry.providerAvailable) {
    throw new Error(unavailableCatalogModelMessage(entry));
  }
}

/**
 * Validate that a selected model is both recognized and currently runnable.
 */
export function resolveRunnableCodexModel(
  model: string | null | undefined,
): string {
  const entry = requireCatalogModelEntry(model);
  if (!entry.providerAvailable) {
    throw new Error(unavailableCatalogModelMessage(entry));
  }
  return entry.key;
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
