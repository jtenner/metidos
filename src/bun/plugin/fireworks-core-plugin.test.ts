/**
 * @file src/bun/plugin/fireworks-core-plugin.test.ts
 * @description Regression coverage for the first-party Fireworks AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeFireworksModel } from "../../../core_plugins/fireworks";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const FIREWORKS_PLUGIN_ROOT = join("core_plugins", "fireworks");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type FireworksConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    contextWindow: number;
    id: string;
    input: string[];
    maxTokens: number;
    name: string;
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(FIREWORKS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Fireworks plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadFireworksConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: FIREWORKS_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "FIREWORKS_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.fireworks.ai/inference/v1/models"],
        enforceHttps: true,
      },
      permissions: ["network:fetch", "provider:register", "log:write"],
      settings: { missingRequiredKeys: [], values: { api_key: null } },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Fireworks provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Fireworks model provider refresh",
    })) as FireworksConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Fireworks plugin", () => {
  it("registers the Fireworks provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.fireworks.ai/inference/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "FIREWORKS_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadFireworksConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "fireworks",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "fireworks",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.fireworks.ai/inference/v1",
          id: "default",
          label: "Fireworks AI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "FIREWORKS_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Fireworks model metadata and excludes non-chat models", () => {
    expect(
      normalizeFireworksModel({
        capabilities: { completion_chat: true, vision: false },
        id: "accounts/fireworks/models/llama-v3p1-405b-instruct",
        max_context_length: 128000,
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "accounts/fireworks/models/llama-v3p1-405b-instruct",
      input: ["text"],
      maxTokens: 8192,
      name: "Fireworks Llama V3p1 405b Instruct",
      reasoning: false,
    });

    expect(
      normalizeFireworksModel({
        capabilities: { completion_chat: true, vision: true },
        id: "accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
        limits: { max_context_length: 128000, max_output_tokens: 16000 },
        name: "Llama 3.2 11B Vision Instruct",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
      input: ["text", "image"],
      maxTokens: 16000,
      name: "Llama 3.2 11B Vision Instruct",
      reasoning: false,
    });

    expect(
      normalizeFireworksModel({
        capabilities: { completion_chat: false, embeddings: true },
        id: "fireworks-embed",
      }),
    ).toBeNull();
    expect(normalizeFireworksModel({ id: "fireworks-moderation" })).toBeNull();
  });
});
