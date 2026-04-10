/**
 * @file src/mainview/controls/codex-utils.test.ts
 * @description Test file for stepped provider/model selector helpers.
 */

import { describe, expect, it } from "bun:test";
import type { RpcModelOption } from "../../bun/rpc-schema";
import {
  codexModelSelectionOutcome,
  codexProviderScopeInfo,
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
        models: [OPENAI_API_MODEL, OPENAI_API_NO_REASONING_MODEL],
        providerId: "openai",
        providerLabel: "OpenAI API",
      },
      {
        models: [OPENAI_CODEX_MODEL],
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
});
