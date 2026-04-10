/**
 * @file src/bun/project-procedures/model-catalog.ts
 * @description Pi-backed model catalog and model-identity helpers.
 */

import { dirname } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { getProviders } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

import { DEFAULT_THREAD_MODEL, DEFAULT_THREAD_REASONING_EFFORT } from "../db";
import { createPiAuthStorage } from "../pi-codex-auth";
import type {
  RpcModelCatalog,
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../rpc-schema";
import {
  buildPiModelsJsonPath,
  getOllamaProviderConfigSnapshot,
  OLLAMA_PROVIDER_ID,
} from "./ollama-provider-config";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;
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

type ProviderSetupStatus = {
  available: boolean;
  note: string | null;
};

type ProviderSetupRequirement = {
  envHint: string;
  isConfigured: (
    authStorage: ReturnType<typeof createPiAuthStorage>["authStorage"],
    env: NodeJS.ProcessEnv,
  ) => boolean;
};

const PROVIDER_SETUP_REQUIREMENTS: Partial<
  Record<string, ProviderSetupRequirement>
> = {
  "amazon-bedrock": {
    envHint:
      "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (or AWS_PROFILE / AWS_BEARER_TOKEN_BEDROCK)",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "amazon-bedrock") ||
      hasConfiguredEnvValue(env, "AWS_PROFILE") ||
      hasConfiguredEnvValue(env, "AWS_BEARER_TOKEN_BEDROCK") ||
      (hasConfiguredEnvValue(env, "AWS_ACCESS_KEY_ID") &&
        hasConfiguredEnvValue(env, "AWS_SECRET_ACCESS_KEY")) ||
      hasConfiguredEnvValue(env, "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") ||
      hasConfiguredEnvValue(env, "AWS_CONTAINER_CREDENTIALS_FULL_URI") ||
      hasConfiguredEnvValue(env, "AWS_WEB_IDENTITY_TOKEN_FILE"),
  },
  anthropic: {
    envHint: "ANTHROPIC_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "anthropic") ||
      hasConfiguredEnvValue(env, "ANTHROPIC_API_KEY") ||
      hasConfiguredEnvValue(env, "ANTHROPIC_OAUTH_TOKEN"),
  },
  "azure-openai-responses": {
    envHint:
      "AZURE_OPENAI_API_KEY and AZURE_OPENAI_BASE_URL (or AZURE_OPENAI_RESOURCE_NAME)",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "azure-openai-responses") ||
      (hasConfiguredEnvValue(env, "AZURE_OPENAI_API_KEY") &&
        (hasConfiguredEnvValue(env, "AZURE_OPENAI_BASE_URL") ||
          hasConfiguredEnvValue(env, "AZURE_OPENAI_RESOURCE_NAME"))),
  },
  google: {
    envHint: "GEMINI_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "google") ||
      hasConfiguredEnvValue(env, "GEMINI_API_KEY"),
  },
  "google-vertex": {
    envHint:
      "GOOGLE_CLOUD_API_KEY (or GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION)",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "google-vertex") ||
      hasConfiguredEnvValue(env, "GOOGLE_CLOUD_API_KEY") ||
      ((hasConfiguredEnvValue(env, "GOOGLE_CLOUD_PROJECT") ||
        hasConfiguredEnvValue(env, "GCLOUD_PROJECT")) &&
        hasConfiguredEnvValue(env, "GOOGLE_CLOUD_LOCATION")),
  },
  groq: {
    envHint: "GROQ_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "groq") ||
      hasConfiguredEnvValue(env, "GROQ_API_KEY"),
  },
  "kimi-coding": {
    envHint: "KIMI_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "kimi-coding") ||
      hasConfiguredEnvValue(env, "KIMI_API_KEY"),
  },
  minimax: {
    envHint: "MINIMAX_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "minimax") ||
      hasConfiguredEnvValue(env, "MINIMAX_API_KEY"),
  },
  mistral: {
    envHint: "MISTRAL_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "mistral") ||
      hasConfiguredEnvValue(env, "MISTRAL_API_KEY"),
  },
  openai: {
    envHint: "OPENAI_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "openai") ||
      hasConfiguredEnvValue(env, "OPENAI_API_KEY"),
  },
  openrouter: {
    envHint: "OPENROUTER_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "openrouter") ||
      hasConfiguredEnvValue(env, "OPENROUTER_API_KEY"),
  },
  xai: {
    envHint: "XAI_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "xai") ||
      hasConfiguredEnvValue(env, "XAI_API_KEY"),
  },
  zai: {
    envHint: "ZAI_API_KEY",
    isConfigured: (authStorage, env) =>
      hasStoredProviderCredential(authStorage, "zai") ||
      hasConfiguredEnvValue(env, "ZAI_API_KEY"),
  },
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

function hasConfiguredEnvValue(
  env: NodeJS.ProcessEnv,
  variableName: string,
): boolean {
  const value = env[variableName];
  return typeof value === "string" && value.trim().length > 0;
}

function hasStoredProviderCredential(
  authStorage: ReturnType<typeof createPiAuthStorage>["authStorage"],
  providerId: string,
): boolean {
  return authStorage.get(providerId) != null;
}

function providerSetupMessage(provider: string, envHint: string): string {
  return `${providerLabel(provider)} is not setup. Please add your key to the env variable ${envHint}.`;
}

function codexProviderSetupMessage(): string {
  return "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.";
}

