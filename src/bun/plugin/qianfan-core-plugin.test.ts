/**
 * @file src/bun/plugin/qianfan-core-plugin.test.ts
 * @description Regression coverage for the first-party Baidu Qianfan provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { QIANFAN_MODELS } from "../../../core_plugins/qianfan";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const QIANFAN_PLUGIN_ROOT = join("core_plugins", "qianfan");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type QianfanConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing?: boolean;
  authHeader: boolean;
  baseUrl: string;
  headers?: Record<string, string>;
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
  const manifestPath = join(QIANFAN_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Baidu Qianfan plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadQianfanConfigurations(
  input: {
    appId?: string | null;
    baiduApiKey?: string | null;
    baiduQianfanApiKey?: string | null;
    qianfanApiKey?: string | null;
    settingApiKey?: string | null;
  } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: QIANFAN_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "QIANFAN_API_KEY",
          required: false,
          secret: true,
          value: "qianfanApiKey" in input ? input.qianfanApiKey : "env-token",
        },
        {
          key: "BAIDU_QIANFAN_API_KEY",
          required: false,
          secret: true,
          value:
            "baiduQianfanApiKey" in input ? input.baiduQianfanApiKey : null,
        },
        {
          key: "BAIDU_API_KEY",
          required: false,
          secret: true,
          value: "baiduApiKey" in input ? input.baiduApiKey : null,
        },
      ],
      permissions: ["provider:register"],
      settings: {
        missingRequiredKeys: [],
        values: {
          api_key: "settingApiKey" in input ? input.settingApiKey : null,
          app_id: "appId" in input ? input.appId : null,
        },
      },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Baidu Qianfan provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Baidu Qianfan model provider refresh",
    })) as QianfanConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Baidu Qianfan plugin", () => {
  it("uses a literal non-shell sentinel when Qianfan API keys are missing", async () => {
    const { configurations, runtime } = await loadQianfanConfigurations({
      baiduApiKey: null,
      baiduQianfanApiKey: null,
      qianfanApiKey: null,
      settingApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_QIANFAN_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("registers the Baidu Qianfan provider and static chat catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "QIANFAN_API_KEY", secret: true }),
      expect.objectContaining({ key: "BAIDU_QIANFAN_API_KEY", secret: true }),
      expect.objectContaining({ key: "BAIDU_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadQianfanConfigurations({
      appId: "app-123",
      settingApiKey: "setting-token",
    });

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "qianfan" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "qianfan",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "setting-token",
          authHeader: true,
          baseUrl: "https://api.baiduqianfan.ai/v1",
          headers: { appid: "app-123" },
          id: "default",
          label: "Baidu Qianfan",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "QIANFAN_API_KEY" },
            {
              kind: "api_key",
              source: "env",
              value: "BAIDU_QIANFAN_API_KEY",
            },
            { kind: "api_key", source: "env", value: "BAIDU_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          contextWindow: 128_000,
          id: "ernie-5.0",
          maxTokens: 65_536,
          name: "ERNIE 5.0",
          reasoning: false,
        }),
        expect.objectContaining({
          contextWindow: 128_000,
          id: "deepseek-v3.2",
          maxTokens: 32_768,
          name: "DeepSeek V3.2",
          reasoning: false,
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
          configurationLabel: "Baidu Qianfan",
          directoryName: "qianfan",
          executeHandle: null,
          pluginId: "qianfan",
          pluginName: "Baidu Qianfan",
          providerId: "qianfan",
          providerName: "Baidu Qianfan",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find("qianfan/qianfan/default", "ernie-5.0")?.contextWindow,
      ).toBe(128_000);
    } finally {
      runtime.dispose();
    }
  });

  it("falls back through declared environment keys and omits blank appid headers", async () => {
    const { configurations, runtime } = await loadQianfanConfigurations({
      appId: "   ",
      baiduQianfanApiKey: "baidu-qianfan-token",
      qianfanApiKey: null,
      settingApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe("baidu-qianfan-token");
      expect(configurations[0]?.headers).toBeUndefined();
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the static catalog scoped to documented text-chat models", () => {
    expect(QIANFAN_MODELS.map((model) => model.id)).toEqual([
      "ernie-5.0",
      "deepseek-v3.2",
    ]);
    expect(QIANFAN_MODELS.every((model) => model.contextWindow > 0)).toBe(true);
    expect(QIANFAN_MODELS.every((model) => model.maxTokens > 0)).toBe(true);
  });
});
