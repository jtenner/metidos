/**
 * @file src/bun/plugin/lmstudio-core-plugin.test.ts
 * @description Regression coverage for the first-party LM Studio provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeLmStudioBaseUrl,
  normalizeLmStudioModelId,
  normalizeLmStudioModels,
} from "../../../core_plugins/lmstudio";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const LMSTUDIO_PLUGIN_ROOT = join("core_plugins", "lmstudio");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type LmStudioConfiguration = {
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
  const manifestPath = join(LMSTUDIO_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected LM Studio plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadLmStudioConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:1234/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: LMSTUDIO_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "LMSTUDIO_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "LM_API_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LMSTUDIO_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LMSTUDIO_MODEL_IDS",
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
      throw new Error("Missing LM Studio provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "LM Studio provider refresh",
    })) as LmStudioConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core LM Studio plugin", () => {
  it("registers the LM Studio provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "LMSTUDIO_BASE_URL",
      "LM_API_TOKEN",
      "LMSTUDIO_API_KEY",
      "LMSTUDIO_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "lmstudio",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "lmstudio",
        source: "env",
        value: "LM_API_TOKEN",
      },
      {
        kind: "api_key",
        provider: "lmstudio",
        source: "env",
        value: "LMSTUDIO_API_KEY",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadLmStudioConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "lmstudio" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "lmstudio",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:1234/v1",
          configurationMissing: true,
          id: "default",
          label: "LM Studio",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "LM_API_TOKEN" },
            { kind: "api_key", source: "env", value: "LMSTUDIO_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured LM Studio model configurations", async () => {
    const { configurations, runtime } = await loadLmStudioConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:4321/v1/",
      model_ids: ["openai/gpt-oss-20b", "bad model id", "deepseek-r1-distill"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:4321/v1",
          configurationMissing: false,
          label: "LM Studio",
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
              id: "openai/gpt-oss-20b",
              input: ["text"],
              maxTokens: 8192,
              name: "Openai GPT Oss 20b",
              reasoning: true,
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

  it("normalizes LM Studio settings defensively", () => {
    expect(normalizeLmStudioBaseUrl(null)).toBe("http://localhost:1234/v1");
    expect(normalizeLmStudioBaseUrl("http://localhost:1234")).toBe(
      "http://localhost:1234/v1",
    );
    expect(normalizeLmStudioBaseUrl("http://127.0.0.1:4321/v1/")).toBe(
      "http://127.0.0.1:4321/v1",
    );
    expect(normalizeLmStudioBaseUrl("https://localhost:1234/v1")).toBe(
      "https://localhost:1234/v1",
    );
    expect(normalizeLmStudioBaseUrl("http://192.168.1.2:1234/v1")).toBeNull();
    expect(normalizeLmStudioBaseUrl("http://localhost:1234/custom")).toBeNull();
    expect(normalizeLmStudioModelId("openai/gpt-oss-20b")).toBe(
      "openai/gpt-oss-20b",
    );
    expect(normalizeLmStudioModelId("bad id")).toBeNull();
    expect(
      normalizeLmStudioModels([
        "openai/gpt-oss-20b",
        "openai/gpt-oss-20b",
        "bad model",
        "qwen/qwen3-4b",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-oss-20b",
        input: ["text"],
        maxTokens: 8192,
        name: "Openai GPT Oss 20b",
        reasoning: true,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "qwen/qwen3-4b",
        input: ["text"],
        maxTokens: 8192,
        name: "Qwen Qwen3 4b",
        reasoning: false,
      },
    ]);
  });
});
