/**
 * @file src/bun/plugin/bifrost-core-plugin.test.ts
 * @description Regression coverage for the first-party Bifrost Gateway provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeBifrostBaseUrl,
  normalizeBifrostModelId,
  normalizeBifrostModels,
} from "../../../core_plugins/bifrost";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const BIFROST_PLUGIN_ROOT = join("core_plugins", "bifrost");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type BifrostConfiguration = {
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
  const manifestPath = join(BIFROST_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Bifrost Gateway plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadBifrostConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:8080/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: BIFROST_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "BIFROST_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "BIFROST_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "BIFROST_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "BIFROST_VIRTUAL_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "BIFROST_MODEL_IDS",
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
      throw new Error("Missing Bifrost Gateway provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Bifrost Gateway provider refresh",
    })) as BifrostConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Bifrost Gateway plugin", () => {
  it("registers the Bifrost provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "BIFROST_BASE_URL",
      "BIFROST_API_KEY",
      "BIFROST_TOKEN",
      "BIFROST_VIRTUAL_KEY",
      "BIFROST_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "bifrost",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "bifrost",
        source: "env",
        value: "BIFROST_API_KEY",
      },
      {
        kind: "api_key",
        provider: "bifrost",
        source: "env",
        value: "BIFROST_TOKEN",
      },
      {
        kind: "api_key",
        provider: "bifrost",
        source: "env",
        value: "BIFROST_VIRTUAL_KEY",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadBifrostConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "bifrost" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "bifrost",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:8080/v1",
          configurationMissing: true,
          id: "default",
          label: "Bifrost Gateway",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "BIFROST_API_KEY" },
            { kind: "api_key", source: "env", value: "BIFROST_TOKEN" },
            { kind: "api_key", source: "env", value: "BIFROST_VIRTUAL_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured Bifrost model configurations", async () => {
    const { configurations, runtime } = await loadBifrostConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:8081/openai/",
      model_ids: [
        "openai/gpt-4o-mini",
        "bad model id",
        "anthropic/claude-3-5-sonnet",
      ],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:8081/openai/v1",
          configurationMissing: false,
          label: "Bifrost Gateway",
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
              id: "openai/gpt-4o-mini",
              input: ["text"],
              maxTokens: 8192,
              name: "Openai GPT 4o Mini",
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
              id: "anthropic/claude-3-5-sonnet",
              input: ["text"],
              maxTokens: 8192,
              name: "Anthropic Claude 3 5 Sonnet",
              reasoning: false,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Bifrost settings defensively", () => {
    expect(normalizeBifrostBaseUrl(null)).toBe("http://localhost:8080/v1");
    expect(normalizeBifrostBaseUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/v1",
    );
    expect(normalizeBifrostBaseUrl("http://127.0.0.1:8081/v1/")).toBe(
      "http://127.0.0.1:8081/v1",
    );
    expect(normalizeBifrostBaseUrl("https://localhost:4443/openai/v1")).toBe(
      "https://localhost:4443/openai/v1",
    );
    expect(normalizeBifrostBaseUrl("http://localhost:8080/openai")).toBe(
      "http://localhost:8080/openai/v1",
    );
    expect(normalizeBifrostBaseUrl("http://0.0.0.0:8080/v1")).toBeNull();
    expect(normalizeBifrostBaseUrl("http://192.168.1.2:8080/v1")).toBeNull();
    expect(normalizeBifrostBaseUrl("http://localhost:8080/custom")).toBeNull();
    expect(normalizeBifrostModelId("openai/gpt-4o-mini")).toBe(
      "openai/gpt-4o-mini",
    );
    expect(normalizeBifrostModelId("bad id")).toBeNull();
    expect(
      normalizeBifrostModels([
        "openai/gpt-4o-mini",
        "openai/gpt-4o-mini",
        "bad model",
        "deepseek/deepseek-r1",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-4o-mini",
        input: ["text"],
        maxTokens: 8192,
        name: "Openai GPT 4o Mini",
        reasoning: false,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "deepseek/deepseek-r1",
        input: ["text"],
        maxTokens: 8192,
        name: "Deepseek Deepseek R1",
        reasoning: true,
      },
    ]);
  });
});
