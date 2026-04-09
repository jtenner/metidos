/**
 * @file src/mainview/controls/codex-utils.ts
 * @description Module for codex utils.
 */

import type {
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";

/**
 * Group model options by `model.group`, preserving insertion order across groups.
 *
 * A `Map` is used so groups appear in the order the first model for each
 * group was encountered in the input list.
 */
export function groupCodexModels(
  models: RpcModelOption[],
): Array<{ group: string; models: RpcModelOption[] }> {
  const grouped = new Map<string, RpcModelOption[]>();
  for (const model of models) {
    // Reuse the existing array for each group to avoid unnecessary allocations.
    const entries = grouped.get(model.group) ?? [];
    entries.push(model);
    grouped.set(model.group, entries);
  }
  // Convert back to an array so callers can map over grouped sections directly.
  return [...grouped.entries()].map(([group, entries]) => ({
    group,
    models: entries,
  }));
}

/**
 * Human-readable label for model picker UI.
 * Appends a deprecation marker when model metadata marks a model as deprecated.
 */
export function codexModelLabel(model: RpcModelOption): string {
  return model.deprecated ? `${model.label} (Deprecated)` : model.label;
}

/**
 * Human-readable provider label for model picker UI.
 */
export function codexModelProviderLabel(model: RpcModelOption): string {
  return model.providerLabel || model.group;
}

/**
 * Combined provider/model label used when the active selection needs to be explicit.
 */
export function codexModelSelectorLabel(model: RpcModelOption): string {
  return `${codexModelProviderLabel(model)} / ${codexModelLabel(model)}`;
}

/**
 * Stable provider/model identity line used inside selector rows.
 */
export function codexModelIdentityLabel(model: RpcModelOption): string {
  return `${codexModelProviderLabel(model)} / ${model.modelId}`;
}

/**
 * Whether the selected model exposes a configurable thinking-level control.
 */
export function codexModelSupportsThinkingLevel(
  model: RpcModelOption | null | undefined,
): boolean {
  return model?.supportsReasoningEffort ?? true;
}

/**
 * Find a model by stable model id, returning `null` when not present.
 */
export function findCodexModel(
  models: RpcModelOption[],
  modelId: string,
): RpcModelOption | null {
  const normalized = modelId.trim();
  const exact = models.find((model) => model.id === normalized) ?? null;
  if (exact) {
    return exact;
  }
  if (!normalized || normalized.includes(":")) {
    return null;
  }
  return models.find((model) => model.id.endsWith(`:${normalized}`)) ?? null;
}

/**
 * Find a reasoning-effort option by id, returning `null` when not present.
 */
export function findReasoningEffortOption(
  options: RpcReasoningEffortOption[],
  reasoningEffort: RpcReasoningEffort,
): RpcReasoningEffortOption | null {
  return options.find((option) => option.id === reasoningEffort) ?? null;
}
