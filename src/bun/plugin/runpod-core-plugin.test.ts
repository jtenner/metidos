/**
 * @file src/bun/plugin/runpod-core-plugin.test.ts
 * @description Regression coverage for the first-party Runpod provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeRunpodEndpointId,
  normalizeRunpodModel,
  normalizeRunpodModels,
  runpodBaseUrl,
} from "../../../core_plugins/runpod";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const RUNPOD_PLUGIN_ROOT = join("core_plugins", "runpod");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type RunpodConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing: boolean;
  authHeader: boolean;
  baseUrl: string;
  configurationMissing: boolean;
  id: string;
  label: string;
  models: Array<{
    api: string;
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
  const manifestPath = join(RUNPOD_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Runpod plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadRunpodConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    endpoint_id: null,
    model_ids: [],
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: RUNPOD_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        { key: "RUNPOD_API_KEY", required: false, secret: true, value: null },
        {
          key: "RUNPOD_ENDPOINT_ID",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "RUNPOD_MODEL_IDS",
          required: false,
          secret: false,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.runpod.ai/v2/**/openai/v1/models"],
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
      throw new Error("Missing Runpod provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Runpod provider refresh",
    })) as RunpodConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Runpod plugin", () => {
  it("registers the Runpod provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.runpod.ai/v2/**/openai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "RUNPOD_API_KEY", secret: true }),
        expect.objectContaining({ key: "RUNPOD_ENDPOINT_ID", secret: false }),
        expect.objectContaining({ key: "RUNPOD_MODEL_IDS", secret: false }),
      ]),
    );

    const { configurations, runtime, setup } = await loadRunpodConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "runpod" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "runpod",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "METIDOS_RUNPOD_API_KEY_NOT_CONFIGURED",
          apiKeyMissing: true,
          authHeader: true,
          baseUrl: "https://api.runpod.ai/v2/example/openai/v1",
          configurationMissing: true,
          id: "default",
          label: "Runpod",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "RUNPOD_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds a configured Runpod endpoint catalog without discovery when no API key is present", async () => {
    const { configurations, runtime } = await loadRunpodConfigurations({
      api_key: null,
      endpoint_id: "abc123def456",
      model_ids: ["meta-llama/Llama-3.3-70B-Instruct", "qwen/qwq-32b"],
    });

    try {
      expect(configurations[0]).toEqual(
        expect.objectContaining({
          apiKeyMissing: true,
          baseUrl: "https://api.runpod.ai/v2/abc123def456/openai/v1",
          configurationMissing: false,
          label: "Runpod (abc123def456)",
        }),
      );
      expect(configurations[0]?.models).toMatchObject([
        {
          api: "openai-completions",
          id: "meta-llama/Llama-3.3-70B-Instruct",
          name: "Llama 3 3 70B Instruct",
          reasoning: false,
        },
        {
          id: "qwen/qwq-32b",
          name: "Qwq 32B",
          reasoning: true,
        },
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Runpod model discovery metadata defensively", () => {
    expect(
      normalizeRunpodModel({
        capabilities: { chat: true },
        id: "meta-llama/Llama-3.3-70B-Instruct",
        metadata: { context_length: 131072 },
        name: "Llama 3.3 70B Instruct",
        object: "model",
        supported_features: ["reasoning"],
        max_output_tokens: 32768,
      }),
    ).toEqual({
      contextWindow: 131072,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta-llama/Llama-3.3-70B-Instruct",
      input: ["text"],
      maxTokens: 32768,
      name: "Llama 3.3 70B Instruct",
      reasoning: true,
    });

    expect(normalizeRunpodModel({ id: "text-embedding-model" })).toBeNull();
    expect(
      normalizeRunpodModel({ id: "chat-model", object: "deployment" }),
    ).toBeNull();
    expect(
      normalizeRunpodModel({
        capabilities: { chat: false },
        id: "non-chat-model",
      }),
    ).toBeNull();
  });

  it("normalizes endpoint IDs, base URLs, and fallback model IDs", () => {
    expect(normalizeRunpodEndpointId("abc123def456")).toBe("abc123def456");
    expect(normalizeRunpodEndpointId("bad/path")).toBeNull();
    expect(normalizeRunpodEndpointId("-bad")).toBeNull();
    expect(runpodBaseUrl("abc123def456")).toBe(
      "https://api.runpod.ai/v2/abc123def456/openai/v1",
    );
    expect(
      normalizeRunpodModels([
        "meta-llama/Llama-3.3-70B-Instruct",
        " ",
        "meta-llama/Llama-3.3-70B-Instruct",
        "deepseek-r1",
      ]).map((model) => ({ id: model.id, reasoning: model.reasoning })),
    ).toEqual([
      { id: "meta-llama/Llama-3.3-70B-Instruct", reasoning: false },
      { id: "deepseek-r1", reasoning: true },
    ]);
  });
});
