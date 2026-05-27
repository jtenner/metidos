/**
 * @file src/bun/plugin/baseten-core-plugin.test.ts
 * @description Regression coverage for the first-party Baseten provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromBasetenResponse,
  normalizeBasetenEmbeddingModel,
  normalizeBasetenModel,
} from "../../../core_plugins/baseten";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const BASETEN_PLUGIN_ROOT = join("core_plugins", "baseten");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type BasetenConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
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
  const manifestPath = join(BASETEN_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Baseten plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadBasetenConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: BASETEN_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "BASETEN_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://inference.baseten.co/v1/models",
          "https://inference.baseten.co/v1/embeddings",
        ],
        enforceHttps: true,
      },
      permissions: [
        "network:fetch",
        "provider:register",
        "metidos:provides_embeddings",
        "log:write",
      ],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Baseten provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Baseten model provider refresh",
    })) as BasetenConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Baseten plugin", () => {
  it("registers the Baseten provider and auth handoff", async () => {
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
          "https://inference.baseten.co/v1/models",
          "https://inference.baseten.co/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "BASETEN_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadBasetenConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "baseten" },
        { hasEmbed: true, id: "baseten_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "baseten",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://inference.baseten.co/v1",
          id: "default",
          label: "Baseten",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "BASETEN_API_KEY" },
          ],
        }),
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing Baseten embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "Baseten embeddings provider refresh",
      })) as BasetenConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "default",
          label: "Baseten Embeddings",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "BASETEN_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Baseten embedding model metadata", () => {
    expect(
      normalizeBasetenEmbeddingModel({
        context_length: 32768,
        endpoints: ["embeddings"],
        id: "Qwen/Qwen3-Embedding-8B",
        object: "model",
        pricing: { input: 0.02 },
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0.02, output: 0 },
      id: "Qwen/Qwen3-Embedding-8B",
      input: ["text"],
      maxTokens: 32768,
      name: "Qwen3 Embedding 8B",
      reasoning: false,
    });
    expect(normalizeBasetenEmbeddingModel({ id: "baseten-chat" })).toBeNull();
  });

  it("normalizes Baseten model metadata and excludes non-chat models", () => {
    expect(
      normalizeBasetenModel({
        context_length: 131072,
        id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
        object: "model",
        pricing: { input: 0.19, output: "0.49" },
      }),
    ).toEqual({
      contextWindow: 131072,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0.19, output: 0.49 },
      id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct",
      input: ["text", "image"],
      maxTokens: 8192,
      name: "Llama 4 Maverick 17B 128E Instruct",
      reasoning: false,
    });

    expect(
      normalizeBasetenModel({
        architecture: { modality: "text+image->text" },
        context_length: 32768,
        model_id: "Qwen/Qwen2.5-VL-72B-Instruct",
        max_output_tokens: 4096,
        name: "Qwen2.5-VL-72B-Instruct",
        object: "model",
        status: "active",
        supported_features: ["chat"],
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "Qwen/Qwen2.5-VL-72B-Instruct",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Qwen2.5-VL-72B-Instruct",
      reasoning: false,
    });

    expect(
      normalizeBasetenModel({
        endpoints: ["embeddings"],
        id: "baseten-embedding",
      }),
    ).toBeNull();
    expect(normalizeBasetenModel({ id: "baseten-rerank" })).toBeNull();
    expect(
      normalizeBasetenModel({
        id: "Baseten-Text-01",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });

  it("extracts finite vectors from Baseten embedding responses", () => {
    expect(
      firstEmbeddingFromBasetenResponse({
        data: [{ embedding: [0.125, -0.25, 1] }],
      }),
    ).toEqual([0.125, -0.25, 1]);
    expect(() =>
      firstEmbeddingFromBasetenResponse({
        data: [{ embedding: [Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });
});
