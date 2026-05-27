/**
 * @file src/bun/plugin/anyscale-core-plugin.test.ts
 * @description Regression coverage for the first-party Anyscale Endpoints provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeAnyscaleModel } from "../../../core_plugins/anyscale";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const ANYSCALE_PLUGIN_ROOT = join("core_plugins", "anyscale");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type AnyscaleConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    compat: Record<string, unknown>;
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
  const manifestPath = join(ANYSCALE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Anyscale plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadAnyscaleConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: ANYSCALE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "ANYSCALE_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.endpoints.anyscale.com/v1/models"],
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
      throw new Error("Missing Anyscale provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Anyscale provider refresh",
    })) as AnyscaleConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Anyscale plugin", () => {
  it("registers the Anyscale provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.endpoints.anyscale.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "ANYSCALE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadAnyscaleConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "anyscale" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "anyscale",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.endpoints.anyscale.com/v1",
          id: "default",
          label: "Anyscale Endpoints",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "ANYSCALE_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Anyscale chat model metadata", () => {
    expect(
      normalizeAnyscaleModel({
        capabilities: { chat: true },
        display_name: "Llama 2 70B Chat",
        id: "meta-llama/Llama-2-70b-chat-hf",
        object: "model",
        pricing: {
          cache_read: 0.05,
          cache_write: 0.1,
          completion: 0.4,
          prompt: 0.1,
        },
        supported_features: ["tools", "reasoning"],
        supported_input_modalities: ["text"],
        supported_output_modalities: ["text"],
        limits: {
          max_context_length: 4096,
        },
        max_output_tokens: 2048,
      }),
    ).toEqual({
      contextWindow: 4096,
      cost: { cacheRead: 0.05, cacheWrite: 0.1, input: 0.1, output: 0.4 },
      id: "meta-llama/Llama-2-70b-chat-hf",
      input: ["text"],
      maxTokens: 2048,
      name: "Llama 2 70B Chat",
      reasoning: true,
    });

    expect(
      normalizeAnyscaleModel({
        id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 16384,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "mistralai/Mixtral-8x7B-Instruct-v0.1",
      input: ["text"],
      maxTokens: 4096,
      name: "Mixtral 8x7B Instruct V0 1",
      reasoning: false,
    });
  });

  it("filters non-chat Anyscale model metadata defensively", () => {
    expect(normalizeAnyscaleModel({ id: "text-embedding-ada-002" })).toBeNull();
    expect(
      normalizeAnyscaleModel({
        id: "stable-diffusion-xl",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizeAnyscaleModel({ id: " ", object: "model" })).toBeNull();
    expect(
      normalizeAnyscaleModel({ id: "chat-model", status: "disabled" }),
    ).toBeNull();
  });
});
