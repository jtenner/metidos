/**
 * @file src/mainview/controls/codex-model-selector.test.ts
 * @description Test file for codex model selector selection-path helpers.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcModelOption,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import {
  applyCodexReasoningSelection,
  type CodexModelSelectionPath,
  defaultReasoningEffortForModelClick,
  deriveCodexModelClickOutcome,
  deriveCodexModelSelectionPath,
  shouldFocusCodexSelectorStepChange,
} from "./codex-model-selector";
import {
  codexReasoningPresentation,
  filterCodexProviderModels,
  groupCodexProviders,
} from "./codex-utils";
import { normalizeSearchQuery } from "./search-utils";

function modelOption(overrides: Partial<RpcModelOption> = {}): RpcModelOption {
  return {
    contextWindowTokens: 200_000,
    deprecated: false,
    group: "OpenAI API",
    id: "openai:gpt-5.4",
    isPlaceholder: false,
    label: "GPT-5.4",
    modelId: "gpt-5.4",
    providerAvailable: true,
    providerAvailabilityNote: null,
    providerId: "openai",
    providerLabel: "OpenAI API",
    summary: "Provider: OpenAI API. Supports thinking level control.",
    supportsReasoningEffort: true,
    ...overrides,
  };
}

const THINKING_OPTIONS: RpcReasoningEffortOption[] = [
  { id: "minimal", label: "Minimal" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
];

function selectionPath(
  model: RpcModelOption,
  variant: "desktop" | "mobile",
): CodexModelSelectionPath {
  return deriveCodexModelSelectionPath({
    integratedReasoningEnabled: true,
    model,
    reasoningPresentation: codexReasoningPresentation(
      model,
      THINKING_OPTIONS,
      "medium",
    ),
    variant,
  });
}

describe("deriveCodexModelSelectionPath", () => {
  it("keeps non-configurable xAI grok rows as direct model commits", () => {
    const grokModel = modelOption({
      group: "xAI",
      id: "xai:grok-4.20-0309-reasoning",
      label: "Grok 4.20 (Reasoning)",
      modelId: "grok-4.20-0309-reasoning",
      providerId: "xai",
      providerLabel: "xAI",
      summary:
        "Provider: xAI. Supports reasoning, but not configurable thinking-level control.",
      supportsReasoningEffort: false,
    });

    expect(selectionPath(grokModel, "desktop")).toBe("commit");
    expect(selectionPath(grokModel, "mobile")).toBe("commit");
  });

  it("advances mobile selections into the explicit thinking-level step", () => {
    expect(selectionPath(modelOption(), "mobile")).toBe("reasoning-step");
  });

  it("keeps the desktop hover submenu available for thinking-capable models", () => {
    expect(selectionPath(modelOption(), "desktop")).toBe("reasoning-submenu");
  });
});

describe("deriveCodexModelClickOutcome", () => {
  it("commits desktop submenu rows instead of opening a duplicate inline thinking step", () => {
    expect(deriveCodexModelClickOutcome("reasoning-submenu")).toBe("commit");
  });

  it("keeps mobile reasoning rows on the inline thinking step", () => {
    expect(deriveCodexModelClickOutcome("reasoning-step")).toBe(
      "reasoning-step",
    );
  });
});

describe("shouldFocusCodexSelectorStepChange", () => {
  it("leaves initial chooser focus to the dropdown surface", () => {
    expect(
      shouldFocusCodexSelectorStepChange({
        currentOpen: true,
        currentStep: "provider",
        previousOpen: false,
        previousStep: "provider",
      }),
    ).toBe(false);
  });

  it("moves focus only when an open chooser changes step", () => {
    expect(
      shouldFocusCodexSelectorStepChange({
        currentOpen: true,
        currentStep: "reasoning",
        previousOpen: true,
        previousStep: "model",
      }),
    ).toBe(true);
  });

  it("does not focus when the open chooser stays on the same step", () => {
    expect(
      shouldFocusCodexSelectorStepChange({
        currentOpen: true,
        currentStep: "model",
        previousOpen: true,
        previousStep: "model",
      }),
    ).toBe(false);
  });
});

describe("model selector filtering", () => {
  it("matches model IDs when queries use spaces instead of punctuation", () => {
    const models = [
      modelOption({
        group: "OpenRouter",
        id: "openrouter:aion-labs/aion-1.0",
        label: "AionLabs: Aion-1.0",
        modelId: "aion-labs/aion-1.0",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
      }),
      modelOption({
        group: "OpenRouter",
        id: "openrouter:amazon/nova-lite-v1",
        label: "Amazon: Nova Lite 1.0",
        modelId: "amazon/nova-lite-v1",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
      }),
    ];
    const [provider] = groupCodexProviders(models);

    expect(
      filterCodexProviderModels(
        provider,
        normalizeSearchQuery("aion labs"),
      ).map((model) => model.id),
    ).toEqual(["openrouter:aion-labs/aion-1.0"]);
  });

  it("matches compact queries against separated model names", () => {
    const models = [
      modelOption({
        id: "openrouter:ai21/jamba-large-1.7",
        label: "AI21: Jamba Large 1.7",
        modelId: "ai21/jamba-large-1.7",
        providerId: "openrouter",
        providerLabel: "OpenRouter",
      }),
    ];
    const [provider] = groupCodexProviders(models);

    expect(
      filterCodexProviderModels(
        provider,
        normalizeSearchQuery("jambalarge"),
      ).map((model) => model.id),
    ).toEqual(["openrouter:ai21/jamba-large-1.7"]);
  });
});

describe("defaultReasoningEffortForModelClick", () => {
  it("defaults clickable reasoning-capable selections to Medium when available", () => {
    expect(
      defaultReasoningEffortForModelClick(
        codexReasoningPresentation(modelOption(), THINKING_OPTIONS, "high"),
      ),
    ).toBe("medium");
  });

  it("does not force Medium on models that do not expose it", () => {
    expect(
      defaultReasoningEffortForModelClick(
        codexReasoningPresentation(
          modelOption({
            providerId: "google",
            modelId: "gemini-3-pro",
            supportedReasoningEfforts: ["low", "high"],
          }),
          THINKING_OPTIONS,
          "high",
        ),
      ),
    ).toBeNull();
  });
});

describe("applyCodexReasoningSelection", () => {
  it("commits the model before applying the selected reasoning effort", async () => {
    const calls: string[] = [];

    await applyCodexReasoningSelection({
      activeModelId: "openai:gpt-4.1",
      nextReasoningEffort: "high",
      onChange: async (value) => {
        calls.push(`model:${value}`);
        return true;
      },
      onChangeReasoningEffort: async (value) => {
        calls.push(`reasoning:${value}`);
        return true;
      },
      pendingModel: modelOption(),
      reasoningValue: "medium",
    });

    expect(calls).toEqual(["model:openai:gpt-5.4", "reasoning:high"]);
  });

  it("skips the reasoning update when the model commit fails", async () => {
    const calls: string[] = [];

    await applyCodexReasoningSelection({
      activeModelId: "openai:gpt-4.1",
      nextReasoningEffort: "high",
      onChange: async (value) => {
        calls.push(`model:${value}`);
        return false;
      },
      onChangeReasoningEffort: async (value) => {
        calls.push(`reasoning:${value}`);
        return true;
      },
      pendingModel: modelOption(),
      reasoningValue: "medium",
    });

    expect(calls).toEqual(["model:openai:gpt-5.4"]);
  });
});
