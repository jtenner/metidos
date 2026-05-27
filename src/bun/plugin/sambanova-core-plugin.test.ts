/**
 * @file src/bun/plugin/sambanova-core-plugin.test.ts
 * @description Regression coverage for the first-party SambaNova Cloud provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeSambaNovaModel } from "../../../core_plugins/sambanova";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const SAMBANOVA_PLUGIN_ROOT = join("core_plugins", "sambanova");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type SambaNovaConfiguration = {
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
  const manifestPath = join(SAMBANOVA_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected SambaNova plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadSambaNovaConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: SAMBANOVA_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "SAMBANOVA_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.sambanova.ai/v1/models"],
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
      throw new Error("Missing SambaNova provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "SambaNova model provider refresh",
    })) as SambaNovaConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core SambaNova plugin", () => {
  it("registers the SambaNova provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.sambanova.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "SAMBANOVA_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadSambaNovaConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "sambanova",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "sambanova",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.sambanova.ai/v1",
          id: "default",
          label: "SambaNova Cloud",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "SAMBANOVA_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes SambaNova model metadata and excludes non-chat models", () => {
    expect(
      normalizeSambaNovaModel({
        id: "Meta-Llama-3.3-70B-Instruct",
        object: "model",
        pricing: { completion: "0.00000120", prompt: "0.00000060" },
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "Meta-Llama-3.3-70B-Instruct",
      input: ["text"],
      maxTokens: 8192,
      name: "Meta Llama 3.3 70B Instruct",
      reasoning: false,
    });

    expect(
      normalizeSambaNovaModel({
        capabilities: { chat: true, multimodal: true },
        context_length: 32768,
        id: "Llama-4-Maverick-17B-128E-Instruct",
        max_output_tokens: 4096,
        name: "Llama 4 Maverick",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "Llama-4-Maverick-17B-128E-Instruct",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Llama 4 Maverick",
      reasoning: false,
    });

    expect(normalizeSambaNovaModel({ id: "sambanova-embedding" })).toBeNull();
    expect(
      normalizeSambaNovaModel({ id: "sambanova-rerank", object: "model" }),
    ).toBeNull();
  });
});
