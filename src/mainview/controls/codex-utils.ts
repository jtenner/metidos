/**
 * @file src/mainview/controls/codex-utils.ts
 * @description Module for codex utils.
 */

import type {
  RpcCodexModelOption,
  RpcCodexReasoningEffort,
  RpcCodexReasoningEffortOption,
} from "../../bun/rpc-schema";

/**
 * Group model options by `model.group`, preserving insertion order across groups.
 *
 * A `Map` is used so groups appear in the order the first model for each
 * group was encountered in the input list.
 */
export function groupCodexModels(
  models: RpcCodexModelOption[],
): Array<{ group: string; models: RpcCodexModelOption[] }> {
  const grouped = new Map<string, RpcCodexModelOption[]>();
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
 * Appends a deprecation marker for deprecated models.
 */
export function codexModelLabel(model: RpcCodexModelOption): string {
  return model.deprecated ? `${model.label} (Deprecated)` : model.label;
}

/**
 * Find a model by stable model id, returning `null` when not present.
 */
export function findCodexModel(
  models: RpcCodexModelOption[],
  modelId: string,
): RpcCodexModelOption | null {
  return models.find((model) => model.id === modelId) ?? null;
}

/**
 * Find a reasoning-effort option by id, returning `null` when not present.
 */
export function findReasoningEffortOption(
  options: RpcCodexReasoningEffortOption[],
  reasoningEffort: RpcCodexReasoningEffort,
): RpcCodexReasoningEffortOption | null {
  return options.find((option) => option.id === reasoningEffort) ?? null;
}