function providerSetupStatus(
  provider: string,
  authStorage: ReturnType<typeof createPiAuthStorage>["authStorage"],
  codexAuthState: ReturnType<typeof createPiAuthStorage>["codexAuthState"],
  env: NodeJS.ProcessEnv,
): ProviderSetupStatus {
  if (provider === "openai-codex") {
    const available = codexAuthState.source !== "none";
    return {
      available,
      note: available ? null : codexProviderSetupMessage(),
    };
  }

  const requirement = PROVIDER_SETUP_REQUIREMENTS[provider];
  if (!requirement) {
    return {
      available: true,
      note: null,
    };
  }

  const available = requirement.isConfigured(authStorage, env);
  return {
    available,
    note: available
      ? null
      : providerSetupMessage(provider, requirement.envHint),
  };
}

function resolveProviderSetupStatuses(
  authStorage: ReturnType<typeof createPiAuthStorage>["authStorage"],
  codexAuthState: ReturnType<typeof createPiAuthStorage>["codexAuthState"],
  env: NodeJS.ProcessEnv,
): Map<string, ProviderSetupStatus> {
  const statuses = new Map<string, ProviderSetupStatus>();
  for (const provider of BUILT_IN_PROVIDER_ALLOWLIST) {
    statuses.set(
      provider,
      providerSetupStatus(provider, authStorage, codexAuthState, env),
    );
  }
  return statuses;
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
  providerStatuses: ReadonlyMap<string, ProviderSetupStatus>,
): ModelCatalogEntry {
  const providerName = providerLabel(model.provider);
  const providerStatus = providerStatuses.get(model.provider) ?? {
    available: true,
    note: null,
  };
  const providerAvailable = providerStatus.available;
  const providerAvailabilityNote = providerStatus.note;
  return {
    contextWindowTokens: model.contextWindow,
    key: canonicalModelKey(model.provider, model.id),
    modelId: model.id,
    option: {
      contextWindowTokens: model.contextWindow,
      deprecated: false,
      group: providerName,
      id: canonicalModelKey(model.provider, model.id),
      isPlaceholder: false,
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

function ollamaPlaceholderEntry(note: string): ModelCatalogEntry {
  const providerName = providerLabel(OLLAMA_PROVIDER_ID);
  return {
    contextWindowTokens: 0,
    key: canonicalModelKey(OLLAMA_PROVIDER_ID, "__setup__"),
    modelId: "__setup__",
    option: {
      contextWindowTokens: 0,
      deprecated: false,
      group: providerName,
      id: canonicalModelKey(OLLAMA_PROVIDER_ID, "__setup__"),
      isPlaceholder: true,
      label: "Setup required",
      modelId: "__setup__",
      providerAvailable: false,
      providerAvailabilityNote: note,
      providerId: OLLAMA_PROVIDER_ID,
      providerLabel: providerName,
      summary:
        "Configure an Ollama provider in Settings to expose local models in the selector.",
      supportsReasoningEffort: false,
    },
    provider: OLLAMA_PROVIDER_ID,
    providerAvailabilityNote: note,
    providerAvailable: false,
    supportsReasoningEffort: false,
  };
}

function buildModelCatalogState(): ModelCatalogState {
  const modelsJsonPath = buildPiModelsJsonPath();
  const agentDirectory = dirname(modelsJsonPath);
  const { authStorage, codexAuthState } = createPiAuthStorage(agentDirectory);
  const preferCodexProvider = codexAuthState.source !== "none";
  const providerStatuses = resolveProviderSetupStatuses(
    authStorage,
    codexAuthState,
    process.env,
  );
  const registry = ModelRegistry.create(authStorage, modelsJsonPath);
  const registryModels = registry.getAll();
  const entries = registryModels
    .filter(shouldIncludeModel)
    .map((model) => publicCatalogModelOption(model, providerStatuses))
    .sort((left, right) =>
      compareCatalogEntries(left, right, preferCodexProvider),
    );
  const hasOllamaModels = entries.some(
    (entry) => entry.provider === OLLAMA_PROVIDER_ID,
  );
  if (!hasOllamaModels) {
    const ollamaConfig = getOllamaProviderConfigSnapshot({
      modelsJsonPath,
      registryError: registry.getError() ?? null,
      registryModels,
    });
    if (!ollamaConfig.available && ollamaConfig.statusNote) {
      entries.push(ollamaPlaceholderEntry(ollamaConfig.statusNote));
      entries.sort((left, right) =>
        compareCatalogEntries(left, right, preferCodexProvider),
      );
    }
  }
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
  const firstAvailableModel =
    entries.find((entry) => entry.providerAvailable) ?? null;
  const defaultModel = preferredDefaultModel?.providerAvailable
    ? preferredDefaultModel
    : ((byLegacyId.get(DEFAULT_THREAD_MODEL)?.providerAvailable
        ? byLegacyId.get(DEFAULT_THREAD_MODEL)
        : null) ??
      (byCanonicalKey.get(DEFAULT_THREAD_MODEL)?.providerAvailable
        ? byCanonicalKey.get(DEFAULT_THREAD_MODEL)
        : null) ??
      firstAvailableModel ??
      preferredDefaultModel ??
      byLegacyId.get(DEFAULT_THREAD_MODEL) ??
      byCanonicalKey.get(DEFAULT_THREAD_MODEL) ??
      entries[0]);
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
