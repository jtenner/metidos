/**
 * @file src/bun/plugin/chutes-core-plugin.test.ts
 * @description Regression coverage for the first-party Chutes provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeChutesModel } from "../../../core_plugins/chutes";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const CHUTES_PLUGIN_ROOT = join("core_plugins", "chutes");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type ChutesConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
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
  const manifestPath = join(CHUTES_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Chutes plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadChutesConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: CHUTES_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "CHUTES_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://llm.chutes.ai/v1/models"],
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
      throw new Error("Missing Chutes provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Chutes provider refresh",
    })) as ChutesConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Chutes plugin", () => {
  it("registers the Chutes provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://llm.chutes.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "CHUTES_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadChutesConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "chutes" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "chutes",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://llm.chutes.ai/v1",
          id: "default",
          label: "Chutes",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "CHUTES_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Chutes chat model metadata", () => {
    expect(
      normalizeChutesModel({
        capabilities: { chat: true },
        id: "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8",
        name: "Llama 4 Maverick",
        pricing: {
          cache_read: 0.05,
          cache_write: 0.1,
          completion: 0.4,
          prompt: 0.1,
        },
        supported_features: ["tools", "reasoning"],
        supported_input_modalities: ["text", "image"],
        supported_output_modalities: ["text"],
        limits: {
          max_context_length: 1048576,
        },
        max_output_length: 32768,
      }),
    ).toEqual({
      contextWindow: 1048576,
      cost: { cacheRead: 0.05, cacheWrite: 0.1, input: 0.1, output: 0.4 },
      id: "chutesai/Llama-4-Maverick-17B-128E-Instruct-FP8",
      input: ["text", "image"],
      maxTokens: 32768,
      name: "Llama 4 Maverick",
      reasoning: true,
    });

    expect(
      normalizeChutesModel({
        id: "Qwen/Qwen3-30B-A3B",
        max_model_len: 40960,
        object: "model",
      }),
    ).toEqual({
      contextWindow: 40960,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "Qwen/Qwen3-30B-A3B",
      input: ["text"],
      maxTokens: 4096,
      name: "Qwen3 30B A3B",
      reasoning: false,
    });
  });

  it("filters non-chat Chutes model metadata defensively", () => {
    expect(
      normalizeChutesModel({ id: "chutesai/text-embedding-model" }),
    ).toBeNull();
    expect(
      normalizeChutesModel({
        id: "chutesai/image-generator",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizeChutesModel({ id: " ", object: "model" })).toBeNull();
    expect(
      normalizeChutesModel({ id: "chat-model", status: "disabled" }),
    ).toBeNull();
  });
});
