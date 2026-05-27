/**
 * @file src/bun/plugin/siliconflow-core-plugin.test.ts
 * @description Regression coverage for the first-party SiliconFlow provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeSiliconFlowModel } from "../../../core_plugins/siliconflow";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const SILICONFLOW_PLUGIN_ROOT = join("core_plugins", "siliconflow");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type SiliconFlowConfiguration = {
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
  const manifestPath = join(SILICONFLOW_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected SiliconFlow plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadSiliconFlowConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: SILICONFLOW_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "SILICONFLOW_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.siliconflow.com/v1/models"],
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
      throw new Error("Missing SiliconFlow provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "SiliconFlow model provider refresh",
    })) as SiliconFlowConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core SiliconFlow plugin", () => {
  it("registers the SiliconFlow provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.siliconflow.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "SILICONFLOW_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadSiliconFlowConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "siliconflow",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "siliconflow",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.siliconflow.com/v1",
          id: "default",
          label: "SiliconFlow",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "SILICONFLOW_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes SiliconFlow model metadata and excludes non-chat models", () => {
    expect(
      normalizeSiliconFlowModel({
        id: "Qwen/Qwen3-32B",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "Qwen/Qwen3-32B",
      input: ["text"],
      maxTokens: 8192,
      name: "Qwen3 32B",
      reasoning: false,
    });

    expect(
      normalizeSiliconFlowModel({
        architecture: { modality: "text+image->text" },
        context_length: 32768,
        id: "Qwen/Qwen2.5-VL-72B-Instruct",
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
      normalizeSiliconFlowModel({
        endpoints: ["embeddings"],
        id: "siliconflow-embedding",
      }),
    ).toBeNull();
    expect(normalizeSiliconFlowModel({ id: "siliconflow-rerank" })).toBeNull();
    expect(
      normalizeSiliconFlowModel({
        id: "SiliconFlow-Text-01",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });
});
