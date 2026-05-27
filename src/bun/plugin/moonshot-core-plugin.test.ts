/**
 * @file src/bun/plugin/moonshot-core-plugin.test.ts
 * @description Regression coverage for the first-party Moonshot AI / Kimi provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeMoonshotModel } from "../../../core_plugins/moonshot";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const MOONSHOT_PLUGIN_ROOT = join("core_plugins", "moonshot");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type MoonshotConfiguration = {
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
  const manifestPath = join(MOONSHOT_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Moonshot plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadMoonshotConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: MOONSHOT_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "MOONSHOT_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.moonshot.ai/v1/models"],
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
      throw new Error("Missing Moonshot provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Moonshot model provider refresh",
    })) as MoonshotConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Moonshot plugin", () => {
  it("registers the Moonshot provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.moonshot.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "MOONSHOT_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadMoonshotConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "moonshot",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "moonshot",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.moonshot.ai/v1",
          id: "default",
          label: "Moonshot AI / Kimi",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "MOONSHOT_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Moonshot model metadata and excludes non-chat models", () => {
    expect(
      normalizeMoonshotModel({
        id: "kimi-k2-0711-preview",
        max_context_length: 128000,
        max_tokens: 8192,
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "kimi-k2-0711-preview",
      input: ["text"],
      maxTokens: 8192,
      name: "Kimi K2 0711 Preview",
      reasoning: false,
    });

    expect(
      normalizeMoonshotModel({
        context_length: 32768,
        id: "moonshot-v1-32k-vision-preview",
        max_output_tokens: 4096,
        name: "Moonshot Vision Preview",
        object: "model",
        owned_by: "moonshot",
        supports_image_in: true,
        supports_reasoning: true,
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "moonshot-v1-32k-vision-preview",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Moonshot Vision Preview",
      reasoning: false,
    });

    expect(
      normalizeMoonshotModel({
        capabilities: { chat: false },
        id: "moonshot-embedding",
      }),
    ).toBeNull();
    expect(normalizeMoonshotModel({ id: "kimi-rerank" })).toBeNull();
  });
});
