/**
 * @file src/bun/plugin/localai-core-plugin.test.ts
 * @description Regression coverage for the first-party LocalAI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeLocalAiBaseUrl,
  normalizeLocalAiModelId,
  normalizeLocalAiModels,
} from "../../../core_plugins/localai";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const LOCALAI_PLUGIN_ROOT = join("core_plugins", "localai");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type LocalAiConfiguration = {
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
  const manifestPath = join(LOCALAI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected LocalAI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadLocalAiConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: "http://localhost:8080/v1",
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: LOCALAI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "LOCALAI_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "LOCALAI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LOCALAI_MODEL_IDS",
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
      throw new Error("Missing LocalAI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "LocalAI provider refresh",
    })) as LocalAiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core LocalAI plugin", () => {
  it("registers the LocalAI provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "LOCALAI_BASE_URL",
      "LOCALAI_API_KEY",
      "LOCALAI_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "localai",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "localai",
        source: "env",
        value: "LOCALAI_API_KEY",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadLocalAiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "localai" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "localai",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "http://localhost:8080/v1",
          configurationMissing: true,
          id: "default",
          label: "LocalAI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "LOCALAI_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured LocalAI model configurations", async () => {
    const { configurations, runtime } = await loadLocalAiConfigurations({
      api_key: "test-token",
      base_url: "http://127.0.0.1:8081/v1/",
      model_ids: ["qwen2.5-coder", "bad model id", "deepseek-r1-distill"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "http://127.0.0.1:8081/v1",
          configurationMissing: false,
          label: "LocalAI",
          models: [
            {
              api: "openai-completions",
              compat: {
                maxTokensField: "max_tokens",
                supportsDeveloperRole: false,
                supportsReasoningEffort: false,
                supportsStore: false,
              },
              contextWindow: 32768,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "qwen2.5-coder",
              input: ["text"],
              maxTokens: 4096,
              name: "Qwen2 5 Coder",
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
              contextWindow: 32768,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "deepseek-r1-distill",
              input: ["text"],
              maxTokens: 4096,
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

  it("normalizes LocalAI settings defensively", () => {
    expect(normalizeLocalAiBaseUrl(null)).toBe("http://localhost:8080/v1");
    expect(normalizeLocalAiBaseUrl("http://localhost:8080")).toBe(
      "http://localhost:8080/v1",
    );
    expect(normalizeLocalAiBaseUrl("http://127.0.0.1:8081/v1/")).toBe(
      "http://127.0.0.1:8081/v1",
    );
    expect(normalizeLocalAiBaseUrl("https://localhost:8443/v1")).toBe(
      "https://localhost:8443/v1",
    );
    expect(normalizeLocalAiBaseUrl("http://192.168.1.2:8080/v1")).toBeNull();
    expect(normalizeLocalAiBaseUrl("http://localhost:8080/custom")).toBeNull();
    expect(normalizeLocalAiModelId("models/qwen2.5-coder.gguf")).toBe(
      "models/qwen2.5-coder.gguf",
    );
    expect(normalizeLocalAiModelId("bad id")).toBeNull();
    expect(
      normalizeLocalAiModels([
        "models/qwen2.5-coder.gguf",
        "models/qwen2.5-coder.gguf",
        "bad model",
        "openai/gpt-oss-20b",
      ]),
    ).toEqual([
      {
        contextWindow: 32768,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "models/qwen2.5-coder.gguf",
        input: ["text"],
        maxTokens: 4096,
        name: "Models Qwen2 5 Coder",
        reasoning: false,
      },
      {
        contextWindow: 32768,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "openai/gpt-oss-20b",
        input: ["text"],
        maxTokens: 4096,
        name: "Openai GPT Oss 20b",
        reasoning: true,
      },
    ]);
  });
});
