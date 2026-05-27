/**
 * @file src/bun/plugin/github-models-core-plugin.test.ts
 * @description Regression coverage for the first-party GitHub Models provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeGitHubModelsModel } from "../../../core_plugins/github_models";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const GITHUB_MODELS_PLUGIN_ROOT = join("core_plugins", "github_models");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type GitHubModelsConfiguration = {
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
  const manifestPath = join(GITHUB_MODELS_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected GitHub Models plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadGitHubModelsConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: GITHUB_MODELS_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "GITHUB_MODELS_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "GITHUB_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://models.github.ai/catalog/models"],
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
      throw new Error("Missing GitHub Models provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "GitHub Models provider refresh",
    })) as GitHubModelsConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core GitHub Models plugin", () => {
  it("registers the GitHub Models provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://models.github.ai/catalog/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "GITHUB_MODELS_TOKEN", secret: true }),
      expect.objectContaining({ key: "GITHUB_TOKEN", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadGitHubModelsConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "github_models" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "github_models",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://models.github.ai/inference",
          id: "default",
          label: "GitHub Models",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "GITHUB_MODELS_TOKEN" },
            { kind: "api_key", source: "env", value: "GITHUB_TOKEN" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes GitHub Models catalog metadata", () => {
    expect(
      normalizeGitHubModelsModel({
        display_name: "GPT-4.1",
        id: "openai/gpt-4.1",
        limits: { max_output_tokens: 32768 },
        max_input_tokens: 1047576,
        supported_input_modalities: ["text", "image"],
        supported_output_modalities: ["text"],
      }),
    ).toEqual({
      contextWindow: 1047576,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "openai/gpt-4.1",
      input: ["text", "image"],
      maxTokens: 32768,
      name: "GPT-4.1",
      reasoning: false,
    });

    expect(
      normalizeGitHubModelsModel({
        id: "cohere/embed-v4",
        supported_output_modalities: ["embedding"],
      }),
    ).toBeNull();
    expect(
      normalizeGitHubModelsModel({
        id: "black-forest-labs/flux-dev",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizeGitHubModelsModel({ id: " " })).toBeNull();
  });
});
