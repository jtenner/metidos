/**
 * @file src/bun/plugin/sagemaker-core-plugin.test.ts
 * @description Regression coverage for the first-party Amazon SageMaker AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeSageMakerEndpointName,
  normalizeSageMakerModelId,
  normalizeSageMakerModels,
  sagemakerBaseUrl,
  sagemakerRegion,
} from "../../../core_plugins/sagemaker";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const SAGEMAKER_PLUGIN_ROOT = join("core_plugins", "sagemaker");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type SageMakerConfiguration = {
  api: string;
  apiKey: string;
  apiKeyMissing: boolean;
  authHeader: boolean;
  baseUrl: string;
  configurationMissing: boolean;
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
  const manifestPath = join(SAGEMAKER_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Amazon SageMaker AI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadSageMakerConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    bearer_token: null,
    endpoint_name: null,
    inference_component_name: null,
    model_ids: [],
    region: "us-east-1",
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: SAGEMAKER_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "SAGEMAKER_BEARER_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "AWS_BEARER_TOKEN_SAGEMAKER",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "SAGEMAKER_ENDPOINT_NAME",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "SAGEMAKER_INFERENCE_COMPONENT_NAME",
          required: false,
          secret: false,
          value: null,
        },
        {
          key: "SAGEMAKER_MODEL_IDS",
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
        "Missing Amazon SageMaker AI provider configuration handle.",
      );
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Amazon SageMaker AI provider refresh",
    })) as SageMakerConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Amazon SageMaker AI plugin", () => {
  it("registers the SageMaker provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env.map((entry) => entry.key)).toEqual([
      "SAGEMAKER_BEARER_TOKEN",
      "AWS_BEARER_TOKEN_SAGEMAKER",
      "SAGEMAKER_ENDPOINT_NAME",
      "SAGEMAKER_INFERENCE_COMPONENT_NAME",
      "SAGEMAKER_MODEL_IDS",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "sagemaker",
        source: "setting",
        value: "bearer_token",
      },
      {
        kind: "api_key",
        provider: "sagemaker",
        source: "env",
        value: "SAGEMAKER_BEARER_TOKEN",
      },
      {
        kind: "api_key",
        provider: "sagemaker",
        source: "env",
        value: "AWS_BEARER_TOKEN_SAGEMAKER",
      },
    ]);

    const { configurations, runtime, setup } =
      await loadSageMakerConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "sagemaker" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "sagemaker",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "METIDOS_SAGEMAKER_BEARER_TOKEN_NOT_CONFIGURED",
          apiKeyMissing: true,
          authHeader: true,
          baseUrl:
            "https://runtime.sagemaker.us-east-1.amazonaws.com/endpoints/example/openai/v1",
          configurationMissing: true,
          id: "default",
          label: "Amazon SageMaker AI (us-east-1)",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "bearer_token" },
            { kind: "api_key", source: "env", value: "SAGEMAKER_BEARER_TOKEN" },
            {
              kind: "api_key",
              source: "env",
              value: "AWS_BEARER_TOKEN_SAGEMAKER",
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("builds configured SageMaker endpoint model configurations", async () => {
    const { configurations, runtime } = await loadSageMakerConfigurations({
      bearer_token: "test-token",
      endpoint_name: "ProdEndpoint-1",
      inference_component_name: "ComponentA",
      model_ids: ["meta-llama/Llama-3.1-8B-Instruct", "ignored invalid id"],
      region: "us-west-2",
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "test-token",
          apiKeyMissing: false,
          authHeader: true,
          baseUrl:
            "https://runtime.sagemaker.us-west-2.amazonaws.com/endpoints/ProdEndpoint-1/inference-components/ComponentA/openai/v1",
          configurationMissing: false,
          label: "Amazon SageMaker AI (us-west-2)",
          models: [
            {
              api: "openai-completions",
              compat: {
                maxTokensField: "max_tokens",
                supportsDeveloperRole: false,
                supportsStore: false,
              },
              contextWindow: 128000,
              cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
              id: "meta-llama/Llama-3.1-8B-Instruct",
              input: ["text"],
              maxTokens: 16384,
              name: "Meta Llama Llama 3 1 8B Instruct",
              reasoning: false,
            },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes SageMaker settings defensively", () => {
    expect(sagemakerRegion("eu-west-1")).toBe("eu-west-1");
    expect(sagemakerRegion("not-a-region")).toBe("us-east-1");
    expect(normalizeSageMakerEndpointName("Endpoint-123")).toBe("Endpoint-123");
    expect(normalizeSageMakerEndpointName("-bad")).toBeNull();
    expect(normalizeSageMakerEndpointName("bad-")).toBeNull();
    expect(normalizeSageMakerEndpointName("bad_name")).toBeNull();
    expect(normalizeSageMakerModelId("Qwen/Qwen3-4B")).toBe("Qwen/Qwen3-4B");
    expect(normalizeSageMakerModelId("bad id")).toBeNull();
    expect(
      sagemakerBaseUrl({
        endpointName: "ProdEndpoint",
        region: "ap-southeast-1",
      }),
    ).toBe(
      "https://runtime.sagemaker.ap-southeast-1.amazonaws.com/endpoints/ProdEndpoint/openai/v1",
    );
    expect(
      sagemakerBaseUrl({
        endpointName: "ProdEndpoint",
        inferenceComponentName: "BlueComponent",
        region: "ap-southeast-1",
      }),
    ).toBe(
      "https://runtime.sagemaker.ap-southeast-1.amazonaws.com/endpoints/ProdEndpoint/inference-components/BlueComponent/openai/v1",
    );
    expect(
      normalizeSageMakerModels([
        "Qwen/Qwen3-4B",
        "Qwen/Qwen3-4B",
        "bad model",
        "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
      ]),
    ).toEqual([
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "Qwen/Qwen3-4B",
        input: ["text"],
        maxTokens: 16384,
        name: "Qwen Qwen3 4B",
        reasoning: false,
      },
      {
        contextWindow: 128000,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
        id: "deepseek-ai/DeepSeek-R1-Distill-Llama-8B",
        input: ["text"],
        maxTokens: 16384,
        name: "Deepseek AI DeepSeek R1 Distill Llama 8B",
        reasoning: false,
      },
    ]);
  });
});
