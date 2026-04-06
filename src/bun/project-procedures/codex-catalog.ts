/**
 * @file src/bun/project-procedures/codex-catalog.ts
 * @description Module for codex catalog.
 */

import type { ModelReasoningEffort } from "@openai/codex-sdk";

import { DEFAULT_THREAD_MODEL, DEFAULT_THREAD_REASONING_EFFORT } from "../db";
import type {
  RpcCodexModelCatalog,
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
} from "../rpc-schema";

const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;

/**
 * Sourced from OpenAI's official models docs and kept aligned with active model IDs.
 * The SDK accepts raw model IDs but does not expose a discovery API,
 * so this list is treated as the source of truth for UI/model validation.
 */
const CODEX_MODEL_OPTIONS: RpcCodexModelOption[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    group: "Frontier",
    summary: "Latest flagship model for complex reasoning and coding.",
    deprecated: false,
    contextWindowTokens: 400_000,
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    group: "Frontier",
    summary: "Faster lower-cost GPT-5.4 model for coding and subagents.",
    deprecated: false,
    contextWindowTokens: 400_000,
  },
  {
    id: "gpt-5.4-nano",
    label: "GPT-5.4 Nano",
    group: "Frontier",
    summary: "Cheapest GPT-5.4-class model for simple tasks.",
    deprecated: false,
    contextWindowTokens: 400_000,
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3-Codex",
    group: "Coding",
    summary: "Previous high-capability agentic coding model.",
    deprecated: false,
    contextWindowTokens: 400_000,
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3-Codex-Spark",
    group: "Coding",
    summary: "Lower-latency Codex-focused variant for faster coding tasks.",
    deprecated: false,
    contextWindowTokens: 400_000,
  },
];

const codexModelOptionMap = new Map(
  CODEX_MODEL_OPTIONS.map((model) => [model.id, model]),
);

/**
 * Available reasoning-effort values mirrored from supported model controls.
 */
const CODEX_REASONING_EFFORT_OPTIONS: RpcCodexReasoningEffortOption[] = [
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

const codexReasoningEffortOptionMap = new Map(
  CODEX_REASONING_EFFORT_OPTIONS.map((option) => [option.id, option]),
);

/**
 * Build the full model catalog payload consumed by front-end settings.
 */
export function buildCodexModelCatalog(): RpcCodexModelCatalog {
  return {
    defaultModel: DEFAULT_THREAD_MODEL,
    defaultReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
    models: CODEX_MODEL_OPTIONS,
    reasoningEfforts: CODEX_REASONING_EFFORT_OPTIONS,
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
 * Validate and return a reasoning-effort value.
 * Throws if the value is not supported.
 */
export function resolveCodexReasoningEffort(
  reasoningEffort: string | null | undefined,
): RpcCodexReasoningEffort {
  const normalized = reasoningEffort?.trim() as
    | ModelReasoningEffort
    | undefined;
  if (!normalized) {
    return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
  }
  if (!codexReasoningEffortOptionMap.has(normalized)) {
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
): RpcCodexReasoningEffort {
  const normalized = reasoningEffort?.trim() as
    | ModelReasoningEffort
    | undefined;
  if (!normalized || !codexReasoningEffortOptionMap.has(normalized)) {
    return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
  }
  return normalized;
}
