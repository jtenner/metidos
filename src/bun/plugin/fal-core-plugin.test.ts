/**
 * @file src/bun/plugin/fal-core-plugin.test.ts
 * @description Regression coverage for the first-party fal.ai provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { falAuthHeaders, normalizeFalModel } from "../../../core_plugins/fal";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const FAL_PLUGIN_ROOT = join("core_plugins", "fal");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type FalConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing: boolean;
  apiKeyMissingMessage: string;
  authHeader: boolean;
  baseUrl: string;
  headers?: Record<string, string>;
  id: string;
  label: string;
  models: Array<{
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
  const manifestPath = join(FAL_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected fal.ai plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadFalConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
  envValue: string | null = null,
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: FAL_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "FAL_KEY",
          required: false,
          secret: true,
          value: envValue,
        },
      ],
      network: {
        allow: ["https://openrouter.ai/api/v1/models"],
        enforceHttps: true,
      },
      permissions: ["network:fetch", "provider:register", "log:write"],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing fal.ai provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "fal.ai provider refresh",
    })) as FalConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core fal.ai plugin", () => {
  it("registers the fal.ai provider and Key auth header shape", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://openrouter.ai/api/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "FAL_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadFalConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "fal" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "fal",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "METIDOS_FAL_KEY_NOT_CONFIGURED",
          apiKeyMissing: true,
          authHeader: false,
          baseUrl: "https://fal.run/openrouter/router/openai/v1",
          id: "default",
          label: "fal.ai OpenRouter",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "FAL_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds the fal.ai Key auth header without bearer auth", () => {
    expect(falAuthHeaders("setting-token")).toEqual({
      Authorization: "Key setting-token",
    });
    expect(falAuthHeaders(null)).toBeUndefined();
  });

  it("normalizes OpenRouter chat model metadata for fal.ai", () => {
    expect(
      normalizeFalModel({
        id: "anthropic/claude-sonnet-4.5",
        name: "Anthropic: Claude Sonnet 4.5",
        context_length: 200000,
        architecture: {
          modality: "text+image->text",
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        pricing: {
          cache_read: "0.0000003",
          cache_write: "0.00000375",
          completion: "0.000015",
          prompt: "0.000003",
        },
        supported_parameters: ["reasoning", "tools"],
        top_provider: { max_completion_tokens: 64000 },
      }),
    ).toEqual({
      contextWindow: 200000,
      cost: { cacheRead: 0.3, cacheWrite: 3.75, input: 3, output: 15 },
      id: "anthropic/claude-sonnet-4.5",
      input: ["text", "image"],
      maxTokens: 64000,
      name: "Anthropic: Claude Sonnet 4.5",
      reasoning: true,
    });

    expect(
      normalizeFalModel({
        id: "qwen/qwen3-coder",
        architecture: { output_modalities: ["text"] },
      }),
    ).toEqual({
      contextWindow: 16384,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "qwen/qwen3-coder",
      input: ["text"],
      maxTokens: 16384,
      name: "Qwen / Qwen3 Coder",
      reasoning: false,
    });
  });

  it("filters non-chat OpenRouter metadata defensively", () => {
    expect(
      normalizeFalModel({
        id: "openai/text-embedding-3-large",
        architecture: { output_modalities: ["embeddings"] },
      }),
    ).toBeNull();
    expect(
      normalizeFalModel({
        id: "image/generator",
        architecture: { output_modalities: ["image"] },
      }),
    ).toBeNull();
    expect(normalizeFalModel({ id: " " })).toBeNull();
    expect(normalizeFalModel(null)).toBeNull();
  });
});
