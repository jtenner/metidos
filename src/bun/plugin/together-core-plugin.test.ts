/**
 * @file src/bun/plugin/together-core-plugin.test.ts
 * @description Regression coverage for the first-party Together AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeTogetherModel } from "../../../core_plugins/together";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const TOGETHER_PLUGIN_ROOT = join("core_plugins", "together");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type TogetherConfiguration = {
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
  const manifestPath = join(TOGETHER_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Together plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadTogetherConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: TOGETHER_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "TOGETHER_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.together.ai/v1/models"],
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
      throw new Error("Missing Together provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Together model provider refresh",
    })) as TogetherConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Together plugin", () => {
  it("registers the Together provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.together.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "TOGETHER_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadTogetherConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "together",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "together",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.together.ai/v1",
          id: "default",
          label: "Together AI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "TOGETHER_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Together model metadata and excludes non-chat models", () => {
    expect(
      normalizeTogetherModel({
        display_name: "Llama 3.3 70B Instruct Turbo",
        id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        max_context_length: 128000,
        type: "chat",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      input: ["text"],
      maxTokens: 8192,
      name: "Llama 3.3 70B Instruct Turbo",
      reasoning: false,
    });

    expect(
      normalizeTogetherModel({
        capabilities: { completion_chat: true, vision: true },
        id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        limits: { max_context_length: 1048576, max_output_tokens: 16000 },
        name: "Llama 4 Maverick Instruct",
      }),
    ).toEqual({
      contextWindow: 1048576,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
      input: ["text", "image"],
      maxTokens: 16000,
      name: "Llama 4 Maverick Instruct",
      reasoning: false,
    });

    expect(
      normalizeTogetherModel({
        capabilities: { completion_chat: false, embeddings: true },
        id: "together-embed",
      }),
    ).toBeNull();
    expect(normalizeTogetherModel({ id: "together-moderation" })).toBeNull();
  });
});
