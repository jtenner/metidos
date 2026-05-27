/**
 * @file src/bun/plugin/tgi-core-plugin.test.ts
 * @description Regression coverage for the first-party TGI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeTgiBaseUrl,
  normalizeTgiModelId,
  normalizeTgiModels,
} from "../../../core_plugins/tgi";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const TGI_PLUGIN_ROOT = join("core_plugins", "tgi");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type TgiConfiguration = {
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
  const manifestPath = join(TGI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected TGI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadTgiConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:8080/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: TGI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "TGI_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "TGI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "TGI_MODEL_IDS",
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
      throw new Error("Missing TGI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "TGI provider refresh",
    })) as TgiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core TGI plugin", () => {
  it("registers the TGI provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "TGI_BASE_URL",
      "TGI_API_KEY",
      "TGI_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "tgi",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "tgi",
        source: "env",
        value: "TGI_API_KEY",
      },
    ]);

    const { configurations, runtime, setup } = await loadTgiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "tgi" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "tgi",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:8080/v1",
          configurationMissing: true,
          id: "default",
          label: "TGI OpenAI Server",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "TGI_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured TGI model configurations", async () => {
    const { configurations, runtime } = await loadTgiConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:8081/v1/",
      model_ids: ["Qwen/Qwen3-4B", "bad model id", "deepseek-r1-distill"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:8081/v1",
          configurationMissing: false,
          label: "TGI OpenAI Server",
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
              id: "Qwen/Qwen3-4B",
              input: ["text"],
              maxTokens: 8192,
              name: "Qwen Qwen3 4B",
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
              id: "deepseek-r1-distill",
              input: ["text"],
              maxTokens: 8192,
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

  it("normalizes TGI settings defensively", () => {
    expect(normalizeTgiBaseUrl(null)).toBe("http://localhost:8080/v1");
    expect(normalizeTgiBaseUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/v1",
    );
    expect(normalizeTgiBaseUrl("http://127.0.0.1:8081/v1/")).toBe(
      "http://127.0.0.1:8081/v1",
    );
    expect(normalizeTgiBaseUrl("https://localhost:8443/v1")).toBe(
      "https://localhost:8443/v1",
    );
    expect(normalizeTgiBaseUrl("http://192.168.1.2:8000/v1")).toBeNull();
    expect(normalizeTgiBaseUrl("http://localhost:8080/custom")).toBeNull();
    expect(normalizeTgiModelId("Qwen/Qwen3-4B")).toBe("Qwen/Qwen3-4B");
    expect(normalizeTgiModelId("bad id")).toBeNull();
    expect(
      normalizeTgiModels([
        "Qwen/Qwen3-4B",
        "Qwen/Qwen3-4B",
        "bad model",
        "openai/gpt-oss-20b",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "Qwen/Qwen3-4B",
        input: ["text"],
        maxTokens: 8192,
        name: "Qwen Qwen3 4B",
        reasoning: false,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-oss-20b",
        input: ["text"],
        maxTokens: 8192,
        name: "Openai GPT Oss 20b",
        reasoning: true,
      },
    ]);
  });
});
