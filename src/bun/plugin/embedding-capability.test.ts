/**
 * @file src/bun/plugin/embedding-capability.test.ts
 * @description Characterization tests for Plugin System v1 embedding execution capability decisions.
 */

import { describe, expect, it } from "bun:test";

import {
  executePluginEmbeddingRequest,
  parsePluginEmbeddingModelSelection,
  pluginModelProviderRegistrationProvidesEmbeddingModel,
  type PluginEmbeddingProviderInvocation,
} from "./embedding-capability";
import type { PluginModelProviderRegistration } from "./model-providers";

function embeddingRegistration(
  overrides: Partial<PluginModelProviderRegistration> = {},
): PluginModelProviderRegistration {
  return {
    configuration: {
      models: [{ id: "text-embedding-3-small", name: "Text embedding" }],
    },
    configurationId: "default",
    configurationLabel: null,
    directoryName: "embed_plugin",
    embedHandle: "modelProvider:embedder:embed",
    executeHandle: null,
    pluginId: "embed_plugin",
    pluginName: "Embed Plugin",
    providerId: "embedder",
    providerName: "Embedder",
    providesEmbeddings: true,
    refreshError: null,
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("embedding capability", () => {
  it("selects the configured embedding provider and normalizes provider results", async () => {
    const registration = embeddingRegistration();
    let invocation: PluginEmbeddingProviderInvocation | null = null;

    const vector = await executePluginEmbeddingRequest({
      context: {
        ownerUserId: 42,
        projectId: 5,
        threadId: 8,
        worktreePath: "/workspace",
      },
      input: "search query",
      invokeProviderEmbedding: async (nextInvocation) => {
        invocation = nextInvocation;
        return { embedding: [0.125, 0.25, 0.5] };
      },
      listProviderRegistrations: () => [registration],
      payload: { dimensions: 3 },
      readRuntimeSettings: () => ({
        embeddingModel: "embed_plugin/embedder/default/text-embedding-3-small",
      }),
    });

    expect(vector).toEqual([0.125, 0.25, 0.5]);
    expect(invocation).toMatchObject({
      context: {
        contextKind: "providerExecution",
        ownerUserId: 1,
        projectId: 5,
        threadId: 8,
        worktreePath: "/workspace",
      },
      input: "search query",
      model: {
        id: "text-embedding-3-small",
        provider: "embed_plugin/embedder/default",
      },
      options: { dimensions: 3 },
      registration,
    });
  });

  it("preserves embedding-provider eligibility and model-key parsing semantics", () => {
    const registration = embeddingRegistration();
    expect(
      parsePluginEmbeddingModelSelection("plugin/provider/config/model"),
    ).toEqual({
      modelId: "model",
      providerRegistryId: "plugin/provider/config",
    });
    expect(parsePluginEmbeddingModelSelection("provider:model")).toEqual({
      modelId: "model",
      providerRegistryId: "provider",
    });
    expect(
      pluginModelProviderRegistrationProvidesEmbeddingModel({
        modelId: "text-embedding-3-small",
        providerRegistryId: "embed_plugin/embedder/default",
        registration,
      }),
    ).toBe(true);
    expect(
      pluginModelProviderRegistrationProvidesEmbeddingModel({
        modelId: "text-embedding-3-small",
        providerRegistryId: "embed_plugin/embedder/default",
        registration: embeddingRegistration({ embedHandle: null }),
      }),
    ).toBe(false);
    expect(
      pluginModelProviderRegistrationProvidesEmbeddingModel({
        modelId: "text-embedding-3-small",
        providerRegistryId: "embed_plugin/embedder/default",
        registration: embeddingRegistration({ providesEmbeddings: false }),
      }),
    ).toBe(false);
  });

  it("falls back to the local operator settings seam and still rejects unavailable embedding models", async () => {
    let runtimeSettingsUserId: number | null = null;
    let invokedOwnerUserId: number | null | undefined;

    await expect(
      executePluginEmbeddingRequest({
        context: { projectId: 1, threadId: 2, worktreePath: "/workspace" },
        input: "query",
        invokeProviderEmbedding: async (nextInvocation) => {
          invokedOwnerUserId = nextInvocation.context.ownerUserId;
          return [1];
        },
        listProviderRegistrations: () => [embeddingRegistration()],
        payload: null,
        readRuntimeSettings: (ownerUserId) => {
          runtimeSettingsUserId = ownerUserId;
          return {
            embeddingModel:
              "embed_plugin/embedder/default/text-embedding-3-small",
          };
        },
      }),
    ).resolves.toEqual([1]);

    expect(Number(runtimeSettingsUserId)).toBe(1);
    expect(Number(invokedOwnerUserId)).toBe(1);

    await expect(
      executePluginEmbeddingRequest({
        context: { ownerUserId: 42 },
        input: "query",
        invokeProviderEmbedding: async () => [1],
        listProviderRegistrations: () => [
          embeddingRegistration({ providesEmbeddings: false }),
        ],
        payload: null,
        readRuntimeSettings: () => ({
          embeddingModel:
            "embed_plugin/embedder/default/text-embedding-3-small",
        }),
      }),
    ).rejects.toThrow("Configured embedding model is unavailable.");
  });
});
