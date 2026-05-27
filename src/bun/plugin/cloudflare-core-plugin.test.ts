/**
 * @file src/bun/plugin/cloudflare-core-plugin.test.ts
 * @description Regression coverage for the first-party Cloudflare Workers AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cloudflareAccountId,
  firstEmbeddingFromCloudflareResponse,
  normalizeCloudflareChatModel,
  normalizeCloudflareEmbeddingModel,
} from "../../../core_plugins/cloudflare";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const CLOUDFLARE_PLUGIN_ROOT = join("core_plugins", "cloudflare");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type CloudflareConfiguration = {
  api?: string;
  authHeader?: boolean;
  baseUrl?: string;
  id: string;
  label: string;
  models: Array<{
    api?: string;
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
  const manifestPath = join(CLOUDFLARE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Cloudflare plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadCloudflareConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    account_id: "abc123",
    api_token: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: CLOUDFLARE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "CLOUDFLARE_ACCOUNT_ID",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "CLOUDFLARE_API_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://api.cloudflare.com/client/v4/accounts/*/ai/models/search",
          "https://api.cloudflare.com/client/v4/accounts/*/ai/v1/embeddings",
        ],
        enforceHttps: true,
      },
      permissions: [
        "network:fetch",
        "provider:register",
        "metidos:provides_embeddings",
        "log:write",
      ],
      settings: { missingRequiredKeys: [], values: settings },
    },
    startupTimeoutMs: 1_000,
  });

  try {
    const setup = runtime.setupResult as RuntimeSetup;
    const handle = setup.modelProviders[0]?.getProviderConfigurationsHandle;
    if (!handle) {
      throw new Error("Missing Cloudflare provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Cloudflare model provider refresh",
    })) as CloudflareConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Cloudflare Workers AI plugin", () => {
  it("registers the Cloudflare providers and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "metidos:provides_embeddings",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: [
          "https://api.cloudflare.com/client/v4/accounts/*/ai/models/search",
          "https://api.cloudflare.com/client/v4/accounts/*/ai/v1/embeddings",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "CLOUDFLARE_ACCOUNT_ID", secret: false }),
      expect.objectContaining({ key: "CLOUDFLARE_API_TOKEN", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadCloudflareConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([
        { hasEmbed: false, id: "cloudflare" },
        { hasEmbed: true, id: "cloudflare_embeddings" },
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "cloudflare",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
          id: "abc123",
          label: "Cloudflare Workers AI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_token" },
            { kind: "api_key", source: "env", value: "CLOUDFLARE_API_TOKEN" },
          ],
        }),
      ]);

      const embeddingsHandle =
        setup.modelProviders[1]?.getProviderConfigurationsHandle;
      if (!embeddingsHandle) {
        throw new Error("Missing Cloudflare embeddings configuration handle.");
      }
      const embeddingConfigurations = (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle: embeddingsHandle,
        label: "Cloudflare embeddings provider refresh",
      })) as CloudflareConfiguration[];
      expect(embeddingConfigurations).toEqual([
        expect.objectContaining({
          id: "abc123",
          label: "Cloudflare Workers AI Embeddings",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_token" },
            { kind: "api_key", source: "env", value: "CLOUDFLARE_API_TOKEN" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("returns no provider configurations until account id is configured", async () => {
    const { configurations, runtime } = await loadCloudflareConfigurations({
      account_id: null,
      api_token: null,
    });
    try {
      expect(configurations).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Cloudflare chat model metadata and excludes non-chat models", () => {
    expect(
      normalizeCloudflareChatModel({
        id: "@cf/meta/llama-3.1-8b-instruct",
        name: "Llama 3.1 8B Instruct",
        properties: [
          { property_id: "context_window", value: "128,000" },
          { name: "max output tokens", value: 8192 },
        ],
        task: { id: "text-generation", name: "Text Generation" },
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "@cf/meta/llama-3.1-8b-instruct",
      input: ["text"],
      maxTokens: 8192,
      name: "Llama 3.1 8B Instruct",
      reasoning: false,
    });

    expect(
      normalizeCloudflareChatModel({
        context_length: 32768,
        id: "@cf/llava-hf/llava-1.5-7b-hf",
        max_output_tokens: 4096,
        task: "Text Generation",
      }),
    ).toEqual({
      contextWindow: 32768,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "@cf/llava-hf/llava-1.5-7b-hf",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Llava 1.5 7b Hf",
      reasoning: false,
    });

    expect(
      normalizeCloudflareChatModel({
        id: "@cf/baai/bge-base-en-v1.5",
        task: { name: "Text Embeddings" },
      }),
    ).toBeNull();
    expect(
      normalizeCloudflareChatModel({
        id: "@cf/bytedance/stable-diffusion-xl-lightning",
        task: "Text-to-Image",
      }),
    ).toBeNull();
  });

  it("normalizes Cloudflare embedding model metadata", () => {
    expect(
      normalizeCloudflareEmbeddingModel({
        id: "@cf/baai/bge-large-en-v1.5",
        name: "BGE Large EN v1.5",
        pricing: { input: "0.0001" },
        task: { id: "text-embeddings", name: "Text Embeddings" },
      }),
    ).toEqual({
      contextWindow: 8192,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0.0001, output: 0 },
      id: "@cf/baai/bge-large-en-v1.5",
      input: ["text"],
      maxTokens: 8192,
      name: "BGE Large EN v1.5",
      reasoning: false,
    });
    expect(
      normalizeCloudflareEmbeddingModel({
        id: "@cf/meta/llama-3.1-8b-instruct",
        task: "Text Generation",
      }),
    ).toBeNull();
  });

  it("extracts finite vectors from Cloudflare embedding responses", () => {
    expect(
      firstEmbeddingFromCloudflareResponse({
        data: [{ embedding: [0.125, -0.25, 1] }],
      }),
    ).toEqual([0.125, -0.25, 1]);
    expect(
      firstEmbeddingFromCloudflareResponse({ result: { data: [[0.5, 1.5]] } }),
    ).toEqual([0.5, 1.5]);
    expect(() =>
      firstEmbeddingFromCloudflareResponse({
        data: [{ embedding: [Number.NaN] }],
      }),
    ).toThrow("non-finite");
  });

  it("validates account ids before constructing account-scoped URLs", () => {
    expect(cloudflareAccountId("abc_123-xyz")).toBe("abc_123-xyz");
    expect(cloudflareAccountId("../escape")).toBeNull();
    expect(cloudflareAccountId("")).toBeNull();
  });
});
