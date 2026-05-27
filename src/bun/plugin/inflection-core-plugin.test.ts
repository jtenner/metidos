/**
 * @file src/bun/plugin/inflection-core-plugin.test.ts
 * @description Regression coverage for the first-party Inflection AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  firstEmbeddingFromInflectionResponse,
  INFLECTION_EMBEDDING_MODELS,
  INFLECTION_STATIC_CHAT_MODELS,
  normalizeInflectionConfig,
  textEmbeddingInput,
} from "../../../core_plugins/inflection";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const INFLECTION_PLUGIN_ROOT = join("core_plugins", "inflection");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type InflectionConfiguration = {
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
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(INFLECTION_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Inflection plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadInflectionConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: INFLECTION_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "INFLECTION_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://api.inflection.ai/v1/discovery/configs",
          "https://api.inflection.ai/v1/embeddings",
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
      throw new Error("Missing Inflection provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Inflection model provider refresh",
    })) as InflectionConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Inflection AI plugin", () => {
  it("registers Inflection chat and embedding providers", async () => {
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
          "https://api.inflection.ai/v1/discovery/configs",
          "https://api.inflection.ai/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "INFLECTION_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadInflectionConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "inflection" },
        { hasEmbed: true, id: "inflection_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "inflection",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.inflection.ai/v1",
          id: "default",
          label: "Inflection AI",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "INFLECTION_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models.map((model) => model.id)).toEqual([
        "inflection_3_pi",
        "inflection_3_productivity",
        "Pi-3.1",
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing Inflection embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "Inflection embeddings provider refresh",
      })) as InflectionConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "default",
          label: "Inflection AI Embeddings",
          models: [
            expect.objectContaining({
              api: "embeddings",
              compat: { providesEmbeddings: true },
              id: "inf_3_1_embedding",
              input: ["text"],
            }),
          ],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "INFLECTION_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the documented static catalogs scoped to text chat and embeddings", () => {
    expect(INFLECTION_STATIC_CHAT_MODELS.map((model) => model.id)).toEqual([
      "inflection_3_pi",
      "inflection_3_productivity",
      "Pi-3.1",
    ]);
    expect(
      INFLECTION_STATIC_CHAT_MODELS.every(
        (model) => model.api === "openai-completions",
      ),
    ).toBe(true);
    expect(INFLECTION_EMBEDDING_MODELS.map((model) => model.id)).toEqual([
      "inf_3_1_embedding",
    ]);
    expect(
      INFLECTION_EMBEDDING_MODELS.every((model) => model.api === "embeddings"),
    ).toBe(true);
  });

  it("normalizes organization-visible Inflection config metadata", () => {
    expect(
      normalizeInflectionConfig({
        alias: "Pi (3.1)",
        default_parameters: {
          maximumLength: { range: [1, 1024], value: 256 },
          temperature: { range: [0, 1], value: 1 },
        },
        description: "Pi chat assistant based on Llama",
        name: "pi_3_1",
      }),
    ).toEqual({
      api: "openai-completions",
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "pi_3_1",
      input: ["text"],
      maxTokens: 256,
      name: "Pi (3.1)",
      reasoning: true,
    });
    expect(normalizeInflectionConfig({ alias: "missing id" })).toBeNull();
  });

  it("validates embedding inputs and extracts finite embedding vectors", () => {
    expect(textEmbeddingInput("hello")).toBe("hello");
    expect(textEmbeddingInput(["hello", "world"])).toEqual(["hello", "world"]);
    expect(() => textEmbeddingInput(["hello", ""])).toThrow("non-empty");
    expect(
      firstEmbeddingFromInflectionResponse({
        data: [{ embedding: [0.25, -0.5, 1] }],
      }),
    ).toEqual([0.25, -0.5, 1]);
    expect(() =>
      firstEmbeddingFromInflectionResponse({
        data: [{ embedding: [1, Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });
});
