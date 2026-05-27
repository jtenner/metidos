/**
 * @file src/mainview/controls/codex-utils.test.ts
 * @description Test file for stepped provider/model selector helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RpcModelOption } from "../../bun/rpc-schema";
import {
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
    group: "Plugin Alpha",
    id: "plugin:alpha/gpt-5.4",
    label: "GPT-5.4",
    modelId: "gpt-5.4",
    providerAvailable: true,
    providerAvailabilityNote: null,
    providerId: "plugin:alpha",
    providerLabel: "Plugin Alpha",
    summary: "Provider: Plugin Alpha. Supports thinking level control.",
    supportsReasoningEffort: true,
    ...overrides,
  };
}

const MODELS: RpcModelOption[] = [
  modelOption(),
  modelOption({
    group: "Plugin Alpha",
    id: "plugin:alpha/gpt-4.1",
    label: "GPT-4.1",
    modelId: "gpt-4.1",
    providerId: "plugin:alpha",
    providerLabel: "Plugin Alpha",
    summary: "Provider: Plugin Alpha. No thinking-level control.",
    supportsReasoningEffort: false,
  }),
  modelOption({
    group: "Plugin Beta",
    id: "plugin:beta/gpt-5.4",
    providerId: "plugin:beta",
    providerLabel: "Plugin Beta",
    summary: "Provider: Plugin Beta. Supports thinking level control.",
  }),
];
const PLUGIN_ALPHA_MODEL = MODELS[0] as RpcModelOption;
const PLUGIN_ALPHA_NO_REASONING_MODEL = MODELS[1] as RpcModelOption;
const PLUGIN_BETA_MODEL = MODELS[2] as RpcModelOption;

describe("stepped codex selector helpers", () => {
  it("groups models into separate plugin providers", () => {
    expect(groupCodexProviders(MODELS)).toEqual([
      {
        modelCount: 2,
        models: [PLUGIN_ALPHA_MODEL, PLUGIN_ALPHA_NO_REASONING_MODEL],
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "plugin:alpha",
        providerLabel: "Plugin Alpha",
      },
      {
        modelCount: 1,
        models: [PLUGIN_BETA_MODEL],
        providerAvailable: true,
        providerAvailabilityNote: null,
        providerId: "plugin:beta",
        providerLabel: "Plugin Beta",
      },
    ]);
  });

  it("filters providers by either provider identity or contained model metadata", () => {
    const providers = groupCodexProviders(MODELS);
    const alphaProvider = providers[0] as (typeof providers)[number];
    const betaProvider = providers[1] as (typeof providers)[number];

    expect(
      filterCodexProviderGroups(providers, normalizeSearchQuery("beta")),
    ).toEqual([betaProvider]);
    expect(
      filterCodexProviderGroups(providers, normalizeSearchQuery("gpt-4.1")),
    ).toEqual([alphaProvider]);
  });

  it("filters the model step within the chosen provider only", () => {
    const providers = groupCodexProviders(MODELS);
    const alphaProvider = providers[0] as (typeof providers)[number];
    const betaProvider = providers[1] as (typeof providers)[number];

    expect(
      filterCodexProviderModels(alphaProvider, normalizeSearchQuery("gpt-4.1")),
    ).toEqual([PLUGIN_ALPHA_NO_REASONING_MODEL]);
    expect(
      filterCodexProviderModels(betaProvider, normalizeSearchQuery("gpt-4.1")),
    ).toEqual([]);
  });

  it("only advances to the reasoning step for reasoning-capable models", () => {
    expect(codexModelSelectionOutcome(PLUGIN_ALPHA_MODEL, true)).toBe(
      "reasoning",
    );
    expect(
      codexModelSelectionOutcome(PLUGIN_ALPHA_NO_REASONING_MODEL, true),
    ).toBe("commit");
    expect(codexModelSelectionOutcome(PLUGIN_BETA_MODEL, false)).toBe("commit");
  });

  it("does not add app-owned provider scope guidance", () => {
    expect(codexProviderScopeInfo("plugin:alpha")).toBeNull();
    expect(codexProviderScopeInfo("anthropic")).toBeNull();
  });

  it("preserves provider availability metadata when grouping provider rows", () => {
    const providers = groupCodexProviders([
      modelOption({
        id: "plugin:beta/gpt-5.4",
        providerAvailable: false,
        providerAvailabilityNote: "Plugin Beta is unavailable.",
        providerId: "plugin:beta",
        providerLabel: "Plugin Beta",
      }),
    ]);

    expect(providers).toEqual([
      {
        modelCount: 1,
        models: [
          expect.objectContaining({
            id: "plugin:beta/gpt-5.4",
          }),
        ],
        providerAvailable: false,
        providerAvailabilityNote: "Plugin Beta is unavailable.",
        providerId: "plugin:beta",
        providerLabel: "Plugin Beta",
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
        providerAvailabilityNote: "Plugin Local has no models.",
        providerId: "plugin:local",
        providerLabel: "Plugin Local",
        summary: "Plugin Local has no models available.",
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
        providerAvailabilityNote: "Plugin Local has no models.",
        providerId: "plugin:local",
        providerLabel: "Plugin Local",
      },
    ]);
    expect(
      filterCodexProviderModels(providers[0], normalizeSearchQuery("")),
    ).toEqual([]);
  });

  it("shows generic plugin models with minimal-through-high reasoning labels", () => {
    const presentation = codexReasoningPresentation(
      PLUGIN_ALPHA_MODEL,
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "minimal",
    );

    expect(presentation.activeValue).toBe("minimal");
    expect(presentation.options.map((option) => option.id)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
    ]);
    expect(presentation.options[0]).toEqual({
      description: "Least thinking.",
      id: "minimal",
      label: "Minimal",
    });
  });

  it("honors catalog-provided thinking levels before provider heuristics", () => {
    const presentation = codexReasoningPresentation(
      modelOption({
        id: "openai-codex:gpt-5.4",
        modelId: "gpt-5.4",
        providerId: "openai-codex",
        providerLabel: "OpenAI Codex",
        supportedReasoningEfforts: [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ],
      }),
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "xhigh",
    );

    expect(presentation.activeValue).toBe("xhigh");
    expect(presentation.options.map((option) => option.id)).toEqual([
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
  });

  it("hides reasoning controls for xAI Grok models", () => {
    const presentation = codexReasoningPresentation(
      modelOption({
        group: "xAI",
        id: "xai:grok-4.20-0309-reasoning",
        label: "Grok 4.20 (Reasoning)",
        modelId: "grok-4.20-0309-reasoning",
        providerId: "xai",
        providerLabel: "xAI",
        supportsReasoningEffort: false,
        summary:
          "Provider: xAI. Supports reasoning, but not configurable thinking-level control.",
      }),
      [
        { id: "minimal", label: "Minimal" },
        { id: "low", label: "Low" },
        { id: "medium", label: "Medium" },
        { id: "high", label: "High" },
        { id: "xhigh", label: "Extra High" },
      ],
      "minimal",
    );

    expect(presentation.activeValue).toBeNull();
    expect(presentation.options).toEqual([]);
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
