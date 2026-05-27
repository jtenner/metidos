/**
 * @file src/bun/plugin/therouter-core-plugin.test.ts
 * @description Regression coverage for the first-party TheRouter plugin registration and model normalization.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromTheRouterResponse,
  normalizeTheRouterChatModel,
  normalizeTheRouterEmbeddingModel,
} from "../../../core_plugins/therouter";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const THEROUTER_PLUGIN_ROOT = join("core_plugins", "therouter");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type TheRouterConfiguration = {
  api?: string;
  authHeader?: boolean;
  baseUrl?: string;
  id: string;
  label: string;
  models: Array<{
    api?: string;
    compat?: Record<string, unknown>;
    contextWindow: number;
    id: string;
    input: string[];
    maxTokens: number;
    name: string;
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(THEROUTER_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected TheRouter plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadTheRouterConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: THEROUTER_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "THEROUTER_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://api.therouter.ai/v1/models",
          "https://api.therouter.ai/v1/embeddings",
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
      throw new Error("Missing TheRouter provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "TheRouter model provider refresh",
    })) as TheRouterConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core TheRouter plugin", () => {
  it("registers TheRouter chat and embedding providers", async () => {
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
          "https://api.therouter.ai/v1/models",
          "https://api.therouter.ai/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "THEROUTER_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadTheRouterConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "therouter" },
        { hasEmbed: true, id: "therouter_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "therouter",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.therouter.ai/v1",
          id: "default",
          label: "TheRouter",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "THEROUTER_API_KEY" },
          ],
        }),
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing TheRouter embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "TheRouter embeddings provider refresh",
      })) as TheRouterConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "default",
          label: "TheRouter Embeddings",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "THEROUTER_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes TheRouter chat model metadata", () => {
    expect(
      normalizeTheRouterChatModel({
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        context_length: 128000,
        id: "anthropic/claude-sonnet-4",
        name: "Claude Sonnet 4",
        pricing: { completion: "0.000015", prompt: "0.000003" },
        supported_parameters: ["tools", "reasoning"],
        top_provider: { max_completion_tokens: 64000 },
      }),
    ).toEqual({
      api: "openai-completions",
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 3, output: 15 },
      id: "anthropic/claude-sonnet-4",
      input: ["text", "image"],
      maxTokens: 64000,
      name: "Claude Sonnet 4",
      output: ["text"],
      reasoning: true,
    });
  });

  it("normalizes embedding-capable TheRouter model metadata", () => {
    expect(
      normalizeTheRouterEmbeddingModel({
        architecture: {
          input_modalities: ["text"],
          output_modalities: ["embeddings"],
        },
        context_length: 8192,
        id: "openai/text-embedding-3-small",
        name: "Text Embedding 3 Small",
        pricing: { prompt: "0.00000002" },
      }),
    ).toEqual({
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

  it("keeps embedding models out of chat normalization", () => {
    const embeddingOnlyModel = {
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["embeddings"],
      },
      id: "provider/text-embedding-model",
    };

    expect(normalizeTheRouterChatModel(embeddingOnlyModel)).toBeNull();
    expect(normalizeTheRouterEmbeddingModel(embeddingOnlyModel)?.id).toBe(
      "provider/text-embedding-model",
    );
  });

  it("extracts the first embedding vector from TheRouter responses", () => {
    expect(
      firstEmbeddingFromTheRouterResponse({
        data: [{ embedding: [0.25, -0.5, 1] }],
      }),
    ).toEqual([0.25, -0.5, 1]);
    expect(() =>
      firstEmbeddingFromTheRouterResponse({
        data: [{ embedding: [1, Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });
});
