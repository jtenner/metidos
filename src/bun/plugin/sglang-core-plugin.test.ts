/**
 * @file src/bun/plugin/sglang-core-plugin.test.ts
 * @description Regression coverage for the first-party SGLang provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeSglangBaseUrl,
  normalizeSglangModelId,
  normalizeSglangModels,
} from "../../../core_plugins/sglang";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const SGLANG_PLUGIN_ROOT = join("core_plugins", "sglang");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type SglangConfiguration = {
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
  const manifestPath = join(SGLANG_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected SGLang plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadSglangConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:30000/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: SGLANG_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "SGLANG_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "SGLANG_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "SGLANG_MODEL_IDS",
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
      throw new Error("Missing SGLang provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "SGLang provider refresh",
    })) as SglangConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core SGLang plugin", () => {
  it("registers the SGLang provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "SGLANG_BASE_URL",
      "SGLANG_API_KEY",
      "SGLANG_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "sglang",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "sglang",
        source: "env",
        value: "SGLANG_API_KEY",
      },
    ]);

    const { configurations, runtime, setup } = await loadSglangConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "sglang" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "sglang",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:30000/v1",
          configurationMissing: true,
          id: "default",
          label: "SGLang OpenAI Server",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "SGLANG_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured SGLang model configurations", async () => {
    const { configurations, runtime } = await loadSglangConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:30001/v1/",
      model_ids: ["Qwen/Qwen3-4B", "bad model id", "deepseek-r1-distill"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:30001/v1",
          configurationMissing: false,
          label: "SGLang OpenAI Server",
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

  it("normalizes SGLang settings defensively", () => {
    expect(normalizeSglangBaseUrl(null)).toBe("http://localhost:30000/v1");
    expect(normalizeSglangBaseUrl("http://localhost:30000")).toBe(
      "http://localhost:30000/v1",
    );
    expect(normalizeSglangBaseUrl("http://127.0.0.1:30001/v1/")).toBe(
      "http://127.0.0.1:30001/v1",
    );
    expect(normalizeSglangBaseUrl("https://localhost:3443/v1")).toBe(
      "https://localhost:3443/v1",
    );
    expect(normalizeSglangBaseUrl("http://192.168.1.2:30000/v1")).toBeNull();
    expect(normalizeSglangBaseUrl("http://localhost:30000/custom")).toBeNull();
    expect(normalizeSglangModelId("Qwen/Qwen3-4B")).toBe("Qwen/Qwen3-4B");
    expect(normalizeSglangModelId("bad id")).toBeNull();
    expect(
      normalizeSglangModels([
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
