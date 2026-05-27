/**
 * @file src/bun/plugin/cohere-core-plugin.test.ts
 * @description Regression coverage for the first-party Cohere provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeCohereModel } from "../../../core_plugins/cohere";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const COHERE_PLUGIN_ROOT = join("core_plugins", "cohere");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type CohereConfiguration = {
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
  const manifestPath = join(COHERE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Cohere plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadCohereConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: COHERE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "COHERE_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.cohere.ai/v1/models"],
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
      throw new Error("Missing Cohere provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Cohere model provider refresh",
    })) as CohereConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Cohere plugin", () => {
  it("registers the Cohere provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.cohere.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "COHERE_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadCohereConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "cohere",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "cohere",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.cohere.ai/compatibility/v1",
          id: "default",
          label: "Cohere",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "COHERE_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Cohere model metadata and excludes non-chat models", () => {
    expect(
      normalizeCohereModel({
        context_length: 256000,
        endpoints: ["chat"],
        name: "command-a-03-2025",
      }),
    ).toEqual({
      contextWindow: 256000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "command-a-03-2025",
      input: ["text"],
      maxTokens: 8192,
      name: "command-a-03-2025",
      reasoning: false,
    });

    expect(
      normalizeCohereModel({
        capabilities: { chat: true, vision: true },
        id: "cohere-vision-preview",
        limits: { max_context_length: 128000, max_output_tokens: 16000 },
        name: "Cohere Vision Preview",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "cohere-vision-preview",
      input: ["text", "image"],
      maxTokens: 16000,
      name: "Cohere Vision Preview",
      reasoning: false,
    });

    expect(
      normalizeCohereModel({
        endpoints: ["embed"],
        name: "embed-v4.0",
      }),
    ).toBeNull();
    expect(normalizeCohereModel({ id: "cohere-rerank" })).toBeNull();
  });
});
