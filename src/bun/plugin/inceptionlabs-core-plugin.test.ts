/**
 * @file src/bun/plugin/inceptionlabs-core-plugin.test.ts
 * @description Regression coverage for the first-party Inception Labs Mercury provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const INCEPTIONLABS_PLUGIN_ROOT = join("core_plugins", "inceptionlabs");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type MercuryConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing?: boolean;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  models: Array<{
    compat: Record<string, unknown>;
    contextWindow: number;
    id: string;
    maxTokens: number;
    reasoning: boolean;
    thinkingLevelMap: Record<string, string | null>;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(INCEPTIONLABS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Inception Labs plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadMercuryConfigurations(
  input: { envApiKey?: string | null } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: INCEPTIONLABS_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "INCEPTION_API_KEY",
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
      throw new Error("Missing Mercury provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Mercury model provider refresh",
    })) as MercuryConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Inception Labs Mercury plugin", () => {
  it("uses a literal non-shell sentinel when INCEPTION_API_KEY is missing", async () => {
    const { configurations, runtime } = await loadMercuryConfigurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_INCEPTION_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("registers a Mercury model provider using INCEPTION_API_KEY auth", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "INCEPTION_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadMercuryConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "mercury",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "inceptionlabs",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "env-token",
          authHeader: true,
          baseUrl: "https://api.inceptionlabs.ai/v1",
          id: "default",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "INCEPTION_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          compat: expect.objectContaining({
            maxTokensField: "max_tokens",
            supportsDeveloperRole: false,
            supportsStore: false,
          }),
          contextWindow: 128_000,
          id: "mercury-2",
          maxTokens: 50_000,
          reasoning: true,
          thinkingLevelMap: {
            high: "high",
            low: "low",
            medium: "medium",
            minimal: "instant",
            xhigh: null,
          },
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
          configurationLabel: "Inception Labs Mercury",
          directoryName: "inceptionlabs",
          executeHandle: null,
          pluginId: "inceptionlabs",
          pluginName: "Inception Labs Mercury",
          providerId: "mercury",
          providerName: "Mercury",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find("inceptionlabs/mercury/default", "mercury-2")
          ?.thinkingLevelMap,
      ).toEqual({
        high: "high",
        low: "low",
        medium: "medium",
        minimal: "instant",
        xhigh: null,
      });
    } finally {
      runtime.dispose();
    }
  });
});
