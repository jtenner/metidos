/**
 * @file src/bun/plugin/openrouter-core-plugin.test.ts
 * @description Regression coverage for the first-party OpenRouter plugin registration and embedding model normalization.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromResponse,
  normalizeChatModel,
  normalizeEmbeddingModel,
} from "../../../core_plugins/openrouter/openrouter-models";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const OPENROUTER_PLUGIN_ROOT = join("core_plugins", "openrouter");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(OPENROUTER_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected OpenRouter plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

describe("core OpenRouter plugin", () => {
  it("registers separate chat and embedding providers", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(
      expect.arrayContaining([
        "network:fetch",
        "provider:register",
        "metidos:provides_embeddings",
      ]),
    );

    const build = await buildPluginEntrypoint({
      pluginRoot: OPENROUTER_PLUGIN_ROOT,
    });
    const runtime = await startPluginQuickJsRuntime(build, {
      pluginApi: {
        env: [
          {
            key: "OPENROUTER_API_KEY",
            required: false,
            secret: true,
            value: null,
          },
        ],
        network: {
          allow: ["https://openrouter.ai/api/v1/**"],
          enforceHttps: true,
        },
        permissions: [
          "network:fetch",
          "provider:register",
          "metidos:provides_embeddings",
          "log:write",
        ],
        settings: { missingRequiredKeys: [], values: {} },
      },
      startupTimeoutMs: 1_000,
    });

    try {
      const setup = runtime.setupResult as RuntimeSetup;
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "openrouter" },
        { hasEmbed: true, id: "openrouter_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "openrouter",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes embedding-capable OpenRouter model metadata", () => {
    const model = normalizeEmbeddingModel({
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["embeddings"],
      },
      context_length: 8192,
      id: "openai/text-embedding-3-small",
      name: "Text Embedding 3 Small",
      pricing: { prompt: "0.00000002" },
    });

    expect(model).toEqual({
      api: "embeddings",
      contextWindow: 8192,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0.02, output: 0 },
      id: "openai/text-embedding-3-small",
      input: ["text"],
      maxTokens: 8192,
      name: "Text Embedding 3 Small",
      output: [],
      reasoning: false,
    });
  });

  it("keeps image-generating OpenRouter models discoverable for chat", () => {
    const model = normalizeChatModel({
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["image"],
      },
      context_length: 4096,
      id: "openai/gpt-image-1",
      name: "GPT Image 1",
    });

    expect(model).toEqual(
      expect.objectContaining({
        api: "openai-completions",
        id: "openai/gpt-image-1",
        input: ["text"],
        output: ["image"],
      }),
    );
  });

  it("accepts dedicated embedding endpoint models without output modalities", () => {
    expect(
      normalizeEmbeddingModel(
        { context_length: 4096, id: "provider/dedicated-embed" },
        { assumeEmbedding: true },
      )?.api,
    ).toBe("embeddings");
  });

  it("keeps embedding-only models out of chat normalization", () => {
    const embeddingOnlyModel = {
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["embeddings"],
      },
      id: "provider/embed",
    };

    expect(normalizeChatModel(embeddingOnlyModel)).toBeNull();
    expect(normalizeEmbeddingModel(embeddingOnlyModel)?.id).toBe(
      "provider/embed",
    );
  });

  it("extracts the first embedding vector from OpenRouter responses", () => {
    expect(
      firstEmbeddingFromResponse({
        data: [{ embedding: [0.25, -0.5, 1] }],
      }),
    ).toEqual([0.25, -0.5, 1]);
    expect(() =>
      firstEmbeddingFromResponse({ data: [{ embedding: [1, Number.NaN] }] }),
    ).toThrow("non-finite");
  });
});
