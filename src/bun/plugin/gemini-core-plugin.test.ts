/**
 * @file src/bun/plugin/gemini-core-plugin.test.ts
 * @description Regression coverage for the first-party Google Gemini provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromGeminiResponse,
  normalizeGeminiModel,
} from "../../../core_plugins/gemini";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const GEMINI_PLUGIN_ROOT = join("core_plugins", "gemini");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type GeminiConfiguration = {
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
  const manifestPath = join(GEMINI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Google Gemini plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadGeminiConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: GEMINI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "GEMINI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "GOOGLE_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://generativelanguage.googleapis.com/v1beta/openai/models",
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
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
      throw new Error("Missing Google Gemini provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Google Gemini model provider refresh",
    })) as GeminiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Google Gemini plugin", () => {
  it("registers the Google Gemini provider and auth handoff", async () => {
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
          "https://generativelanguage.googleapis.com/v1beta/openai/models",
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "GEMINI_API_KEY", secret: true }),
      expect.objectContaining({ key: "GOOGLE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadGeminiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "gemini" },
        { hasEmbed: true, id: "gemini_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "gemini",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          id: "default",
          label: "Google Gemini",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "GEMINI_API_KEY" },
            { kind: "api_key", source: "env", value: "GOOGLE_API_KEY" },
          ],
        }),
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error(
          "Missing Google Gemini embeddings configuration handle.",
        );
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "Google Gemini embeddings provider refresh",
      })) as GeminiConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "default",
          label: "Google Gemini Embeddings",
          models: [
            expect.objectContaining({
              api: "embeddings",
              compat: { providesEmbeddings: true },
              id: "models/gemini-embedding-001",
              input: ["text"],
              name: "Gemini Embedding 001",
              reasoning: false,
            }),
          ],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "GEMINI_API_KEY" },
            { kind: "api_key", source: "env", value: "GOOGLE_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Google Gemini model metadata and excludes non-chat models", () => {
    expect(
      normalizeGeminiModel({
        id: "gemini-2.5-flash",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "gemini-2.5-flash",
      input: ["text"],
      maxTokens: 8192,
      name: "Google Gemini 2.5 Flash",
      reasoning: false,
    });

    expect(
      normalizeGeminiModel({
        architecture: { modality: "text+image->text" },
        context_length: 32768,
        id: "gemini-2.5-pro",
        max_output_tokens: 4096,
        name: "Gemini 2.5 Pro",
        object: "model",
        status: "active",
        supported_features: ["chat"],
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "gemini-2.5-pro",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Gemini 2.5 Pro",
      reasoning: false,
    });

    expect(
      normalizeGeminiModel({
        endpoints: ["embeddings"],
        id: "gemini-embedding",
      }),
    ).toBeNull();
    expect(normalizeGeminiModel({ id: "gemini-rerank" })).toBeNull();
    expect(
      normalizeGeminiModel({
        id: "gemini-2.5-flash",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });

  it("extracts finite vectors from Gemini embedding responses", () => {
    expect(
      firstEmbeddingFromGeminiResponse({
        embedding: { values: [0.125, -0.25, 1] },
      }),
    ).toEqual([0.125, -0.25, 1]);
    expect(() =>
      firstEmbeddingFromGeminiResponse({ embedding: { values: [Number.NaN] } }),
    ).toThrow("non-finite");
  });
});
