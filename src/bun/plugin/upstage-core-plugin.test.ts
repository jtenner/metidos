/**
 * @file src/bun/plugin/upstage-core-plugin.test.ts
 * @description Regression coverage for the first-party Upstage provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { UPSTAGE_MODELS } from "../../../core_plugins/upstage";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const UPSTAGE_PLUGIN_ROOT = join("core_plugins", "upstage");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type UpstageConfiguration = {
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
  const manifestPath = join(UPSTAGE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Upstage plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadUpstageConfigurations(
  input: { envApiKey?: string | null } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: UPSTAGE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "UPSTAGE_API_KEY",
          required: false,
          secret: true,
          value: "envApiKey" in input ? input.envApiKey : "env-token",
        },
      ],
      permissions: ["provider:register"],
      settings: { missingRequiredKeys: [], values: { api_key: null } },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Upstage provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Upstage model provider refresh",
    })) as UpstageConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Upstage plugin", () => {
  it("uses a literal non-shell sentinel when UPSTAGE_API_KEY is missing", async () => {
    const { configurations, runtime } = await loadUpstageConfigurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_UPSTAGE_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("registers the Upstage provider and static Solar catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "UPSTAGE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadUpstageConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "upstage" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "upstage",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "env-token",
          authHeader: true,
          baseUrl: "https://api.upstage.ai/v1",
          id: "default",
          label: "Upstage",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "UPSTAGE_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          contextWindow: 128_000,
          id: "solar-pro3",
          maxTokens: 8_192,
          name: "Solar Pro 3",
          reasoning: true,
          thinkingLevelMap: {
            high: "high",
            low: "minimal",
            medium: "high",
            minimal: "minimal",
            xhigh: null,
          },
        }),
        expect.objectContaining({
          contextWindow: 65_536,
          id: "solar-pro2",
          maxTokens: 8_192,
          name: "Solar Pro 2",
          reasoning: true,
        }),
        expect.objectContaining({
          contextWindow: 32_768,
          id: "solar-mini",
          maxTokens: 4_096,
          name: "Solar Mini",
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
          configurationLabel: "Upstage",
          directoryName: "upstage",
          executeHandle: null,
          pluginId: "upstage",
          pluginName: "Upstage",
          providerId: "upstage",
          providerName: "Upstage Solar",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find("upstage/upstage/default", "solar-pro3")
          ?.thinkingLevelMap,
      ).toEqual({
        high: "high",
        low: "minimal",
        medium: "high",
        minimal: "minimal",
        xhigh: null,
      });
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the static catalog scoped to documented text-chat models", () => {
    expect(UPSTAGE_MODELS.map((model) => model.id)).toEqual([
      "solar-pro3",
      "solar-pro2",
      "solar-mini",
    ]);
    expect(UPSTAGE_MODELS.every((model) => model.contextWindow > 0)).toBe(true);
  });
});
