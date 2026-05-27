/**
 * @file src/bun/plugin/mistral-core-plugin.test.ts
 * @description Regression coverage for the first-party Mistral AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeMistralModel } from "../../../core_plugins/mistral";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const MISTRAL_PLUGIN_ROOT = join("core_plugins", "mistral");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type MistralConfiguration = {
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
  const manifestPath = join(MISTRAL_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Mistral plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadMistralConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: MISTRAL_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "MISTRAL_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.mistral.ai/v1/models"],
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
      throw new Error("Missing Mistral provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Mistral model provider refresh",
    })) as MistralConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Mistral plugin", () => {
  it("registers the Mistral provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.mistral.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "MISTRAL_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadMistralConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "mistral",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "mistral",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.mistral.ai/v1",
          id: "default",
          label: "Mistral AI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "MISTRAL_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Mistral model metadata and excludes non-chat models", () => {
    expect(
      normalizeMistralModel({
        capabilities: { completion_chat: true, vision: false },
        id: "mistral-large-latest",
        max_context_length: 128000,
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "mistral-large-latest",
      input: ["text"],
      maxTokens: 8192,
      name: "Mistral Large Latest",
      reasoning: false,
    });

    expect(
      normalizeMistralModel({
        capabilities: { completion_chat: true, vision: true },
        id: "pixtral-large-latest",
        limits: { max_context_length: 128000, max_output_tokens: 16000 },
        name: "Pixtral Large Latest",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "pixtral-large-latest",
      input: ["text", "image"],
      maxTokens: 16000,
      name: "Pixtral Large Latest",
      reasoning: false,
    });

    expect(
      normalizeMistralModel({
        capabilities: { completion_chat: false, embeddings: true },
        id: "mistral-embed",
      }),
    ).toBeNull();
    expect(normalizeMistralModel({ id: "mistral-moderation" })).toBeNull();
  });
});
