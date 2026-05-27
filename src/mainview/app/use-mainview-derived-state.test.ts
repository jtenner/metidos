/**
 * @file src/mainview/app/use-mainview-derived-state.test.ts
 * @description Test file for use mainview derived state.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcModelOption,
  RpcReasoningEffortOption,
  RpcThread,
} from "../../bun/rpc-schema";
import {
  deriveActiveContextUsage,
  deriveReasoningEffortSelectorDisabled,
} from "./use-mainview-derived-state";

function modelOption(overrides: Partial<RpcModelOption> = {}): RpcModelOption {
  return {
    contextWindowTokens: 400_000,
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

const THINKING_OPTIONS: RpcReasoningEffortOption[] = [
  {
    id: "medium",
    label: "Medium",
  },
];

describe("deriveActiveContextUsage", () => {
  it("prefers live thread usage window over the model catalog window", () => {
    const selectedThread = {
      usage: {
        inputTokens: 20_361,
        cachedInputTokens: 19_584,
        outputTokens: 341,
        contextWindowTokens: 121_600,
      },
    } as RpcThread;

    expect(
      deriveActiveContextUsage(selectedThread, {
        contextWindowTokens: 400_000,
      } as RpcModelOption),
    ).toEqual({
      inputTokens: 20_361,
      contextWindowTokens: 121_600,
    });
  });

  it("falls back to the model catalog when no live session window is available", () => {
    const selectedThread = {
      usage: {
        inputTokens: 11_000,
        cachedInputTokens: 5_000,
        outputTokens: 400,
      },
    } as RpcThread;

    expect(
      deriveActiveContextUsage(selectedThread, {
        contextWindowTokens: 400_000,
      } as RpcModelOption),
    ).toEqual({
      inputTokens: 11_000,
      contextWindowTokens: 400_000,
    });
  });
});

describe("deriveReasoningEffortSelectorDisabled", () => {
  it("disables thinking control when the selected model has no thinking-level override", () => {
    expect(
      deriveReasoningEffortSelectorDisabled({
        activeCodexModelOption: modelOption({
          id: "anthropic:claude-sonnet-4",
          label: "Claude Sonnet 4",
          modelId: "claude-sonnet-4",
          providerId: "anthropic",
          providerLabel: "Anthropic",
          group: "Anthropic",
          supportsReasoningEffort: false,
        }),
        isCreatingThread: false,
        isSending: false,
        isThreadLoading: false,
        isUpdatingThreadReasoningEffort: false,
        reasoningEfforts: THINKING_OPTIONS,
        selectedThreadIsWorking: false,
      }),
    ).toBeTrue();
  });

  it("keeps thinking control enabled for supported models while the UI is idle", () => {
    expect(
      deriveReasoningEffortSelectorDisabled({
        activeCodexModelOption: modelOption(),
        isCreatingThread: false,
        isSending: false,
        isThreadLoading: false,
        isUpdatingThreadReasoningEffort: false,
        reasoningEfforts: THINKING_OPTIONS,
        selectedThreadIsWorking: false,
      }),
    ).toBeFalse();
  });
});
