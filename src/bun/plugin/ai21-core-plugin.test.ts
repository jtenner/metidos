/**
 * @file src/bun/plugin/ai21-core-plugin.test.ts
 * @description Regression coverage for the first-party AI21 provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { AI21_MODELS } from "../../../core_plugins/ai21";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const AI21_PLUGIN_ROOT = join("core_plugins", "ai21");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type Ai21Configuration = {
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
  const manifestPath = join(AI21_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected AI21 plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadAi21Configurations(
  input: { envApiKey?: string | null } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: AI21_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "AI21_API_KEY",
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
      throw new Error("Missing AI21 provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "AI21 model provider refresh",
    })) as Ai21Configuration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core AI21 plugin", () => {
  it("uses a literal non-shell sentinel when AI21_API_KEY is missing", async () => {
    const { configurations, runtime } = await loadAi21Configurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_AI21_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("registers the AI21 provider and static Jamba catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "AI21_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadAi21Configurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "ai21" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "ai21",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "env-token",
          authHeader: true,
          baseUrl: "https://api.ai21.com/studio/v1",
          id: "default",
          label: "AI21",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "AI21_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          contextWindow: 256_000,
          id: "jamba-large",
          maxTokens: 4_096,
          name: "Jamba Large",
          reasoning: false,
        }),
        expect.objectContaining({
          contextWindow: 256_000,
          id: "jamba-mini",
          maxTokens: 4_096,
          name: "Jamba Mini",
          reasoning: false,
        }),
        expect.objectContaining({
          contextWindow: 256_000,
          id: "jamba-large-1.7",
          maxTokens: 4_096,
          name: "Jamba Large 1.7",
          reasoning: false,
        }),
        expect.objectContaining({
          contextWindow: 256_000,
          id: "jamba-mini-2",
          maxTokens: 4_096,
          name: "Jamba Mini 2",
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
          configurationLabel: "AI21",
          directoryName: "ai21",
          executeHandle: null,
          pluginId: "ai21",
          pluginName: "AI21 Labs",
          providerId: "ai21",
          providerName: "AI21 Jamba",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find("ai21/ai21/default", "jamba-large")?.contextWindow,
      ).toBe(256_000);
    } finally {
      runtime.dispose();
    }
  });

  it("keeps the static catalog scoped to documented Jamba chat models", () => {
    expect(AI21_MODELS.map((model) => model.id)).toEqual([
      "jamba-large",
      "jamba-mini",
      "jamba-large-1.7",
      "jamba-mini-2",
    ]);
    expect(AI21_MODELS.every((model) => model.contextWindow > 0)).toBe(true);
  });
});
