/**
 * @file src/bun/plugin/zai-core-plugin.test.ts
 * @description Regression coverage for the first-party Z.AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import { normalizeZaiModelsPayload } from "../../../core_plugins/zai";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const ZAI_PLUGIN_ROOT = join("core_plugins", "zai");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type ZaiConfiguration = {
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
    input: string[];
    maxTokens: number;
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(ZAI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Z.AI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadZaiConfigurations(
  input: { endpoint?: string | null; envApiKey?: string | null } = {},
) {
  const build = await buildPluginEntrypoint({ pluginRoot: ZAI_PLUGIN_ROOT });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "ZAI_API_KEY",
          required: false,
          secret: true,
          value: "envApiKey" in input ? input.envApiKey : null,
        },
      ],
      network: {
        allow: [
          "https://api.z.ai/api/paas/v4/models",
          "https://api.z.ai/api/coding/paas/v4/models",
        ],
        enforceHttps: true,
      },
      permissions: ["network:fetch", "provider:register", "log:write"],
      settings: {
        missingRequiredKeys: [],
        values: { api_key: null, endpoint: input.endpoint ?? null },
      },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Z.AI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Z.AI model provider refresh",
    })) as ZaiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Z.AI plugin", () => {
  it("registers Z.AI over Pi's bundled provider using the general API endpoint by default", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: [
          "https://api.z.ai/api/paas/v4/models",
          "https://api.z.ai/api/coding/paas/v4/models",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.providers).toEqual([
      expect.objectContaining({ id: "zai", timeoutMs: 30_000 }),
      expect.objectContaining({ id: "zai_coding_plan", timeoutMs: 30_000 }),
    ]);
    expect(parsedManifest.settings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "api_key", kind: "secret" }),
        expect.objectContaining({
          defaultValue: "general_api",
          key: "endpoint",
          kind: "enum",
          options: ["general_api", "coding_plan"],
        }),
      ]),
    );

    const { configurations, runtime, setup } = await loadZaiConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "zai",
        "zai_coding_plan",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "zai",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "METIDOS_ZAI_API_KEY_NOT_CONFIGURED",
          apiKeyMissing: true,
          authHeader: true,
          baseUrl: "https://api.z.ai/api/paas/v4",
          id: "default",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "ZAI_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            compat: expect.objectContaining({
              supportsDeveloperRole: false,
              thinkingFormat: "zai",
              zaiToolStream: true,
            }),
            id: "glm-5.2",
            maxTokens: 131_072,
            reasoning: true,
          }),
        ]),
      );

      const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
      registerPluginModelProviderConfigurations(registry, [
        {
          configuration: configurations[0] as unknown as Record<
            string,
            unknown
          >,
          configurationId: "default",
          configurationLabel: "Z.AI",
          directoryName: "zai",
          executeHandle: null,
          pluginId: "zai",
          pluginName: "Z.AI",
          providerId: "zai",
          providerName: "Z.AI",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(registry.find("zai", "glm-5.2")?.provider).toBe("zai");
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes OpenAI-compatible Z.AI model discovery payloads", () => {
    expect(
      normalizeZaiModelsPayload({
        data: [
          {
            context_window: 262144,
            id: "glm-5.2",
            max_output_tokens: 131072,
          },
          {
            capabilities: { vision: true },
            id: "glm-5v-turbo",
            name: "GLM-5V-Turbo",
          },
        ],
        object: "list",
      }),
    ).toEqual([
      {
        contextWindow: 262144,
        id: "glm-5.2",
        input: ["text"],
        maxTokens: 131072,
        name: "GLM-5.2",
      },
      {
        contextWindow: 200000,
        id: "glm-5v-turbo",
        input: ["text", "image"],
        maxTokens: 131072,
        name: "GLM-5V-Turbo",
      },
    ]);
  });

  it("can target the Coding Plan endpoint and reports a sentinel when no key is configured", async () => {
    const { configurations, runtime } = await loadZaiConfigurations({
      endpoint: "coding_plan",
      envApiKey: null,
    });

    try {
      expect(configurations[0]).toEqual(
        expect.objectContaining({
          apiKey: "METIDOS_ZAI_API_KEY_NOT_CONFIGURED",
          apiKeyMissing: true,
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
        }),
      );
    } finally {
      runtime.dispose();
    }
  });
});
