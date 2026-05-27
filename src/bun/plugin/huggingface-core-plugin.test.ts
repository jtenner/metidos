/**
 * @file src/bun/plugin/huggingface-core-plugin.test.ts
 * @description Regression coverage for the first-party Hugging Face Inference Providers plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeHuggingFaceModel } from "../../../core_plugins/huggingface";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const HUGGINGFACE_PLUGIN_ROOT = join("core_plugins", "huggingface");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type HuggingFaceConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    compat?: Record<string, unknown>;
    contextWindow: number;
    cost: { input: number; output: number };
    id: string;
    input: string[];
    maxTokens: number;
    name: string;
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(HUGGINGFACE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Hugging Face plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadHuggingFaceConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: HUGGINGFACE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "HF_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "HUGGINGFACE_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://router.huggingface.co/v1/models"],
        enforceHttps: true,
      },
      permissions: ["network:fetch", "provider:register", "log:write"],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Hugging Face provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Hugging Face provider refresh",
    })) as HuggingFaceConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Hugging Face plugin", () => {
  it("registers the Hugging Face provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://router.huggingface.co/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "HF_TOKEN", secret: true }),
      expect.objectContaining({ key: "HUGGINGFACE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadHuggingFaceConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "huggingface" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "huggingface",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://router.huggingface.co/v1",
          id: "default",
          label: "Hugging Face Inference Providers",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "HF_TOKEN" },
            {
              kind: "api_key",
              source: "env",
              value: "HUGGINGFACE_API_KEY",
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Hugging Face router model metadata", () => {
    expect(
      normalizeHuggingFaceModel({
        architecture: {
          input_modalities: ["text", "image"],
          output_modalities: ["text"],
        },
        id: "google/gemma-4-31B-it",
        object: "model",
        providers: [
          {
            context_length: 262144,
            pricing: { input: 0.39, output: 0.97 },
            provider: "together",
            status: "live",
          },
          {
            context_length: 1048576,
            pricing: { input: 0.5, output: 1.5 },
            provider: "deepinfra",
            status: "live",
          },
        ],
      }),
    ).toEqual({
      contextWindow: 1048576,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0.39, output: 0.97 },
      id: "google/gemma-4-31B-it",
      input: ["text", "image"],
      maxTokens: 8192,
      name: "Gemma 4 31B It",
      reasoning: false,
    });

    expect(
      normalizeHuggingFaceModel({
        architecture: { output_modalities: ["embedding"] },
        id: "BAAI/bge-large-en-v1.5",
        object: "model",
        providers: [{ provider: "hf-inference", status: "live" }],
      }),
    ).toBeNull();
    expect(
      normalizeHuggingFaceModel({
        architecture: { output_modalities: ["image"] },
        id: "black-forest-labs/flux-dev",
        object: "model",
        providers: [{ provider: "fal-ai", status: "live" }],
      }),
    ).toBeNull();
    expect(
      normalizeHuggingFaceModel({
        architecture: { output_modalities: ["text"] },
        id: "stale/model",
        object: "model",
        providers: [{ provider: "example", status: "error" }],
      }),
    ).toBeNull();
  });
});
