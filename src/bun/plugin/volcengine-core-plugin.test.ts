/**
 * @file src/bun/plugin/volcengine-core-plugin.test.ts
 * @description Regression coverage for the first-party Volcengine Ark provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { VOLCENGINE_ARK_MODELS } from "../../../core_plugins/volcengine";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const VOLCENGINE_PLUGIN_ROOT = join("core_plugins", "volcengine");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type VolcengineConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing?: boolean;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    api: string;
    compat: Record<string, unknown>;
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
  const manifestPath = join(VOLCENGINE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Volcengine Ark plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadVolcengineConfigurations(
  input: {
    arkApiKey?: string | null;
    settingApiKey?: string | null;
    volcengineApiKey?: string | null;
  } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: VOLCENGINE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "ARK_API_KEY",
          required: false,
          secret: true,
          value: "arkApiKey" in input ? input.arkApiKey : "ark-token",
        },
        {
          key: "VOLCENGINE_API_KEY",
          required: false,
          secret: true,
          value: "volcengineApiKey" in input ? input.volcengineApiKey : null,
        },
      ],
      permissions: ["provider:register"],
      settings: {
        missingRequiredKeys: [],
        values: { api_key: input.settingApiKey ?? null },
      },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Volcengine Ark provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Volcengine Ark model provider refresh",
    })) as VolcengineConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Volcengine Ark plugin", () => {
  it("uses a literal non-shell sentinel when all API keys are missing", async () => {
    const { configurations, runtime } = await loadVolcengineConfigurations({
      arkApiKey: null,
      settingApiKey: null,
      volcengineApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_VOLCENGINE_ARK_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("prefers the Plugin Setting, then ARK_API_KEY, then VOLCENGINE_API_KEY", async () => {
    const setting = await loadVolcengineConfigurations({
      arkApiKey: "ark-token",
      settingApiKey: "setting-token",
      volcengineApiKey: "volcengine-token",
    });
    try {
      expect(setting.configurations[0]?.apiKey).toBe("setting-token");
    } finally {
      setting.runtime.dispose();
    }

    const arkEnv = await loadVolcengineConfigurations({
      arkApiKey: "ark-token",
      settingApiKey: null,
      volcengineApiKey: "volcengine-token",
    });
    try {
      expect(arkEnv.configurations[0]?.apiKey).toBe("ark-token");
    } finally {
      arkEnv.runtime.dispose();
    }

    const fallbackEnv = await loadVolcengineConfigurations({
      arkApiKey: null,
      settingApiKey: null,
      volcengineApiKey: "volcengine-token",
    });
    try {
      expect(fallbackEnv.configurations[0]?.apiKey).toBe("volcengine-token");
    } finally {
      fallbackEnv.runtime.dispose();
    }
  });

  it("registers the Volcengine Ark provider and static Doubao catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "ARK_API_KEY", secret: true }),
      expect.objectContaining({ key: "VOLCENGINE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadVolcengineConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "volcengine" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "volcengine",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "ark-token",
          authHeader: true,
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
          id: "default",
          label: "Volcengine Ark",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "ARK_API_KEY" },
            { kind: "api_key", source: "env", value: "VOLCENGINE_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          contextWindow: 256_000,
          id: "doubao-seed-2-0-pro-260215",
          input: ["text", "image"],
          maxTokens: 32_768,
          name: "Doubao Seed 2.0 Pro",
          reasoning: true,
        }),
        expect.objectContaining({
          contextWindow: 256_000,
          id: "doubao-seed-2-0-lite-260215",
          input: ["text", "image"],
          maxTokens: 32_768,
          name: "Doubao Seed 2.0 Lite",
          reasoning: true,
        }),
        expect.objectContaining({
          contextWindow: 256_000,
          id: "doubao-seed-2-0-mini-260215",
          input: ["text", "image"],
          maxTokens: 32_768,
          name: "Doubao Seed 2.0 Mini",
          reasoning: true,
        }),
        expect.objectContaining({ id: "doubao-seed-1-8-251228" }),
        expect.objectContaining({ id: "doubao-seed-1-6-251015" }),
        expect.objectContaining({
          id: "doubao-seed-1-6-vision-250815",
          input: ["text", "image"],
        }),
      ]);

      const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
      registerPluginModelProviderConfigurations(registry, [
        {
          configuration: configurations[0] as unknown as Record<
            string,
            unknown
          >,
          configurationId: "default",
          configurationLabel: "Volcengine Ark",
          directoryName: "volcengine",
          executeHandle: null,
          pluginId: "volcengine",
          pluginName: "Volcengine Ark",
          providerId: "volcengine",
          providerName: "Volcengine Ark",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find(
          "volcengine/volcengine/default",
          "doubao-seed-2-0-pro-260215",
        )?.baseUrl,
      ).toBe("https://ark.cn-beijing.volces.com/api/v3");
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the static catalog scoped to documented chat models", () => {
    expect(VOLCENGINE_ARK_MODELS.map((model) => model.id)).toEqual([
      "doubao-seed-2-0-pro-260215",
      "doubao-seed-2-0-lite-260215",
      "doubao-seed-2-0-mini-260215",
      "doubao-seed-1-8-251228",
      "doubao-seed-1-6-251015",
      "doubao-seed-1-6-vision-250815",
    ]);
    expect(
      VOLCENGINE_ARK_MODELS.every(
        (model) => model.contextWindow > 0 && model.maxTokens > 0,
      ),
    ).toBe(true);
  });
});
