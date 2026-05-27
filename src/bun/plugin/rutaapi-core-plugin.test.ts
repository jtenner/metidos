/**
 * @file src/bun/plugin/rutaapi-core-plugin.test.ts
 * @description Regression coverage for the first-party RutaAPI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeRutaApiModel } from "../../../core_plugins/rutaapi";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const RUTAAPI_PLUGIN_ROOT = join("core_plugins", "rutaapi");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type RutaApiConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
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
  const manifestPath = join(RUTAAPI_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected RutaAPI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadRutaApiConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: RUTAAPI_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "RUTAAPI_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.rutaapi.com/v1/models"],
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
      throw new Error("Missing RutaAPI provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "RutaAPI provider refresh",
    })) as RutaApiConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core RutaAPI plugin", () => {
  it("registers the RutaAPI provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.rutaapi.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "RUTAAPI_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadRutaApiConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "rutaapi" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "rutaapi",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.rutaapi.com/v1",
          id: "default",
          label: "RutaAPI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "RUTAAPI_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes RutaAPI chat model metadata", () => {
    expect(
      normalizeRutaApiModel({
        capabilities: { chat: true },
        display_name: "GPT OSS 120B",
        id: "openai/gpt-oss-120b",
        object: "model",
        pricing: {
          cache_read: 0.05,
          cache_write: 0.1,
          completion: 0.4,
          prompt: 0.1,
        },
        supported_features: ["tools", "reasoning"],
        supported_input_modalities: ["text", "image"],
        supported_output_modalities: ["text"],
        limits: {
          max_context_length: 131072,
        },
        max_output_tokens: 32768,
      }),
    ).toEqual({
      contextWindow: 131072,
      cost: { cacheRead: 0.05, cacheWrite: 0.1, input: 0.1, output: 0.4 },
      id: "openai/gpt-oss-120b",
      input: ["text", "image"],
      maxTokens: 32768,
      name: "GPT OSS 120B",
      reasoning: true,
    });

    expect(
      normalizeRutaApiModel({
        id: "anthropic/claude-sonnet-4",
        object: "model",
      }),
    ).toEqual({
      contextWindow: 16384,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "anthropic/claude-sonnet-4",
      input: ["text"],
      maxTokens: 4096,
      name: "Claude Sonnet 4",
      reasoning: false,
    });
  });

  it("filters non-chat RutaAPI model metadata defensively", () => {
    expect(normalizeRutaApiModel({ id: "text-embedding-3-large" })).toBeNull();
    expect(
      normalizeRutaApiModel({
        id: "black-forest-labs/flux-dev",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizeRutaApiModel({ id: " ", object: "model" })).toBeNull();
    expect(
      normalizeRutaApiModel({ id: "chat-model", status: "disabled" }),
    ).toBeNull();
  });
});
