/**
 * @file src/bun/plugin/litellm-core-plugin.test.ts
 * @description Regression coverage for the first-party LiteLLM Proxy provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeLiteLlmBaseUrl,
  normalizeLiteLlmModelId,
  normalizeLiteLlmModels,
} from "../../../core_plugins/litellm";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const LITELLM_PLUGIN_ROOT = join("core_plugins", "litellm");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type LiteLlmConfiguration = {
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
  const manifestPath = join(LITELLM_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected LiteLLM Proxy plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadLiteLlmConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:4000/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: LITELLM_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "LITELLM_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "LITELLM_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LITELLM_VIRTUAL_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LITELLM_MASTER_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LITELLM_MODEL_IDS",
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
      throw new Error("Missing LiteLLM Proxy provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "LiteLLM Proxy provider refresh",
    })) as LiteLlmConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core LiteLLM Proxy plugin", () => {
  it("registers the LiteLLM provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "LITELLM_BASE_URL",
      "LITELLM_API_KEY",
      "LITELLM_VIRTUAL_KEY",
      "LITELLM_MASTER_KEY",
      "LITELLM_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "litellm",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "litellm",
        source: "env",
        value: "LITELLM_API_KEY",
      },
      {
        kind: "api_key",
        provider: "litellm",
        source: "env",
        value: "LITELLM_VIRTUAL_KEY",
      },
      {
        kind: "api_key",
        provider: "litellm",
        source: "env",
        value: "LITELLM_MASTER_KEY",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadLiteLlmConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "litellm" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "litellm",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:4000/v1",
          configurationMissing: true,
          id: "default",
          label: "LiteLLM Proxy",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "LITELLM_API_KEY" },
            { kind: "api_key", source: "env", value: "LITELLM_VIRTUAL_KEY" },
            { kind: "api_key", source: "env", value: "LITELLM_MASTER_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured LiteLLM model configurations", async () => {
    const { configurations, runtime } = await loadLiteLlmConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:4001/v1/",
      model_ids: ["gpt-4o-mini", "bad model id", "openai/gpt-oss-20b"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:4001/v1",
          configurationMissing: false,
          label: "LiteLLM Proxy",
          models: [
            {
              api: "openai-completions",
              compat: {
                maxTokensField: "max_tokens",
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsStore: false,
              },
              contextWindow: 131072,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "gpt-4o-mini",
              input: ["text"],
              maxTokens: 8192,
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
              contextWindow: 131072,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "openai/gpt-oss-20b",
              input: ["text"],
              maxTokens: 8192,
              name: "Openai GPT Oss 20B",
              reasoning: true,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes LiteLLM settings defensively", () => {
    expect(normalizeLiteLlmBaseUrl(null)).toBe("http://localhost:4000/v1");
    expect(normalizeLiteLlmBaseUrl("http://localhost:4000")).toBe(
      "http://localhost:4000/v1",
    );
    expect(normalizeLiteLlmBaseUrl("http://127.0.0.1:4001/v1/")).toBe(
      "http://127.0.0.1:4001/v1",
    );
    expect(normalizeLiteLlmBaseUrl("https://localhost:4443/v1")).toBe(
      "https://localhost:4443/v1",
    );
    expect(normalizeLiteLlmBaseUrl("http://0.0.0.0:4000/v1")).toBeNull();
    expect(normalizeLiteLlmBaseUrl("http://192.168.1.2:4000/v1")).toBeNull();
    expect(normalizeLiteLlmBaseUrl("http://localhost:4000/custom")).toBeNull();
    expect(normalizeLiteLlmModelId("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(normalizeLiteLlmModelId("bad id")).toBeNull();
    expect(
      normalizeLiteLlmModels([
        "gpt-4o-mini",
        "gpt-4o-mini",
        "bad model",
        "openai/gpt-oss-20b",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "gpt-4o-mini",
        input: ["text"],
        maxTokens: 8192,
        name: "GPT 4o Mini",
        reasoning: false,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-oss-20b",
        input: ["text"],
        maxTokens: 8192,
        name: "Openai GPT Oss 20B",
        reasoning: true,
      },
    ]);
  });
});
