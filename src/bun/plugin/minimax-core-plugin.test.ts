/**
 * @file src/bun/plugin/minimax-core-plugin.test.ts
 * @description Regression coverage for the first-party MiniMax provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeMiniMaxModel } from "../../../core_plugins/minimax";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const MINIMAX_PLUGIN_ROOT = join("core_plugins", "minimax");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type MiniMaxConfiguration = {
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
  const manifestPath = join(MINIMAX_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected MiniMax plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadMiniMaxConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: MINIMAX_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "MINIMAX_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.minimax.io/v1/models"],
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
      throw new Error("Missing MiniMax provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "MiniMax model provider refresh",
    })) as MiniMaxConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core MiniMax plugin", () => {
  it("registers the MiniMax provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.minimax.io/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "MINIMAX_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadMiniMaxConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "minimax",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "minimax",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.minimax.io/v1",
          id: "default",
          label: "MiniMax",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "MINIMAX_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes MiniMax model metadata and excludes non-chat models", () => {
    expect(
      normalizeMiniMaxModel({
        id: "MiniMax-M1",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "MiniMax-M1",
      input: ["text"],
      maxTokens: 8192,
      name: "MiniMax M1",
      reasoning: false,
    });

    expect(
      normalizeMiniMaxModel({
        architecture: { modality: "text+image->text" },
        context_length: 32768,
        id: "MiniMax-VL-01",
        max_output_tokens: 4096,
        name: "MiniMax VL 01",
        object: "model",
        status: "active",
        supported_features: ["chat"],
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "MiniMax-VL-01",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "MiniMax VL 01",
      reasoning: false,
    });

    expect(
      normalizeMiniMaxModel({
        endpoints: ["embeddings"],
        id: "minimax-embedding",
      }),
    ).toBeNull();
    expect(normalizeMiniMaxModel({ id: "minimax-rerank" })).toBeNull();
    expect(
      normalizeMiniMaxModel({
        id: "MiniMax-Text-01",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });
});
