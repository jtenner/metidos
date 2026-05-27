/**
 * @file src/bun/plugin/writer-core-plugin.test.ts
 * @description Regression coverage for the first-party Writer provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeWriterModel } from "../../../core_plugins/writer";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const WRITER_PLUGIN_ROOT = join("core_plugins", "writer");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type WriterConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
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
  const manifestPath = join(WRITER_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Writer plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadWriterConfigurations() {
  const build = await buildPluginEntrypoint({
    pluginRoot: WRITER_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "WRITER_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.writer.com/v1/models"],
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
      throw new Error("Missing Writer provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Writer model provider refresh",
    })) as WriterConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Writer plugin", () => {
  it("registers the Writer provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.writer.com/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "WRITER_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } = await loadWriterConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "writer",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "writer",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.writer.com/v1",
          id: "default",
          label: "Writer",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "WRITER_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Writer model metadata and excludes non-chat models", () => {
    expect(
      normalizeWriterModel({
        id: "palmyra-x5",
        name: "Palmyra X5",
      }),
    ).toEqual({
      contextWindow: 1_000_000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "palmyra-x5",
      input: ["text"],
      maxTokens: 8_192,
      name: "Palmyra X5",
      reasoning: false,
    });

    expect(
      normalizeWriterModel({
        context_window: 256000,
        id: "palmyra-custom-chat",
        max_output_tokens: 16000,
      }),
    ).toEqual({
      contextWindow: 256000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "palmyra-custom-chat",
      input: ["text"],
      maxTokens: 16000,
      name: "Palmyra Custom Chat",
      reasoning: false,
    });

    expect(normalizeWriterModel({ id: "palmyra-embedding" })).toBeNull();
    expect(normalizeWriterModel({ id: "palmyra-rerank" })).toBeNull();
  });
});
