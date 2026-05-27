/**
 * @file src/bun/plugin/yi-core-plugin.test.ts
 * @description Regression coverage for the first-party 01.AI Yi provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeYiModel } from "../../../core_plugins/yi";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const YI_PLUGIN_ROOT = join("core_plugins", "yi");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type YiConfiguration = {
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
  const manifestPath = join(YI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected 01.AI Yi plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadYiConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: YI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "YI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LINGYI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.01.ai/v1/models"],
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
      throw new Error("Missing 01.AI Yi provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "01.AI Yi model provider refresh",
    })) as YiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core 01.AI Yi plugin", () => {
  it("registers the Yi provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.01.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "YI_API_KEY", secret: true }),
      expect.objectContaining({ key: "LINGYI_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadYiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "yi" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "yi",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.01.ai/v1",
          id: "default",
          label: "01.AI Yi",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "YI_API_KEY" },
            { kind: "api_key", source: "env", value: "LINGYI_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes 01.AI model metadata and excludes non-chat models", () => {
    expect(
      normalizeYiModel({
        created: 1708258504,
        id: "yi-large",
        object: "model",
        ownedBy: "01.ai",
      }),
    ).toEqual({
      contextWindow: 32000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "yi-large",
      input: ["text"],
      maxTokens: 4096,
      name: "Yi Large",
      reasoning: false,
    });

    expect(
      normalizeYiModel({
        context_window: 16000,
        id: "yi-vision",
        max_output_tokens: 2048,
        object: "model",
      }),
    ).toEqual({
      contextWindow: 16000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "yi-vision",
      input: ["text", "image"],
      maxTokens: 2048,
      name: "Yi Vision",
      reasoning: false,
    });

    expect(
      normalizeYiModel({
        id: "yi-large-turbo",
        name: "Yi Large Turbo",
      }),
    ).toEqual(
      expect.objectContaining({
        contextWindow: 4000,
        input: ["text"],
        name: "Yi Large Turbo",
      }),
    );

    expect(normalizeYiModel({ id: "yi-embedding" })).toBeNull();
    expect(normalizeYiModel({ id: "yi-rerank" })).toBeNull();
    expect(
      normalizeYiModel({
        id: "yi-large",
        object: "model",
        status: "deleted",
      }),
    ).toBeNull();
  });
});
