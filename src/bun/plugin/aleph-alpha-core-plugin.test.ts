/**
 * @file src/bun/plugin/aleph-alpha-core-plugin.test.ts
 * @description Regression coverage for the first-party Aleph Alpha provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeAlephAlphaChatModel } from "../../../core_plugins/aleph_alpha";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const ALEPH_ALPHA_PLUGIN_ROOT = join("core_plugins", "aleph_alpha");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type AlephAlphaConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    api: string;
    compat: Record<string, unknown>;
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
  const manifestPath = join(ALEPH_ALPHA_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Aleph Alpha plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadAlephAlphaConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: ALEPH_ALPHA_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "ALEPH_ALPHA_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.aleph-alpha.com/v1/model-settings"],
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
      throw new Error("Missing Aleph Alpha provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Aleph Alpha model provider refresh",
    })) as AlephAlphaConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Aleph Alpha plugin", () => {
  it("registers the Aleph Alpha provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.aleph-alpha.com/v1/model-settings"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "ALEPH_ALPHA_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadAlephAlphaConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "aleph_alpha" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "aleph_alpha",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.aleph-alpha.com/v1",
          id: "default",
          label: "Aleph Alpha",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            {
              kind: "api_key",
              source: "env",
              value: "ALEPH_ALPHA_API_KEY",
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Aleph Alpha model-settings metadata for chat", () => {
    expect(
      normalizeAlephAlphaChatModel({
        chat: true,
        completion_type: "full",
        description: "Pharia 1 LLM 7B Control",
        max_context_size: 8192,
        multimodal: false,
        name: "pharia-1-llm-7b-control",
        status: "available",
      }),
    ).toEqual({
      api: "openai-completions",
      contextWindow: 8192,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "pharia-1-llm-7b-control",
      input: ["text"],
      maxTokens: 4096,
      name: "Pharia 1 LLM 7B Control",
      reasoning: false,
    });

    expect(
      normalizeAlephAlphaChatModel({
        chat: true,
        max_context_size: 131072,
        multimodal: true,
        name: "pharia-vision-chat",
        status: "available",
      }),
    ).toEqual(
      expect.objectContaining({
        contextWindow: 131072,
        id: "pharia-vision-chat",
        input: ["text", "image"],
        maxTokens: 4096,
        name: "Pharia Vision Chat",
      }),
    );
  });

  it("excludes unavailable and non-chat Aleph Alpha models", () => {
    expect(
      normalizeAlephAlphaChatModel({
        chat: true,
        name: "pharia-unavailable",
        status: "unavailable",
      }),
    ).toBeNull();
    expect(
      normalizeAlephAlphaChatModel({
        chat: false,
        embedding_type: "semantic",
        name: "pharia-1-embedding-4608-control",
        status: "available",
      }),
    ).toBeNull();
    expect(
      normalizeAlephAlphaChatModel({
        completion_type: "none",
        name: "pharia-rerank",
      }),
    ).toBeNull();
  });
});
