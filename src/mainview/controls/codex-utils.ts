/**
 * @file src/mainview/controls/codex-utils.ts
 * @description Module for codex utils.
 */

import type {
  RpcModelOption,
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import { matchesSearchQuery } from "./search-utils";

export type CodexProviderGroup = {
  models: RpcModelOption[];
  providerId: string;
  providerLabel: string;
};

export type CodexModelSelectionOutcome = "commit" | "reasoning";

/**
 * Group model options by provider identity, preserving first-seen provider order.
 */
export function groupCodexProviders(
  models: RpcModelOption[],
): CodexProviderGroup[] {
  const grouped = new Map<
    string,
    {
      models: RpcModelOption[];
      providerLabel: string;
    }
  >();
  for (const model of models) {
    const current = grouped.get(model.providerId) ?? {
      models: [],
      providerLabel: model.providerLabel || model.group,
    };
    current.models.push(model);
    grouped.set(model.providerId, current);
  }
  return [...grouped.entries()].map(([providerId, entry]) => ({
    models: entry.models,
    providerId,
    providerLabel: entry.providerLabel,
  }));
}

/**
 * Group model options by `model.group`, preserving insertion order across groups.
 *
 * A `Map` is used so groups appear in the order the first model for each
 * group was encountered in the input list.
 */
export function groupCodexModels(
  models: RpcModelOption[],
): Array<{ group: string; models: RpcModelOption[] }> {
  return groupCodexProviders(models).map((provider) => ({
    group: provider.providerLabel,
    models: provider.models,
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
 * Filter provider groups by provider identity or contained model metadata.
 */
export function filterCodexProviderGroups(
  providers: CodexProviderGroup[],
  normalizedSearchQuery: string,
): CodexProviderGroup[] {
  return providers.filter((provider) =>
    matchesSearchQuery(
      normalizedSearchQuery,
      provider.providerId,
      provider.providerLabel,
      ...provider.models.flatMap((model) => [
        model.id,
        model.label,
        model.modelId,
        model.summary,
      ]),
    ),
  );
}

/**
 * Filter a provider's models by model/provider metadata.
 */
export function filterCodexProviderModels(
  provider: CodexProviderGroup | null | undefined,
  normalizedSearchQuery: string,
): RpcModelOption[] {
  if (!provider) {
    return [];
  }
  return provider.models.filter((model) =>
    matchesSearchQuery(
      normalizedSearchQuery,
      model.id,
      model.label,
      model.summary,
      model.group,
      model.providerId,
      model.providerLabel,
      model.modelId,
    ),
  );
}

/**
 * Decide whether a selected model should commit immediately or advance to thinking-level selection.
 */
export function codexModelSelectionOutcome(
  model: RpcModelOption,
  integratedReasoningEnabled: boolean,
): CodexModelSelectionOutcome {
  return integratedReasoningEnabled && codexModelSupportsThinkingLevel(model)
    ? "reasoning"
    : "commit";
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
