/**
 * @file src/bun/plugin/tokenmix-core-plugin.test.ts
 * @description Regression coverage for the first-party TokenMix plugin registration and model normalization.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromTokenMixResponse,
  normalizeTokenMixChatModel,
  normalizeTokenMixEmbeddingModel,
} from "../../../core_plugins/tokenmix";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const TOKENMIX_PLUGIN_ROOT = join("core_plugins", "tokenmix");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type TokenMixConfiguration = {
  api?: string;
  authHeader?: boolean;
  baseUrl?: string;
  id: string;
  label: string;
  models: Array<{
    api?: string;
    compat?: Record<string, unknown>;
    contextWindow: number;
    cost: Record<string, number>;
    id: string;
    input: string[];
    maxTokens: number;
    name: string;
    output: string[];
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(TOKENMIX_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected TokenMix plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadTokenMixConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: TOKENMIX_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "TOKENMIX_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://api.tokenmix.ai/v1/models",
          "https://api.tokenmix.ai/v1/embeddings",
        ],
        enforceHttps: true,
      },
      permissions: [
        "network:fetch",
        "provider:register",
        "metidos:provides_embeddings",
        "log:write",
      ],
      settings: { missingRequiredKeys: [], values: { api_key: null } },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing TokenMix provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "TokenMix model provider refresh",
    })) as TokenMixConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core TokenMix plugin", () => {
  it("registers TokenMix chat and embedding providers", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "metidos:provides_embeddings",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: [
          "https://api.tokenmix.ai/v1/models",
          "https://api.tokenmix.ai/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "TOKENMIX_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadTokenMixConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "tokenmix" },
        { hasEmbed: true, id: "tokenmix_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "tokenmix",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.tokenmix.ai/v1",
          id: "default",
          label: "TokenMix",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "TOKENMIX_API_KEY" },
          ],
        }),
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing TokenMix embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "TokenMix embeddings provider refresh",
      })) as TokenMixConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "default",
          label: "TokenMix Embeddings",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "TOKENMIX_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes OpenAI-compatible TokenMix chat model metadata", () => {
    expect(
      normalizeTokenMixChatModel({
        context_length: 128000,
        id: "openai/gpt-4o-mini",
        max_completion_tokens: 16384,
        name: "GPT-4o mini",
        object: "model",
      }),
    ).toEqual({
      api: "openai-completions",
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "openai/gpt-4o-mini",
      input: ["text"],
      maxTokens: 16384,
      name: "GPT-4o mini",
      output: ["text"],
      reasoning: false,
    });
  });

  it("normalizes richer TokenMix model metadata defensively", () => {
    expect(
      normalizeTokenMixChatModel({
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        endpoints: ["chat_completions"],
        id: "provider/vision-reasoning-model",
        limits: { max_context_length: 262144, max_output_tokens: 32768 },
        supported_parameters: ["tools", "reasoning"],
      }),
    ).toEqual(
      expect.objectContaining({
        api: "openai-completions",
        contextWindow: 262144,
        id: "provider/vision-reasoning-model",
        input: ["text", "image"],
        maxTokens: 32768,
        output: ["text"],
        reasoning: true,
      }),
    );
  });

  it("normalizes embedding-capable TokenMix model metadata", () => {
    expect(
      normalizeTokenMixEmbeddingModel({
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["embeddings"],
        },
        context_length: 8192,
        id: "openai/text-embedding-3-small",
        name: "Text Embedding 3 Small",
        object: "model",
      }),
    ).toEqual({
      api: "embeddings",
      contextWindow: 8192,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "openai/text-embedding-3-small",
      input: ["text"],
      maxTokens: 8192,
      name: "Text Embedding 3 Small",
      output: [],
      reasoning: false,
    });
  });

  it("keeps embedding-only models out of chat normalization", () => {
    const embeddingOnlyModel = {
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["embeddings"],
      },
      id: "provider/text-embedding-model",
    };

    expect(normalizeTokenMixChatModel(embeddingOnlyModel)).toBeNull();
    expect(normalizeTokenMixEmbeddingModel(embeddingOnlyModel)?.id).toBe(
      "provider/text-embedding-model",
    );
  });

  it("extracts the first embedding vector from TokenMix responses", () => {
    expect(
      firstEmbeddingFromTokenMixResponse({
        data: [{ embedding: [0.25, -0.5, 1] }],
      }),
    ).toEqual([0.25, -0.5, 1]);
    expect(() =>
      firstEmbeddingFromTokenMixResponse({
        data: [{ embedding: [1, Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });
});
