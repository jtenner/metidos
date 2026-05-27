/**
 * @file src/bun/plugin/lepton-core-plugin.test.ts
 * @description Regression coverage for the first-party DGX Cloud Lepton provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeLeptonBaseUrl,
  normalizeLeptonModelId,
  normalizeLeptonModels,
} from "../../../core_plugins/lepton";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const LEPTON_PLUGIN_ROOT = join("core_plugins", "lepton");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type LeptonConfiguration = {
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
  const manifestPath = join(LEPTON_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected DGX Cloud Lepton plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadLeptonConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    base_url: null,
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: LEPTON_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "LEPTON_BASE_URL",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "LEPTON_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LEPTON_API_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "LEPTON_MODEL_IDS",
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
      throw new Error(
        "Missing DGX Cloud Lepton provider configuration handle.",
      );
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "DGX Cloud Lepton provider refresh",
    })) as LeptonConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core DGX Cloud Lepton plugin", () => {
  it("registers the Lepton provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "LEPTON_BASE_URL",
      "LEPTON_API_KEY",
      "LEPTON_API_TOKEN",
      "LEPTON_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "lepton",
        source: "setting",
        value: "api_key",
      },
      {
        kind: "api_key",
        provider: "lepton",
        source: "env",
        value: "LEPTON_API_KEY",
      },
      {
        kind: "api_key",
        provider: "lepton",
        source: "env",
        value: "LEPTON_API_TOKEN",
      },
    ]);

    const { configurations, runtime, setup } = await loadLeptonConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "lepton" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "lepton",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: false,
          baseUrl: "https://example.lepton.run/api/v1",
          configurationMissing: true,
          id: "default",
          label: "DGX Cloud Lepton",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "LEPTON_API_KEY" },
            { kind: "api_key", source: "env", value: "LEPTON_API_TOKEN" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured Lepton model configurations", async () => {
    const { configurations, runtime } = await loadLeptonConfigurations({
      api_key: "test-token",
      base_url: "https://demo.cloud.lepton.ai/api/v1/",
      model_ids: ["meta/llama-3.3-70b-instruct", "bad model id", "nemotron-r1"],
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          authHeader: true,
          baseUrl: "https://demo.cloud.lepton.ai/api/v1",
          configurationMissing: false,
          label: "DGX Cloud Lepton",
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
              id: "meta/llama-3.3-70b-instruct",
              input: ["text"],
              maxTokens: 8192,
              name: "Meta Llama 3 3 70B Instruct",
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
              id: "nemotron-r1",
              input: ["text"],
              maxTokens: 8192,
              name: "Nemotron R1",
              reasoning: true,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Lepton settings defensively", () => {
    expect(normalizeLeptonBaseUrl(null)).toBeNull();
    expect(normalizeLeptonBaseUrl("https://demo.lepton.run")).toBe(
      "https://demo.lepton.run/api/v1",
    );
    expect(normalizeLeptonBaseUrl("https://demo.lepton.run/v1/")).toBe(
      "https://demo.lepton.run/v1",
    );
    expect(normalizeLeptonBaseUrl("https://demo.cloud.lepton.ai/api/v1/")).toBe(
      "https://demo.cloud.lepton.ai/api/v1",
    );
    expect(
      normalizeLeptonBaseUrl("https://endpoint.dgxc-lepton.nvidia.com/api/v1"),
    ).toBe("https://endpoint.dgxc-lepton.nvidia.com/api/v1");
    expect(normalizeLeptonBaseUrl("http://demo.lepton.run/api/v1")).toBeNull();
    expect(normalizeLeptonBaseUrl("https://api.example.com/v1")).toBeNull();
    expect(normalizeLeptonBaseUrl("https://demo.lepton.run/custom")).toBeNull();
    expect(normalizeLeptonModelId("meta/llama-3.3-70b-instruct")).toBe(
      "meta/llama-3.3-70b-instruct",
    );
    expect(normalizeLeptonModelId("bad id")).toBeNull();
    expect(
      normalizeLeptonModels([
        "meta/llama-3.3-70b-instruct",
        "meta/llama-3.3-70b-instruct",
        "bad model",
        "nvidia/nemotron-r1",
      ]),
    ).toEqual([
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "meta/llama-3.3-70b-instruct",
        input: ["text"],
        maxTokens: 8192,
        name: "Meta Llama 3 3 70B Instruct",
        reasoning: false,
      },
      {
        contextWindow: 131072,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "nvidia/nemotron-r1",
        input: ["text"],
        maxTokens: 8192,
        name: "Nvidia Nemotron R1",
        reasoning: true,
      },
    ]);
  });
});
