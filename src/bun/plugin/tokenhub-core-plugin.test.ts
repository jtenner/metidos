/**
 * @file src/bun/plugin/tokenhub-core-plugin.test.ts
 * @description Regression coverage for the first-party Tencent TokenHub provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  TOKENHUB_MODELS,
  tokenHubBaseUrl,
  tokenHubRegion,
} from "../../../core_plugins/tokenhub";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const TOKENHUB_PLUGIN_ROOT = join("core_plugins", "tokenhub");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type TokenHubConfiguration = {
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
    thinkingLevelMap?: Record<string, string | null>;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(TOKENHUB_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Tencent TokenHub plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadTokenHubConfigurations(
  input: {
    envApiKey?: string | null;
    settings?: Record<string, boolean | number | string | string[] | null>;
  } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: TOKENHUB_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "TENCENT_TOKENHUB_API_KEY",
          required: false,
          secret: true,
          value: "envApiKey" in input ? input.envApiKey : "env-token",
        },
        {
          key: "TENCENT_MAAS_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "HUNYUAN_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      permissions: ["provider:register"],
      settings: {
        missingRequiredKeys: [],
        values: input.settings ?? { api_key: null, region: "singapore" },
      },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error(
        "Missing Tencent TokenHub provider configuration handle.",
      );
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Tencent TokenHub model provider refresh",
    })) as TokenHubConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Tencent TokenHub plugin", () => {
  it("uses a literal non-shell sentinel when the TokenHub API key is missing", async () => {
    const { configurations, runtime } = await loadTokenHubConfigurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_TOKENHUB_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("registers the TokenHub provider and static Hunyuan catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({
        key: "TENCENT_TOKENHUB_API_KEY",
        secret: true,
      }),
      expect.objectContaining({ key: "TENCENT_MAAS_API_KEY", secret: true }),
      expect.objectContaining({ key: "HUNYUAN_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadTokenHubConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "tokenhub" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "tokenhub",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "env-token",
          authHeader: true,
          baseUrl: "https://tokenhub-intl.tencentcloudmaas.com/v1",
          id: "singapore",
          label: "Tencent TokenHub (singapore)",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            {
              kind: "api_key",
              source: "env",
              value: "TENCENT_TOKENHUB_API_KEY",
            },
            {
              kind: "api_key",
              source: "env",
              value: "TENCENT_MAAS_API_KEY",
            },
            { kind: "api_key", source: "env", value: "HUNYUAN_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          contextWindow: 256_000,
          id: "hy3-preview",
          maxTokens: 128_000,
          name: "Hy3 Preview",
          reasoning: true,
        }),
        expect.objectContaining({
          id: "hunyuan-2.0-thinking-20251109",
          reasoning: true,
          thinkingLevelMap: {
            high: "high",
            low: "low",
            medium: "medium",
            minimal: null,
            xhigh: null,
          },
        }),
        expect.objectContaining({
          id: "hunyuan-2.0-instruct-20251111",
          reasoning: false,
        }),
        expect.objectContaining({
          id: "deepseek-v3.2",
          contextWindow: 128_000,
          reasoning: false,
        }),
        expect.objectContaining({
          id: "deepseek-v3.1-terminus",
          contextWindow: 128_000,
          reasoning: false,
        }),
        expect.objectContaining({
          id: "deepseek-r1-0528",
          contextWindow: 128_000,
          reasoning: true,
        }),
      ]);

      const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
      registerPluginModelProviderConfigurations(registry, [
        {
          configuration: configurations[0] as unknown as Record<
            string,
            unknown
          >,
          configurationId: "singapore",
          configurationLabel: "Tencent TokenHub (singapore)",
          directoryName: "tokenhub",
          executeHandle: null,
          pluginId: "tokenhub",
          pluginName: "Tencent TokenHub",
          providerId: "tokenhub",
          providerName: "Tencent TokenHub",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find(
          "tokenhub/tokenhub/singapore",
          "hunyuan-2.0-thinking-20251109",
        )?.thinkingLevelMap,
      ).toEqual({
        high: "high",
        low: "low",
        medium: "medium",
        minimal: null,
        xhigh: null,
      });
    } finally {
      runtime.dispose();
    }
  });

  it("maps fixed official endpoint variants and keeps arbitrary URLs out", async () => {
    expect(tokenHubRegion("guangzhou")).toBe("guangzhou");
    expect(tokenHubRegion("guangzhou_legacy")).toBe("guangzhou_legacy");
    expect(tokenHubRegion("unknown")).toBe("singapore");
    expect(tokenHubBaseUrl("guangzhou")).toBe(
      "https://tokenhub.tencentcloudmaas.com/v1",
    );
    expect(tokenHubBaseUrl("guangzhou_legacy")).toBe(
      "https://tokenhub.tencentmaas.com/v1",
    );

    const { configurations, runtime } = await loadTokenHubConfigurations({
      settings: { api_key: "setting-token", region: "guangzhou_legacy" },
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          apiKey: "setting-token",
          baseUrl: "https://tokenhub.tencentmaas.com/v1",
          id: "guangzhou_legacy",
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the static catalog scoped to documented text-chat models", () => {
    expect(TOKENHUB_MODELS.map((model) => model.id)).toEqual([
      "hy3-preview",
      "hunyuan-2.0-thinking-20251109",
      "hunyuan-2.0-instruct-20251111",
      "deepseek-v3.2",
      "deepseek-v3.1-terminus",
      "deepseek-r1-0528",
    ]);
    expect(TOKENHUB_MODELS.every((model) => model.contextWindow > 0)).toBe(
      true,
    );
    expect(TOKENHUB_MODELS.every((model) => model.input.includes("text"))).toBe(
      true,
    );
  });
});
