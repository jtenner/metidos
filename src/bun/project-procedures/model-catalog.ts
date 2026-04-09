/**
 * @file src/bun/project-procedures/model-catalog.ts
 * @description Module for codex catalog.
 */

import type { ModelReasoningEffort } from "@openai/codex-sdk";

import { DEFAULT_THREAD_MODEL, DEFAULT_THREAD_REASONING_EFFORT } from "../db";
import type {
  RpcModelCatalog,
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../rpc-schema";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;
type ModelProvider = "openai" | "xai";
type ModelDefinition = RpcModelOption & {
  provider: ModelProvider;
  supportsReasoningEffort: boolean;
};

/**
 * Sourced from provider docs and kept aligned with active model IDs.
 * The SDK accepts raw model IDs but does not expose a discovery API,
 * so this list is treated as the source of truth for UI/model validation.
 */
const MODEL_DEFINITIONS: ModelDefinition[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    group: "Frontier",
    summary: "Latest flagship model for complex reasoning and coding.",
    deprecated: false,
    contextWindowTokens: 400_000,
    provider: "openai",
    supportsReasoningEffort: true,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    group: "Frontier",
    summary: "Faster lower-cost GPT-5.4 model for coding and subagents.",
    deprecated: false,
    contextWindowTokens: 400_000,
    provider: "openai",
    supportsReasoningEffort: true,
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    group: "Frontier",
    summary: "Cheapest GPT-5.4-class model for simple tasks.",
    deprecated: false,
    contextWindowTokens: 400_000,
    provider: "openai",
    supportsReasoningEffort: true,
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3-Codex",
    group: "Coding",
    summary: "Previous high-capability agentic coding model.",
    deprecated: false,
    contextWindowTokens: 400_000,
    provider: "openai",
    supportsReasoningEffort: true,
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    group: "Coding",
    summary: "Lower-latency Codex-focused variant for faster coding tasks.",
    deprecated: false,
    contextWindowTokens: 400_000,
    provider: "openai",
    supportsReasoningEffort: true,
  },
  {
    id: "grok-code-fast-1",
    label: "Grok Code Fast 1",
    group: "xAI Coding",
    summary:
      "xAI coding model for editor-style workflows and fast agent turns.",
    deprecated: false,
    contextWindowTokens: 256_000,
    provider: "xai",
    supportsReasoningEffort: false,
  },
  {
    id: "grok-4-1-fast-reasoning",
    label: "Grok 4.1 Fast Reasoning",
    group: "xAI Frontier",
    summary: "Fast Grok reasoning model for general chat, tools, and search.",
    deprecated: false,
    contextWindowTokens: 256_000,
    provider: "xai",
    supportsReasoningEffort: false,
  },
  {
    id: "grok-4.20-reasoning",
    label: "Grok 4.20 Reasoning",
    group: "xAI Frontier",
    summary: "Latest Grok 4.20 flagship reasoning model with agentic tool use.",
    deprecated: false,
    contextWindowTokens: 2_000_000,
    provider: "xai",
    supportsReasoningEffort: false,
  },
  {
    id: "grok-3-mini",
    label: "Grok 3 Mini",
    group: "xAI Fast",
    summary: "Lower-latency xAI model that still supports reasoning effort.",
    deprecated: false,
    contextWindowTokens: 256_000,
    provider: "xai",
    supportsReasoningEffort: true,
  },
];

const codexModelOptionMap = new Map(
  MODEL_DEFINITIONS.map((model) => [model.id, model]),
);

function publicCodexModelOption(model: ModelDefinition): RpcModelOption {
  const {
    provider: _provider,
    supportsReasoningEffort: _supportsReasoningEffort,
    ...publicModel
  } = model;
  return publicModel;
}

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

/**
 * Build the full model catalog payload consumed by front-end settings.
 */
export function buildModelCatalog(): RpcModelCatalog {
  return {
    defaultModel: DEFAULT_THREAD_MODEL,
    defaultReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    models: MODEL_DEFINITIONS.map(publicCodexModelOption),
    reasoningEfforts: REASONING_EFFORT_OPTIONS,
  };
}

/**
 * Resolve a model to its declared context-window size.
 * Unknown/null values fall back to a conservative default.
 */
export function contextWindowTokensForModel(
  model: string | null | undefined,
): number {
  const normalized = normalizeStoredCodexModel(model);
  return codexModelOptionMap.get(normalized)?.contextWindowTokens ?? 400_000;
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
 * Validate and return a configured model id.
 * Throws if the model is not recognized.
 */
export function resolveCodexModel(model: string | null | undefined): string {
  const normalized = model?.trim();
  if (!normalized) {
    return DEFAULT_THREAD_MODEL;
  }
  if (!codexModelOptionMap.has(normalized)) {
    throw new Error(`Unsupported Codex model: ${normalized}`);
  }
  return normalized;
}

/**
 * Normalize persisted model ids.
 * Unknown values are silently reset to the default model.
 */
export function normalizeStoredCodexModel(
  model: string | null | undefined,
): string {
  const normalized = model?.trim();
  if (!normalized || !codexModelOptionMap.has(normalized)) {
    return DEFAULT_THREAD_MODEL;
  }
  return normalized;
}

/**
 * Resolve the API provider backing a configured model id.
 * Unknown/null values normalize through the default model first.
 */
export function codexModelProvider(
  model: string | null | undefined,
): ModelProvider {
  const normalized = normalizeStoredCodexModel(model);
  return codexModelOptionMap.get(normalized)?.provider ?? "openai";
}

/**
 * Whether the selected model accepts a reasoning-effort override.
 */
export function codexModelSupportsReasoningEffort(
  model: string | null | undefined,
): boolean {
  const normalized = normalizeStoredCodexModel(model);
  return codexModelOptionMap.get(normalized)?.supportsReasoningEffort ?? true;
}

/**
 * Validate and return a reasoning-effort value.
 * Throws if the value is not supported.
 */
export function resolveCodexReasoningEffort(
  reasoningEffort: string | null | undefined,
): RpcReasoningEffort {
  const normalized = reasoningEffort?.trim() as
    | ModelReasoningEffort
    | undefined;
  if (!normalized) {
    return DEFAULT_THREAD_REASONING_EFFORT as RpcReasoningEffort;
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
  const normalized = reasoningEffort?.trim() as
    | ModelReasoningEffort
    | undefined;
  if (!normalized || !reasoningEffortOptionMap.has(normalized)) {
    return DEFAULT_THREAD_REASONING_EFFORT as RpcReasoningEffort;
  }
  return normalized;
}
