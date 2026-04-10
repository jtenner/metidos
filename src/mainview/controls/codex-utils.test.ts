/**
 * @file src/mainview/controls/codex-utils.test.ts
 * @description Test file for stepped provider/model selector helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RpcModelOption } from "../../bun/rpc-schema";
import {
  codexModelScopeCallout,
  codexModelSelectionOutcome,
  codexProviderScopeInfo,
  codexReasoningPresentation,
  filterCodexProviderGroups,
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

const MODELS: RpcModelOption[] = [
  modelOption(),
  modelOption({
    group: "OpenAI API",
    id: "openai:gpt-4.1",
    label: "GPT-4.1",
    modelId: "gpt-4.1",
    providerId: "openai",
    providerLabel: "OpenAI API",
    summary: "Provider: OpenAI API. No thinking-level control.",
    supportsReasoningEffort: false,
  }),
  modelOption({
    group: "OpenAI Codex",
    id: "openai-codex:gpt-5.4",
    providerId: "openai-codex",
    providerLabel: "OpenAI Codex",
    summary: "Provider: OpenAI Codex. Supports thinking level control.",
  }),
];
const OPENAI_API_MODEL = MODELS[0] as RpcModelOption;
const OPENAI_API_NO_REASONING_MODEL = MODELS[1] as RpcModelOption;
const OPENAI_CODEX_MODEL = MODELS[2] as RpcModelOption;

describe("stepped codex selector helpers", () => {
  it("groups models into separate providers for OpenAI API and OpenAI Codex", () => {
    expect(groupCodexProviders(MODELS)).toEqual([
      {
        modelCount: 2,
        models: [OPENAI_API_MODEL, OPENAI_API_NO_REASONING_MODEL],
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "openai",
        providerLabel: "OpenAI API",
      },
      {
        modelCount: 1,
        models: [OPENAI_CODEX_MODEL],
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "openai-codex",
        providerLabel: "OpenAI Codex",
      },
    ]);
  });

  it("filters providers by either provider identity or contained model metadata", () => {
    const providers = groupCodexProviders(MODELS);
    const openAiProvider = providers[0] as (typeof providers)[number];
    const codexProvider = providers[1] as (typeof providers)[number];

    expect(
      filterCodexProviderGroups(providers, normalizeSearchQuery("codex")),
    ).toEqual([codexProvider]);
    expect(
      filterCodexProviderGroups(providers, normalizeSearchQuery("gpt-4.1")),
    ).toEqual([openAiProvider]);
  });

  it("filters the model step within the chosen provider only", () => {
    const providers = groupCodexProviders(MODELS);
    const openAiProvider = providers[0] as (typeof providers)[number];
    const codexProvider = providers[1] as (typeof providers)[number];

    expect(
      filterCodexProviderModels(
        openAiProvider,
        normalizeSearchQuery("gpt-4.1"),
      ),
    ).toEqual([OPENAI_API_NO_REASONING_MODEL]);
    expect(
      filterCodexProviderModels(codexProvider, normalizeSearchQuery("gpt-4.1")),
    ).toEqual([]);
  });

  it("only advances to the reasoning step for reasoning-capable models", () => {
    expect(codexModelSelectionOutcome(OPENAI_API_MODEL, true)).toBe(
      "reasoning",
    );
    expect(
      codexModelSelectionOutcome(OPENAI_API_NO_REASONING_MODEL, true),
    ).toBe("commit");
    expect(codexModelSelectionOutcome(OPENAI_CODEX_MODEL, false)).toBe(
      "commit",
    );
  });

  it("surfaces billing and policy guidance for OpenAI API versus OpenAI Codex", () => {
    expect(codexProviderScopeInfo("openai")).toEqual({
      badge: "API billed",
      detail:
        "Uses OpenAI API credentials. Usage follows your API organization billing, retention, and data-sharing settings.",
      summary: "API org policy",
    });
    expect(codexProviderScopeInfo("openai-codex")).toEqual({
      badge: "ChatGPT plan",
      detail:
        "Uses ChatGPT-backed Codex auth. Usage follows ChatGPT workspace permissions, retention, and residency settings.",
      summary: "ChatGPT workspace policy",
    });
    expect(codexProviderScopeInfo("anthropic")).toBeNull();
  });

  it("resolves the active-model billing and policy callout from a selected model id", () => {
    expect(codexModelScopeCallout(MODELS, "openai:gpt-5.4")).toEqual({
      badge: "API billed",
      detail:
        "Uses OpenAI API credentials. Usage follows your API organization billing, retention, and data-sharing settings.",
      modelLabel: "GPT-5.4",
      providerAvailabilityNote: null,
      providerAvailable: true,
      providerLabel: "OpenAI API",
      summary: "API org policy",
    });
    expect(codexModelScopeCallout(MODELS, "openai-codex:gpt-5.4")).toEqual({
      badge: "ChatGPT plan",
      detail:
        "Uses ChatGPT-backed Codex auth. Usage follows ChatGPT workspace permissions, retention, and residency settings.",
      modelLabel: "GPT-5.4",
      providerAvailabilityNote: null,
      providerAvailable: true,
      providerLabel: "OpenAI Codex",
      summary: "ChatGPT workspace policy",
    });
    expect(codexModelScopeCallout(MODELS, "anthropic:claude-sonnet-4")).toBe(
      null,
    );
  });

  it("preserves provider availability metadata when grouping provider rows", () => {
    const providers = groupCodexProviders([
      modelOption({
        id: "openai-codex:gpt-5.4",
        providerAvailable: false,
        providerAvailabilityNote:
          "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
        providerId: "openai-codex",
        providerLabel: "OpenAI Codex",
      }),
    ]);

    expect(providers).toEqual([
      {
        modelCount: 1,
        models: [
          expect.objectContaining({
            id: "openai-codex:gpt-5.4",
          }),
        ],
        providerAvailable: false,
        providerAvailabilityNote:
          "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
        providerId: "openai-codex",
        providerLabel: "OpenAI Codex",
      },
    ]);
  });

  it("excludes placeholder entries from provider model counts and model filtering", () => {
    const providers = groupCodexProviders([
      modelOption({
        id: "ollama:__setup__",
        isPlaceholder: true,
        label: "Setup required",
        modelId: "__setup__",
        providerAvailable: false,
        providerAvailabilityNote:
          "Ollama is not setup. Open Settings and add an Ollama provider config.",
        providerId: "ollama",
        providerLabel: "Ollama",
        summary:
          "Configure an Ollama provider in Settings to expose local models in the selector.",
        supportsReasoningEffort: false,
      }),
    ]);

    expect(providers).toEqual([
      {
        modelCount: 0,
        models: [
          expect.objectContaining({
            id: "ollama:__setup__",
            isPlaceholder: true,
          }),
        ],
        providerAvailable: false,
        providerAvailabilityNote:
          "Ollama is not setup. Open Settings and add an Ollama provider config.",
        providerId: "ollama",
        providerLabel: "Ollama",
      },
    ]);
    expect(
      filterCodexProviderModels(providers[0], normalizeSearchQuery("")),
    ).toEqual([]);
  });

  it("includes unavailable-provider diagnostics in the active-model callout", () => {
    expect(
      codexModelScopeCallout(
        [
          modelOption({
            id: "openai-codex:gpt-5.4",
            providerAvailable: false,
            providerAvailabilityNote:
              "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
            providerId: "openai-codex",
            providerLabel: "OpenAI Codex",
          }),
        ],
        "openai-codex:gpt-5.4",
      ),
    ).toEqual({
      badge: "ChatGPT plan",
      detail:
        "Uses ChatGPT-backed Codex auth. Usage follows ChatGPT workspace permissions, retention, and residency settings.",
      modelLabel: "GPT-5.4",
      providerAvailabilityNote:
        "OpenAI Codex is not setup. Please use the codex cli to login using 'file' authentication.",
      providerAvailable: false,
      providerLabel: "OpenAI Codex",
      summary: "ChatGPT workspace policy",
    });
  });

  it("shows OpenAI GPT-5 models with low-through-xhigh reasoning labels", () => {
    const presentation = codexReasoningPresentation(
      OPENAI_API_MODEL,
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "minimal",
    );

    expect(presentation.activeValue).toBe("low");
    expect(presentation.options.map((option) => option.id)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(presentation.options[0]).toEqual({
      description: "Lower reasoning effort for faster responses.",
      id: "low",
      label: "Low",
    });
  });

  it("clamps OpenAI pro models to medium-through-xhigh", () => {
    const presentation = codexReasoningPresentation(
      modelOption({
        id: "openai:gpt-5.2-pro",
        label: "GPT-5.2 Pro",
        modelId: "gpt-5.2-pro",
        providerId: "openai",
        providerLabel: "OpenAI API",
      }),
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "low",
    );

    expect(presentation.activeValue).toBe("medium");
    expect(presentation.options.map((option) => option.id)).toEqual([
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("shows Gemini 3.1 Pro as a low-versus-high selector", () => {
    const presentation = codexReasoningPresentation(
      modelOption({
        group: "Google",
        id: "google:gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro Preview",
        modelId: "gemini-3.1-pro-preview",
        providerId: "google",
        providerLabel: "Google",
      }),
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "medium",
    );

    expect(presentation.activeValue).toBe("high");
    expect(presentation.options.map((option) => option.id)).toEqual([
      "low",
      "high",
    ]);
    expect(presentation.options[1]).toEqual({
      description: "High dynamic thinking level.",
      id: "high",
      label: "High",
    });
  });

  it("shows binary thinking models as Instant versus Thinking", () => {
    const presentation = codexReasoningPresentation(
      modelOption({
        group: "Mistral",
        id: "mistral:magistral-medium-latest",
        label: "Magistral Medium (latest)",
        modelId: "magistral-medium-latest",
        providerId: "mistral",
        providerLabel: "Mistral",
      }),
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "medium",
    );

    expect(presentation.activeValue).toBe("high");
    expect(presentation.options).toEqual([
      {
        description: "Thinking is off.",
        id: "minimal",
        label: "Instant",
      },
      {
        description: "Reasoning mode is on.",
        id: "high",
        label: "Thinking",
      },
    ]);
  });
});
