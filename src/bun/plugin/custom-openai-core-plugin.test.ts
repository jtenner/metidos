/**
 * @file src/bun/plugin/custom-openai-core-plugin.test.ts
 * @description Regression coverage for the first-party custom OpenAI-compatible endpoint provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeCustomOpenAiBaseUrl,
  normalizeCustomOpenAiModelId,
  normalizeCustomOpenAiModels,
  normalizeCustomOpenAiName,
} from "../../../core_plugins/custom_openai";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const CUSTOM_OPENAI_PLUGIN_ROOT = join("core_plugins", "custom_openai");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type CustomOpenAiConfiguration = {
  api: string;
  apiKey?: string;
  authHeader: boolean;
  baseUrl: string;
  configurationMissing: boolean;
  configurationMissingMessage: string;
  id: string;
  label: string;
  models: Array<{
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
  const manifestPath = join(CUSTOM_OPENAI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected custom OpenAI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadCustomOpenAiConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: null,
    model_ids: [],
    name: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: CUSTOM_OPENAI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "CUSTOM_OPENAI_NAME",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "CUSTOM_OPENAI_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "CUSTOM_OPENAI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "CUSTOM_OPENAI_MODEL_IDS",
          required: false,
          secret: false,
          value: null,
        },
      ],
      permissions: ["provider:register"],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing custom OpenAI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Custom OpenAI provider refresh",
    })) as CustomOpenAiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core custom OpenAI-compatible endpoint plugin", () => {
  it("registers the custom OpenAI provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "CUSTOM_OPENAI_NAME",
      "CUSTOM_OPENAI_BASE_URL",
      "CUSTOM_OPENAI_API_KEY",
      "CUSTOM_OPENAI_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "custom_openai",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "custom_openai",
        source: "env",
        value: "CUSTOM_OPENAI_API_KEY",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadCustomOpenAiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "custom_openai" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "custom_openai",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "https://api.example.com/v1",
          configurationMissing: true,
          id: "default",
          label: "Custom OpenAI-Compatible Endpoint",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            {
              kind: "api_key",
              source: "env",
              value: "CUSTOM_OPENAI_API_KEY",
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured custom OpenAI model configurations", async () => {
    const { configurations, runtime } = await loadCustomOpenAiConfigurations({
      api_key: "test-token",
      base_url: "https://gateway.example.com/openai/v1/",
      model_ids: ["gpt-4o-mini", "bad model id", "deepseek-r1-distill"],
      name: "Team Gateway",
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "https://gateway.example.com/openai/v1",
          configurationMissing: false,
          label: "Team Gateway",
          models: [
            {
              api: "openai-completions",
              compat: {
                maxTokensField: "max_tokens",
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsStore: false,
              },
              contextWindow: 128000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "gpt-4o-mini",
              input: ["text"],
              maxTokens: 16384,
              name: "GPT 4o Mini",
              reasoning: false,
            },
            {
              api: "openai-completions",
              compat: {
                maxTokensField: "max_tokens",
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsStore: false,
              },
              contextWindow: 128000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "deepseek-r1-distill",
              input: ["text"],
              maxTokens: 16384,
              name: "Deepseek R1 Distill",
              reasoning: true,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes custom OpenAI settings defensively", () => {
    expect(normalizeCustomOpenAiBaseUrl(null)).toBeNull();
    expect(normalizeCustomOpenAiBaseUrl("https://api.example.com")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeCustomOpenAiBaseUrl("https://api.example.com/v1/")).toBe(
      "https://api.example.com/v1",
    );
    expect(
      normalizeCustomOpenAiBaseUrl("https://gateway.example.com/openai/v1"),
    ).toBe("https://gateway.example.com/openai/v1");
    expect(
      normalizeCustomOpenAiBaseUrl("http://api.example.com/v1"),
    ).toBeNull();
    expect(
      normalizeCustomOpenAiBaseUrl("https://localhost:8443/v1"),
    ).toBeNull();
    expect(
      normalizeCustomOpenAiBaseUrl("https://127.0.0.1:8443/v1"),
    ).toBeNull();
    expect(
      normalizeCustomOpenAiBaseUrl("https://api.example.local/v1"),
    ).toBeNull();
    expect(
      normalizeCustomOpenAiBaseUrl("https://api.example.com/custom"),
    ).toBeNull();
    expect(
      normalizeCustomOpenAiBaseUrl("https://api.example.com/v1?x=1"),
    ).toBeNull();
    expect(normalizeCustomOpenAiName(" Team Gateway \n")).toBe("Team Gateway");
    expect(normalizeCustomOpenAiName("x".repeat(81))).toBe(
      "Custom OpenAI-Compatible Endpoint",
    );
    expect(normalizeCustomOpenAiModelId("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(normalizeCustomOpenAiModelId("bad id")).toBeNull();
    expect(
      normalizeCustomOpenAiModels([
        "gpt-4o-mini",
        "gpt-4o-mini",
        "bad model",
        "openai/gpt-oss-20b",
      ]),
    ).toEqual([
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "gpt-4o-mini",
        input: ["text"],
        maxTokens: 16384,
        name: "GPT 4o Mini",
        reasoning: false,
      },
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-oss-20b",
        input: ["text"],
        maxTokens: 16384,
        name: "Openai GPT Oss 20B",
        reasoning: true,
      },
    ]);
  });
});
