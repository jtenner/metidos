/**
 * @file src/bun/plugin/nebius-core-plugin.test.ts
 * @description Regression coverage for the first-party Nebius AI Studio provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeNebiusModel } from "../../../core_plugins/nebius";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const NEBIUS_PLUGIN_ROOT = join("core_plugins", "nebius");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type NebiusConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
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
  const manifestPath = join(NEBIUS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Nebius plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadNebiusConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: NEBIUS_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "NEBIUS_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.studio.nebius.com/v1/models"],
        enforceHttps: true,
      },
      permissions: ["network:fetch", "provider:register", "log:write"],
      settings: { missingRequiredKeys: [], values: { api_key: null } },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Nebius provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Nebius model provider refresh",
    })) as NebiusConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Nebius plugin", () => {
  it("registers the Nebius provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.studio.nebius.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "NEBIUS_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadNebiusConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "nebius",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "nebius",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.studio.nebius.com/v1",
          id: "default",
          label: "Nebius AI Studio",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "NEBIUS_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Nebius model metadata and excludes non-chat models", () => {
    expect(
      normalizeNebiusModel({
        id: "meta-llama/llama-3.1-70b-instruct",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta-llama/llama-3.1-70b-instruct",
      input: ["text"],
      maxTokens: 8192,
      name: "Llama 3.1 70b Instruct",
      reasoning: false,
    });

    expect(
      normalizeNebiusModel({
        architecture: { modality: "text+image->text" },
        context_length: 32768,
        id: "qwen/qwen2.5-vl-72b-instruct",
        max_output_tokens: 4096,
        name: "Qwen2.5 VL 72B Instruct",
        object: "model",
        status: "active",
        supported_features: ["chat"],
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "qwen/qwen2.5-vl-72b-instruct",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Qwen2.5 VL 72B Instruct",
      reasoning: false,
    });

    expect(
      normalizeNebiusModel({
        endpoints: ["embeddings"],
        id: "nebius-embedding",
      }),
    ).toBeNull();
    expect(normalizeNebiusModel({ id: "nebius-rerank" })).toBeNull();
    expect(
      normalizeNebiusModel({
        id: "meta-llama/llama-3.1-8b-instruct",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });
});
