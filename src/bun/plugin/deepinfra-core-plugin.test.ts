/**
 * @file src/bun/plugin/deepinfra-core-plugin.test.ts
 * @description Regression coverage for the first-party DeepInfra provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeDeepInfraModel } from "../../../core_plugins/deepinfra";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const DEEPINFRA_PLUGIN_ROOT = join("core_plugins", "deepinfra");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type DeepInfraConfiguration = {
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
  const manifestPath = join(DEEPINFRA_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected DeepInfra plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadDeepInfraConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: DEEPINFRA_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "DEEPINFRA_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "DEEPINFRA_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.deepinfra.com/v1/models"],
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
      throw new Error("Missing DeepInfra provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "DeepInfra model provider refresh",
    })) as DeepInfraConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core DeepInfra plugin", () => {
  it("registers the DeepInfra provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.deepinfra.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "DEEPINFRA_TOKEN", secret: true }),
      expect.objectContaining({ key: "DEEPINFRA_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadDeepInfraConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "deepinfra",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "deepinfra",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.deepinfra.com/v1/openai",
          id: "default",
          label: "DeepInfra",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "DEEPINFRA_TOKEN" },
            { kind: "api_key", source: "env", value: "DEEPINFRA_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes DeepInfra model metadata and excludes non-chat models", () => {
    expect(
      normalizeDeepInfraModel({
        id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
        object: "model",
        owned_by: "deepinfra",
        task: "text-generation",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta-llama/Meta-Llama-3.1-70B-Instruct",
      input: ["text"],
      maxTokens: 8192,
      name: "Meta Llama 3.1 70B Instruct",
      reasoning: false,
    });

    expect(
      normalizeDeepInfraModel({
        capabilities: { chat: true, multimodal: true },
        config: { max_position_embeddings: 32768 },
        id: "llava-hf/llava-v1.6-vicuna-13b",
        limits: { max_output_tokens: 4096 },
        name: "LLaVA 1.6 Vicuna 13B",
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "llava-hf/llava-v1.6-vicuna-13b",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "LLaVA 1.6 Vicuna 13B",
      reasoning: false,
    });

    expect(
      normalizeDeepInfraModel({
        id: "BAAI/bge-large-en-v1.5",
        task: "feature-extraction",
      }),
    ).toBeNull();
    expect(normalizeDeepInfraModel({ id: "deepinfra-rerank" })).toBeNull();
  });
});
