/**
 * @file src/bun/plugin/azure-openai-core-plugin.test.ts
 * @description Regression coverage for the first-party Azure OpenAI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  azureOpenAiBaseUrl,
  normalizeAzureDeploymentModels,
  normalizeAzureDeploymentName,
  normalizeAzureResourceName,
} from "../../../core_plugins/azure_openai";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const AZURE_OPENAI_PLUGIN_ROOT = join("core_plugins", "azure_openai");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type AzureOpenAiConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing?: boolean;
  apiKeyMissingMessage?: string;
  authHeader: boolean;
  baseUrl: string;
  configurationMissing?: boolean;
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
  const manifestPath = join(AZURE_OPENAI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Azure OpenAI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadAzureOpenAiConfigurations(
  input: {
    envApiKey?: string | null;
    envDeployments?: string | null;
    envResourceName?: string | null;
    settings?: Record<string, boolean | number | string | string[] | null>;
  } = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: AZURE_OPENAI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "AZURE_OPENAI_API_KEY",
          required: false,
          secret: true,
          value: "envApiKey" in input ? input.envApiKey : "env-token",
        },
        {
          key: "AZURE_OPENAI_RESOURCE_NAME",
          required: false,
          secret: false,
          value:
            "envResourceName" in input ? input.envResourceName : "metidos-ai",
        },
        {
          key: "AZURE_OPENAI_DEPLOYMENTS",
          required: false,
          secret: false,
          value:
            "envDeployments" in input
              ? input.envDeployments
              : "gpt-4.1, text.reasoner",
        },
      ],
      permissions: ["provider:register"],
      settings: {
        missingRequiredKeys: [],
        values: {
          api_key: null,
          deployment_names: [],
          resource_name: null,
          ...input.settings,
        },
      },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Azure OpenAI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Azure OpenAI model provider refresh",
    })) as AzureOpenAiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Azure OpenAI plugin", () => {
  it("registers the Azure OpenAI provider and deployment-based catalog", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.network).toBeNull();
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "AZURE_OPENAI_API_KEY", secret: true }),
      expect.objectContaining({ key: "AZURE_OPENAI_RESOURCE_NAME" }),
      expect.objectContaining({ key: "AZURE_OPENAI_DEPLOYMENTS" }),
    ]);

    const { configurations, runtime, setup } =
      await loadAzureOpenAiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "azure_openai" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "azure_openai",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "azure-openai-responses",
          apiKey: "env-token",
          authHeader: true,
          baseUrl: "https://metidos-ai.openai.azure.com/openai/v1",
          configurationMissing: false,
          id: "default",
          label: "Azure OpenAI",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "AZURE_OPENAI_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual([
        expect.objectContaining({
          api: "azure-openai-responses",
          contextWindow: 128_000,
          id: "gpt-4.1",
          input: ["text"],
          maxTokens: 16_384,
          name: "Gpt 4 1",
          reasoning: false,
        }),
        expect.objectContaining({
          id: "text.reasoner",
          name: "Text Reasoner",
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
          configurationLabel: "Azure OpenAI",
          directoryName: "azure_openai",
          executeHandle: null,
          pluginId: "azure_openai",
          pluginName: "Azure OpenAI",
          providerId: "azure_openai",
          providerName: "Azure OpenAI",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      const registered = registry.find(
        "azure_openai/azure_openai/default",
        "gpt-4.1",
      );
      expect(registered?.api).toBe("azure-openai-responses");
      expect(registered?.baseUrl).toBe(
        "https://metidos-ai.openai.azure.com/openai/v1",
      );
    } finally {
      runtime.dispose();
    }
  });

  it("prefers Plugin Settings over environment fallbacks", async () => {
    const { configurations, runtime } = await loadAzureOpenAiConfigurations({
      settings: {
        api_key: "settings-token",
        deployment_names: ["settings-gpt", "settings-gpt"],
        resource_name: "settings-resource",
      },
    });

    try {
      expect(configurations[0]?.apiKey).toBe("settings-token");
      expect(configurations[0]?.baseUrl).toBe(
        "https://settings-resource.openai.azure.com/openai/v1",
      );
      expect(configurations[0]?.models.map((model) => model.id)).toEqual([
        "settings-gpt",
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("uses a literal non-shell sentinel when AZURE_OPENAI_API_KEY is missing", async () => {
    const { configurations, runtime } = await loadAzureOpenAiConfigurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKey).toBe(
        "METIDOS_AZURE_OPENAI_API_KEY_NOT_CONFIGURED",
      );
      expect(configurations[0]?.apiKey.startsWith("!")).toBe(false);
      expect(configurations[0]?.apiKeyMissing).toBe(true);
    } finally {
      runtime.dispose();
    }
  });

  it("requires a resource name before exposing deployment models", async () => {
    const { configurations, runtime } = await loadAzureOpenAiConfigurations({
      envResourceName: null,
    });

    try {
      expect(configurations[0]?.configurationMissing).toBe(true);
      expect(configurations[0]?.models).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Azure resource and deployment configuration defensively", () => {
    expect(normalizeAzureResourceName("My-Resource-1")).toBe("my-resource-1");
    expect(normalizeAzureResourceName("bad.example.com")).toBeNull();
    expect(normalizeAzureResourceName("-bad")).toBeNull();
    expect(azureOpenAiBaseUrl("my-resource-1")).toBe(
      "https://my-resource-1.openai.azure.com/openai/v1",
    );

    expect(normalizeAzureDeploymentName("gpt-4.1-prod")).toBe("gpt-4.1-prod");
    expect(normalizeAzureDeploymentName("bad/deployment")).toBeNull();
    expect(normalizeAzureDeploymentName("contains space")).toBeNull();
    expect(
      normalizeAzureDeploymentModels([
        "gpt-4.1-prod",
        "gpt-4.1-prod",
        " ",
        "bad/deployment",
        "embed:v1",
      ]),
    ).toEqual([
      {
        contextWindow: 128_000,
        id: "gpt-4.1-prod",
        maxTokens: 16_384,
        name: "Gpt 4 1 Prod",
      },
      {
        contextWindow: 128_000,
        id: "embed:v1",
        maxTokens: 16_384,
        name: "Embed V1",
      },
    ]);
  });
});
