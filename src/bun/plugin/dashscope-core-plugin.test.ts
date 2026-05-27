/**
 * @file src/bun/plugin/dashscope-core-plugin.test.ts
 * @description Regression coverage for the first-party Alibaba Cloud Model Studio / DashScope provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  dashScopeBaseUrl,
  dashScopeEmbeddingModelsForRegion,
  dashScopeModelsForRegion,
  dashScopeRegion,
  firstEmbeddingFromDashScopeResponse,
} from "../../../core_plugins/dashscope";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const DASH_SCOPE_PLUGIN_ROOT = join("core_plugins", "dashscope");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type DashScopeConfiguration = {
  api?: string;
  authHeader?: boolean;
  baseUrl?: string;
  id: string;
  label: string;
  models: Array<{
    api?: string;
    compat?: Record<string, unknown>;
    contextWindow: number;
    dimensions?: number;
    id: string;
    input: string[];
    maxTokens: number;
    name: string;
    reasoning: boolean;
  }>;
  piAuth: Array<{ kind: string; source: string; value: string }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(DASH_SCOPE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected DashScope plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadDashScopeConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
    region: "international",
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: DASH_SCOPE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "DASHSCOPE_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "QWEN_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
          "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
        ],
        enforceHttps: true,
      },
      permissions: [
        "network:fetch",
        "provider:register",
        "metidos:provides_embeddings",
      ],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing DashScope provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "DashScope model provider refresh",
    })) as DashScopeConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core DashScope plugin", () => {
  it("registers the DashScope providers and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "metidos:provides_embeddings",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: [
          "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
          "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
          "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "DASHSCOPE_API_KEY", secret: true }),
      expect.objectContaining({ key: "QWEN_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadDashScopeConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "dashscope" },
        { hasEmbed: true, id: "dashscope_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "dashscope",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKeyMissing: true,
          authHeader: true,
          baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
          id: "international",
          label: "Alibaba Cloud Model Studio (international)",
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "DASHSCOPE_API_KEY" },
            { kind: "api_key", source: "env", value: "QWEN_API_KEY" },
          ],
        }),
      ]);
      expect(configurations[0]?.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "qwen3-max",
            input: ["text"],
            name: "Qwen3-Max",
            reasoning: true,
          }),
          expect.objectContaining({
            id: "qwen3.5-plus",
            input: ["text", "image"],
          }),
        ]),
      );

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing DashScope embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "DashScope embeddings provider refresh",
      })) as DashScopeConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "international",
          label: "Alibaba Cloud Model Studio Embeddings (international)",
          models: [
            expect.objectContaining({
              api: "embeddings",
              compat: { providesEmbeddings: true },
              dimensions: 1024,
              id: "text-embedding-v4",
              input: ["text"],
              name: "Text Embedding V4",
              reasoning: false,
            }),
          ],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "DASHSCOPE_API_KEY" },
            { kind: "api_key", source: "env", value: "QWEN_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("maps fixed regional endpoints and catalogs", () => {
    expect(dashScopeRegion("us")).toBe("us");
    expect(dashScopeRegion("unknown")).toBe("international");
    expect(dashScopeBaseUrl("china")).toBe(
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(dashScopeBaseUrl("hong_kong")).toBe(
      "https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1",
    );
    expect(dashScopeModelsForRegion("us").map((model) => model.id)).toEqual([
      "qwen-plus-us",
      "qwen-flash-us",
    ]);
    expect(
      dashScopeEmbeddingModelsForRegion("international").map(
        (model) => model.id,
      ),
    ).toEqual(["text-embedding-v4"]);
    expect(dashScopeEmbeddingModelsForRegion("us")).toEqual([]);
  });

  it("uses the configured US endpoint and omits unsupported embeddings", async () => {
    const { configurations, runtime, setup } =
      await loadDashScopeConfigurations({
        api_key: null,
        region: "us",
      });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1",
          id: "us",
        }),
      ]);
      expect(configurations[0]?.models.map((model) => model.id)).toEqual([
        "qwen-plus-us",
        "qwen-flash-us",
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing DashScope embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "DashScope embeddings provider refresh",
      })) as DashScopeConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({ id: "us", models: [] }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("extracts finite vectors from DashScope embedding responses", () => {
    expect(
      firstEmbeddingFromDashScopeResponse({
        data: [{ embedding: [0.125, -0.25, 1] }],
      }),
    ).toEqual([0.125, -0.25, 1]);
    expect(() =>
      firstEmbeddingFromDashScopeResponse({
        data: [{ embedding: [Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });
});
