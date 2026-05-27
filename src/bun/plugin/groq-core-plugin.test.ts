/**
 * @file src/bun/plugin/groq-core-plugin.test.ts
 * @description Regression coverage for the first-party Groq provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeGroqModel } from "../../../core_plugins/groq";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const GROQ_PLUGIN_ROOT = join("core_plugins", "groq");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type GroqConfiguration = {
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
  const manifestPath = join(GROQ_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Groq plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadGroqConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: GROQ_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "GROQ_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.groq.com/openai/v1/**"],
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
      throw new Error("Missing Groq provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Groq model provider refresh",
    })) as GroqConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Groq plugin", () => {
  it("registers the Groq provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "GROQ_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadGroqConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "groq",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "groq",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.groq.com/openai/v1",
          id: "default",
          label: "Groq",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "GROQ_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Groq model metadata and excludes non-chat models", () => {
    expect(
      normalizeGroqModel({
        context_window: 131072,
        id: "llama-3.3-70b-versatile",
        max_completion_tokens: 32768,
      }),
    ).toEqual({
      contextWindow: 131072,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "llama-3.3-70b-versatile",
      input: ["text"],
      maxTokens: 32768,
      name: "Llama 3.3 70b Versatile",
      reasoning: false,
    });

    expect(
      normalizeGroqModel({
        context_window: 131072,
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
      })?.input,
    ).toEqual(["text", "image"]);

    expect(normalizeGroqModel({ id: "whisper-large-v3" })).toBeNull();
  });
});
