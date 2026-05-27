/**
 * @file src/bun/plugin/cerebras-core-plugin.test.ts
 * @description Regression coverage for the first-party Cerebras provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeCerebrasModel } from "../../../core_plugins/cerebras";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const CEREBRAS_PLUGIN_ROOT = join("core_plugins", "cerebras");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type CerebrasConfiguration = {
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
  const manifestPath = join(CEREBRAS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Cerebras plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadCerebrasConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: CEREBRAS_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "CEREBRAS_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.cerebras.ai/v1/models"],
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
      throw new Error("Missing Cerebras provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Cerebras model provider refresh",
    })) as CerebrasConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Cerebras plugin", () => {
  it("registers the Cerebras provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.cerebras.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "CEREBRAS_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadCerebrasConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "cerebras",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "cerebras",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.cerebras.ai/v1",
          id: "default",
          label: "Cerebras",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "CEREBRAS_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Cerebras model metadata and excludes non-chat models", () => {
    expect(
      normalizeCerebrasModel({
        capabilities: { vision: false },
        context: { max_input_tokens: 128000, max_output_tokens: 65536 },
        id: "llama-3.3-70b",
        name: "Llama 3.3 70B",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "llama-3.3-70b",
      input: ["text"],
      maxTokens: 65536,
      name: "Llama 3.3 70B",
      reasoning: false,
    });

    expect(
      normalizeCerebrasModel({
        capabilities: { reasoning: true },
        context_window: 131072,
        id: "gpt-oss-120b",
        max_completion_tokens: 65536,
      }),
    ).toEqual({
      contextWindow: 131072,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "gpt-oss-120b",
      input: ["text"],
      maxTokens: 65536,
      name: "GPT Oss 120b",
      reasoning: false,
    });

    expect(
      normalizeCerebrasModel({
        id: "qwen-vision",
        capabilities: { vision: true },
      })?.input,
    ).toEqual(["text", "image"]);
    expect(normalizeCerebrasModel({ id: "cerebras-embedding" })).toBeNull();
  });
});
