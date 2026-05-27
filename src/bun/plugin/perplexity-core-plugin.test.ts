/**
 * @file src/bun/plugin/perplexity-core-plugin.test.ts
 * @description Regression coverage for the first-party Perplexity provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizePerplexityModel } from "../../../core_plugins/perplexity";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const PERPLEXITY_PLUGIN_ROOT = join("core_plugins", "perplexity");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type PerplexityConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
    compat?: Record<string, unknown>;
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
  const manifestPath = join(PERPLEXITY_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Perplexity plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadPerplexityConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: PERPLEXITY_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "PERPLEXITY_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.perplexity.ai/v1/models"],
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
      throw new Error("Missing Perplexity provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Perplexity provider refresh",
    })) as PerplexityConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Perplexity plugin", () => {
  it("registers the Perplexity provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.perplexity.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "PERPLEXITY_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadPerplexityConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "perplexity" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "perplexity",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.perplexity.ai",
          id: "default",
          label: "Perplexity",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "PERPLEXITY_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Perplexity Sonar model metadata", () => {
    expect(
      normalizePerplexityModel({
        id: "perplexity/sonar-pro",
        limits: { max_output_tokens: 12000 },
        max_input_tokens: 200000,
        object: "model",
        supported_input_modalities: ["text"],
        supported_output_modalities: ["text"],
      }),
    ).toEqual({
      contextWindow: 200000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "sonar-pro",
      input: ["text"],
      maxTokens: 12000,
      name: "Sonar Pro",
      reasoning: false,
    });

    expect(
      normalizePerplexityModel({
        display_name: "Sonar Deep Research",
        id: "sonar-deep-research",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "sonar-deep-research",
      input: ["text"],
      maxTokens: 8192,
      name: "Sonar Deep Research",
      reasoning: false,
    });

    expect(normalizePerplexityModel({ id: "openai/gpt-4.1" })).toBeNull();
    expect(normalizePerplexityModel({ id: "sonar-embedding" })).toBeNull();
    expect(
      normalizePerplexityModel({
        id: "sonar-image",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizePerplexityModel({ id: " " })).toBeNull();
  });
});
