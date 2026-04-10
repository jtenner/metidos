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
  providerAvailable: boolean;
  providerAvailabilityNote: string | null;
  providerId: string;
  providerLabel: string;
};

export type CodexModelSelectionOutcome = "commit" | "reasoning";

export type CodexProviderScopeInfo = {
  badge: string;
  detail: string;
  summary: string;
};

export type CodexModelScopeCallout = CodexProviderScopeInfo & {
  modelLabel: string;
  providerAvailabilityNote: string | null;
  providerAvailable: boolean;
  providerLabel: string;
};

export type CodexReasoningOptionDisplay = {
  description: string;
  id: RpcReasoningEffort;
  label: string;
};

export type CodexReasoningPresentation = {
  activeOption: CodexReasoningOptionDisplay | null;
  activeValue: RpcReasoningEffort | null;
  options: CodexReasoningOptionDisplay[];
};

const REASONING_EFFORT_ORDER: RpcReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

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
      providerAvailable: boolean;
      providerAvailabilityNote: string | null;
      providerLabel: string;
    }
  >();
  for (const model of models) {
    const current = grouped.get(model.providerId) ?? {
      models: [],
      providerAvailable: model.providerAvailable ?? true,
      providerAvailabilityNote: model.providerAvailabilityNote ?? null,
      providerLabel: model.providerLabel || model.group,
    };
    current.models.push(model);
    grouped.set(model.providerId, current);
  }
  return [...grouped.entries()].map(([providerId, entry]) => ({
    models: entry.models,
    providerAvailable: entry.providerAvailable,
    providerAvailabilityNote: entry.providerAvailabilityNote,
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
 * User-facing billing/policy guidance for providers where scope ambiguity matters.
 */
export function codexProviderScopeInfo(
  providerId: string | null | undefined,
): CodexProviderScopeInfo | null {
  switch (providerId?.trim()) {
    case "openai-codex":
      return {
        badge: "ChatGPT plan",
        detail:
          "Uses ChatGPT-backed Codex auth. Usage follows ChatGPT workspace permissions, retention, and residency settings.",
        summary: "ChatGPT workspace policy",
      };
    case "openai":
      return {
        badge: "API billed",
        detail:
          "Uses OpenAI API credentials. Usage follows your API organization billing, retention, and data-sharing settings.",
        summary: "API org policy",
      };
    default:
      return null;
  }
}

/**
 * Resolve the active provider billing/policy callout for a selected model id.
 * Returns `null` for providers where the distinction is not user-facing.
 */
export function codexModelScopeCallout(
  models: RpcModelOption[],
  modelId: string | null | undefined,
): CodexModelScopeCallout | null {
  if (typeof modelId !== "string" || !modelId.trim()) {
    return null;
  }
  const model = findCodexModel(models, modelId);
  if (!model) {
    return null;
  }
  const scope = codexProviderScopeInfo(model.providerId);
  if (!scope) {
    return null;
  }
  return {
    ...scope,
    modelLabel: codexModelLabel(model),
    providerAvailabilityNote: model.providerAvailabilityNote ?? null,
    providerAvailable: model.providerAvailable ?? true,
    providerLabel: codexModelProviderLabel(model),
  };
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

type ReasoningPresentationProfile =
  | "anthropic-adaptive"
  | "anthropic-adaptive-xhigh"
  | "anthropic-budget"
  | "binary"
  | "codex-gpt5"
  | "generic"
  | "gemini-budget"
  | "gemini-flash"
  | "gemini-pro"
  | "openai-gpt5"
  | "openai-pro";

function reasoningPresentationProfile(
  model: RpcModelOption | null | undefined,
): ReasoningPresentationProfile | null {
  if (!model?.supportsReasoningEffort) {
    return null;
  }

  const providerId = model.providerId.trim();
  const modelId = model.modelId.toLowerCase();

  if (providerId === "mistral" || providerId === "zai") {
    return "binary";
  }

  if (providerId === "openai-codex") {
    return "codex-gpt5";
  }

  if (
    (providerId === "openai" || providerId === "azure-openai-responses") &&
    modelId.endsWith("-pro")
  ) {
    return "openai-pro";
  }

  if (providerId === "openai" || providerId === "azure-openai-responses") {
    return "openai-gpt5";
  }

  if (
    providerId === "anthropic" ||
    (providerId === "amazon-bedrock" && modelId.includes("anthropic.claude"))
  ) {
    if (modelId.includes("opus-4-6") || modelId.includes("opus-4.6")) {
      return "anthropic-adaptive-xhigh";
    }
    if (modelId.includes("sonnet-4-6") || modelId.includes("sonnet-4.6")) {
      return "anthropic-adaptive";
    }
    return "anthropic-budget";
  }

  if (providerId === "google" || providerId === "google-vertex") {
    if (/gemini-3(?:\.\d+)?-pro/.test(modelId)) {
      return "gemini-pro";
    }
    if (/gemini-3(?:\.\d+)?-(flash|flash-lite)/.test(modelId)) {
      return "gemini-flash";
    }
    return "gemini-budget";
  }

  return "generic";
}

function allowedReasoningEffortsForModel(
  model: RpcModelOption | null | undefined,
): RpcReasoningEffort[] {
  const profile = reasoningPresentationProfile(model);
  switch (profile) {
    case "binary":
      return ["minimal", "high"];
    case "openai-pro":
      return ["medium", "high", "xhigh"];
    case "openai-gpt5":
    case "codex-gpt5":
    case "anthropic-adaptive-xhigh":
      return ["low", "medium", "high", "xhigh"];
    case "anthropic-adaptive":
    case "anthropic-budget":
    case "gemini-budget":
    case "gemini-flash":
    case "generic":
      return ["minimal", "low", "medium", "high"];
    case "gemini-pro":
      return ["low", "high"];
    default:
      return [];
  }
}

function reasoningEffortRank(effort: RpcReasoningEffort): number {
  return REASONING_EFFORT_ORDER.indexOf(effort);
}

function clampReasoningEffortForModel(
  allowedEfforts: readonly RpcReasoningEffort[],
  value: RpcReasoningEffort | null | undefined,
): RpcReasoningEffort | null {
  if (allowedEfforts.length === 0 || !value) {
    return null;
  }
  if (allowedEfforts.includes(value)) {
    return value;
  }

  const requestedRank = reasoningEffortRank(value);
  for (const effort of allowedEfforts) {
    if (reasoningEffortRank(effort) >= requestedRank) {
      return effort;
    }
  }
  return allowedEfforts[allowedEfforts.length - 1] ?? null;
}

function reasoningOptionDescription(
  profile: ReasoningPresentationProfile,
  effort: RpcReasoningEffort,
): string {
  switch (profile) {
    case "binary":
      return effort === "minimal"
        ? "Thinking is off."
        : "Reasoning mode is on.";
    case "openai-pro":
      switch (effort) {
        case "medium":
          return "Lowest reasoning level available on this model.";
        case "high":
          return "High reasoning effort for harder tasks.";
        case "xhigh":
          return "Maximum reasoning effort available on this model.";
        default:
          return "Reasoning effort available on this model.";
      }
    case "openai-gpt5":
      switch (effort) {
        case "low":
          return "Lower reasoning effort for faster responses.";
        case "medium":
          return "Balanced reasoning depth for most work.";
        case "high":
          return "Deeper reasoning for harder tasks.";
        case "xhigh":
          return "Maximum reasoning depth available on this model.";
        default:
          return "Reasoning effort available on this model.";
      }
    case "codex-gpt5":
      switch (effort) {
        case "low":
          return "Faster coding pass with lighter reasoning.";
        case "medium":
          return "Balanced coding reasoning for most tasks.";
        case "high":
          return "Deeper coding reasoning for harder tasks.";
        case "xhigh":
          return "Maximum coding reasoning available on this model.";
        default:
          return "Coding reasoning available on this model.";
      }
    case "anthropic-adaptive":
    case "anthropic-adaptive-xhigh":
      switch (effort) {
        case "low":
          return "Low effort for faster responses.";
        case "medium":
          return "Balanced effort for most work.";
        case "high":
          return "High effort for the strongest default performance.";
        case "xhigh":
          return "Maximum effort available on this model.";
        default:
          return "Adaptive effort available on this model.";
      }
    case "anthropic-budget":
      switch (effort) {
        case "minimal":
          return "Smallest thinking budget.";
        case "low":
          return "Low thinking budget.";
        case "medium":
          return "Balanced thinking budget.";
        case "high":
          return "Largest thinking budget.";
        default:
          return "Thinking budget preset for this model.";
      }
    case "gemini-pro":
      return effort === "low"
        ? "Low thinking level."
        : "High dynamic thinking level.";
    case "gemini-flash":
      switch (effort) {
        case "minimal":
          return "Closest to instant, but not fully off.";
        case "low":
          return "Low thinking level.";
        case "medium":
          return "Balanced thinking level.";
        case "high":
          return "High thinking level.";
        default:
          return "Thinking level available on this model.";
      }
    case "gemini-budget":
      switch (effort) {
        case "minimal":
          return "Small thinking budget.";
        case "low":
          return "Low thinking budget.";
        case "medium":
          return "Balanced thinking budget.";
        case "high":
          return "Largest thinking budget.";
        default:
          return "Thinking budget preset for this model.";
      }
    case "generic":
      switch (effort) {
        case "minimal":
          return "Least thinking.";
        case "low":
          return "Lower thinking.";
        case "medium":
          return "Balanced thinking.";
        case "high":
          return "Deeper thinking.";
        default:
          return "Thinking level available on this model.";
      }
    default:
      return "Thinking level available on this model.";
  }
}

function reasoningOptionLabel(
  profile: ReasoningPresentationProfile,
  option: RpcReasoningEffortOption,
): string {
  if (profile === "binary") {
    return option.id === "minimal" ? "Instant" : "Thinking";
  }
  return option.label;
}

export function codexReasoningPresentation(
  model: RpcModelOption | null | undefined,
  options: RpcReasoningEffortOption[],
  value: RpcReasoningEffort | null | undefined,
): CodexReasoningPresentation {
  const profile = reasoningPresentationProfile(model);
  if (!profile) {
    return {
      activeOption: null,
      activeValue: null,
      options: [],
    };
  }

  const allowedEfforts = allowedReasoningEffortsForModel(model);
  const displayOptions = allowedEfforts
    .map((effort) => {
      const option = options.find((entry) => entry.id === effort);
      if (!option) {
        return null;
      }
      return {
        description: reasoningOptionDescription(profile, option.id),
        id: option.id,
        label: reasoningOptionLabel(profile, option),
      } satisfies CodexReasoningOptionDisplay;
    })
    .filter((option) => option != null);
  const activeValue = clampReasoningEffortForModel(allowedEfforts, value);
  const activeOption =
    activeValue == null
      ? null
      : (displayOptions.find((option) => option.id === activeValue) ?? null);

  return {
    activeOption,
    activeValue,
    options: displayOptions,
  };
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
