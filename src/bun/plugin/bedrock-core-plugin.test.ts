/**
 * @file src/bun/plugin/bedrock-core-plugin.test.ts
 * @description Regression coverage for the first-party Amazon Bedrock provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BEDROCK_MODEL_DISCOVERY_URLS,
  bedrockBaseUrl,
  bedrockRegion,
  normalizeBedrockModel,
} from "../../../core_plugins/bedrock";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const BEDROCK_PLUGIN_ROOT = join("core_plugins", "bedrock");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type BedrockConfiguration = {
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
  const manifestPath = join(BEDROCK_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Amazon Bedrock plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadBedrockConfigurations(
  settings: Record<string, string | null> = {
    api_key: null,
    region: "us-east-1",
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: BEDROCK_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "BEDROCK_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "AWS_BEARER_TOKEN_BEDROCK",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: BEDROCK_MODEL_DISCOVERY_URLS,
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
      throw new Error("Missing Amazon Bedrock provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Amazon Bedrock model provider refresh",
    })) as BedrockConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Amazon Bedrock plugin", () => {
  it("registers the Amazon Bedrock provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: BEDROCK_MODEL_DISCOVERY_URLS,
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "BEDROCK_API_KEY", secret: true }),
      expect.objectContaining({
        key: "AWS_BEARER_TOKEN_BEDROCK",
        secret: true,
      }),
    ]);

    const { configurations, runtime, setup } =
      await loadBedrockConfigurations();

    try {
      expect(setup.modelProviders.map((provider) => provider.id)).toEqual([
        "bedrock",
      ]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "bedrock",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://bedrock-mantle.us-east-1.api.aws/v1",
          id: "us-east-1",
          label: "Amazon Bedrock (us-east-1)",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "BEDROCK_API_KEY" },
            {
              kind: "api_key",
              source: "env",
              value: "AWS_BEARER_TOKEN_BEDROCK",
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes configured regions to fixed Bedrock endpoints", async () => {
    expect(bedrockRegion("eu-central-1")).toBe("eu-central-1");
    expect(bedrockRegion("not-a-region")).toBe("us-east-1");
    expect(bedrockBaseUrl("eu-central-1")).toBe(
      "https://bedrock-mantle.eu-central-1.api.aws/v1",
    );

    const { configurations, runtime } = await loadBedrockConfigurations({
      api_key: null,
      region: "eu-central-1",
    });

    try {
      expect(configurations[0]).toEqual(
        expect.objectContaining({
          baseUrl: "https://bedrock-mantle.eu-central-1.api.aws/v1",
          id: "eu-central-1",
          label: "Amazon Bedrock (eu-central-1)",
        }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Bedrock model metadata and excludes non-chat models", () => {
    expect(
      normalizeBedrockModel({
        created: 1710000000,
        id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
        object: "model",
        owned_by: "anthropic",
      }),
    ).toEqual({
      contextWindow: 128000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      input: ["text"],
      maxTokens: 8192,
      name: "Claude 3 5 Sonnet 20241022 V2 0",
      reasoning: false,
    });

    expect(
      normalizeBedrockModel({
        context_window: 300000,
        endpoints: ["chat-completions"],
        id: "amazon.nova-pro-v1:0",
        max_output_tokens: 10000,
        name: "Amazon Nova Pro",
        object: "model",
        status: "active",
        supported_features: ["text+image->text"],
      }),
    ).toEqual({
      contextWindow: 300000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "amazon.nova-pro-v1:0",
      input: ["text", "image"],
      maxTokens: 10000,
      name: "Amazon Nova Pro",
      reasoning: false,
    });

    expect(
      normalizeBedrockModel({
        endpoints: ["embeddings"],
        id: "amazon.titan-embed-text-v2:0",
      }),
    ).toBeNull();
    expect(
      normalizeBedrockModel({ id: "amazon.titan-image-generator-v2:0" }),
    ).toBeNull();
    expect(
      normalizeBedrockModel({
        id: "anthropic.claude-3-haiku-20240307-v1:0",
        object: "model",
        status: "disabled",
      }),
    ).toBeNull();
  });
});
