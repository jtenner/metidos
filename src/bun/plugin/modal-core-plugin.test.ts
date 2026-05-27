/**
 * @file src/bun/plugin/modal-core-plugin.test.ts
 * @description Regression coverage for the first-party Modal provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeModalBaseUrl,
  normalizeModalModelId,
  normalizeModalModels,
} from "../../../core_plugins/modal";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const MODAL_PLUGIN_ROOT = join("core_plugins", "modal");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type ModalConfiguration = {
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
  const manifestPath = join(MODAL_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Modal plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadModalConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: null,
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: MODAL_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "MODAL_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "MODAL_BEARER_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "MODAL_MODEL_IDS",
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
      throw new Error("Missing Modal provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Modal provider refresh",
    })) as ModalConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Modal plugin", () => {
  it("registers the Modal provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "MODAL_BASE_URL",
      "MODAL_BEARER_TOKEN",
      "MODAL_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "modal",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "modal",
        source: "env",
        value: "MODAL_BEARER_TOKEN",
      },
    ]);

    const { configurations, runtime, setup } = await loadModalConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "modal" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "modal",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl:
            "https://workspace--example-vllm-inference-serve.modal.run/v1",
          configurationMissing: true,
          id: "default",
          label: "Modal OpenAI-Compatible Endpoint",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "MODAL_BEARER_TOKEN" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured Modal model configurations", async () => {
    const { configurations, runtime } = await loadModalConfigurations({
      api_key: "test-token",
      base_url: "https://team--example-vllm-inference-serve.modal.run/",
      model_ids: [
        "meta-llama/Llama-3.3-70B-Instruct",
        "bad model id",
        "gpt-oss-120b",
      ],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "https://team--example-vllm-inference-serve.modal.run/v1",
          configurationMissing: false,
          label: "Modal OpenAI-Compatible Endpoint",
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
              id: "meta-llama/Llama-3.3-70B-Instruct",
              input: ["text"],
              maxTokens: 8192,
              name: "Llama 3 3 70B Instruct",
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
              id: "gpt-oss-120b",
              input: ["text"],
              maxTokens: 8192,
              name: "GPT Oss 120B",
              reasoning: true,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Modal settings defensively", () => {
    expect(normalizeModalBaseUrl(null)).toBeNull();
    expect(normalizeModalBaseUrl("https://team--app-serve.modal.run")).toBe(
      "https://team--app-serve.modal.run/v1",
    );
    expect(normalizeModalBaseUrl("https://team--app-serve.modal.run/v1/")).toBe(
      "https://team--app-serve.modal.run/v1",
    );
    expect(
      normalizeModalBaseUrl("https://team--app-serve.modal.run:443/v1"),
    ).toBe("https://team--app-serve.modal.run:443/v1");
    expect(
      normalizeModalBaseUrl("http://team--app-serve.modal.run/v1"),
    ).toBeNull();
    expect(normalizeModalBaseUrl("https://modal.run/v1")).toBeNull();
    expect(normalizeModalBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(
      normalizeModalBaseUrl("https://team--app-serve.modal.run/custom"),
    ).toBeNull();
    expect(
      normalizeModalBaseUrl("https://team--app-serve.modal.run/v1?token=x"),
    ).toBeNull();
    expect(normalizeModalModelId("meta-llama/Llama-3.3-70B-Instruct")).toBe(
      "meta-llama/Llama-3.3-70B-Instruct",
    );
    expect(normalizeModalModelId("bad id")).toBeNull();
    expect(
      normalizeModalModels([
        "meta-llama/Llama-3.3-70B-Instruct",
        "meta-llama/Llama-3.3-70B-Instruct",
        "bad model",
        "Qwen/QwQ-32B",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "meta-llama/Llama-3.3-70B-Instruct",
        input: ["text"],
        maxTokens: 8192,
        name: "Llama 3 3 70B Instruct",
        reasoning: false,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "Qwen/QwQ-32B",
        input: ["text"],
        maxTokens: 8192,
        name: "QwQ 32B",
        reasoning: true,
      },
    ]);
  });
});
