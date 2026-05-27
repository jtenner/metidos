/**
 * @file src/bun/plugin/nvidia-build-core-plugin.test.ts
 * @description Regression coverage for the first-party Build NVIDIA provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
  nvidiaBuildApiKeyValue,
  uniqueNvidiaBuildModels,
} from "../../../core_plugins/nvidia_build";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";

const NVIDIA_BUILD_PLUGIN_ROOT = join("core_plugins", "nvidia_build");

type ModelProviderRegistration = {
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type NvidiaBuildConfiguration = {
  apiKeyMissing?: boolean;
  models: Array<{ id: string; name: string }>;
};

async function loadNvidiaBuildConfigurations(input: {
  envApiKey?: string | null;
}): Promise<{
  configurations: NvidiaBuildConfiguration[];
  runtime: ReturnType<typeof startPluginQuickJsRuntime> extends Promise<infer T>
    ? T
    : never;
}> {
  const build = await buildPluginEntrypoint({
    pluginRoot: NVIDIA_BUILD_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "NVIDIA_API_KEY",
          required: false,
          secret: true,
          value: input.envApiKey ?? null,
        },
      ],
      network: {
        allow: ["https://integrate.api.nvidia.com/v1/models"],
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
      throw new Error("Missing Build NVIDIA provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Build NVIDIA model provider refresh",
    })) as NvidiaBuildConfiguration[];
    return { configurations, runtime };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Build NVIDIA plugin", () => {
  it("normalizes pasted bearer authorization values to raw NVIDIA API keys", () => {
    expect(nvidiaBuildApiKeyValue(" Bearer nvapi-test-token ")).toBe(
      "nvapi-test-token",
    );
    expect(nvidiaBuildApiKeyValue("nvapi-test-token")).toBe("nvapi-test-token");
  });

  it("deduplicates discovered models by NVIDIA model id before catalog registration", () => {
    expect(
      uniqueNvidiaBuildModels([
        { id: "nvidia/nemotron-test", name: "Nemotron Test" },
        { id: "NVIDIA/NEMOTRON-TEST", name: "Nemotron Test Duplicate" },
        { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      ]),
    ).toEqual([
      { id: "nvidia/nemotron-test", name: "Nemotron Test" },
      { id: "deepseek-ai/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    ]);
  });

  it("does not invent fallback models when discovery cannot run", async () => {
    const { configurations, runtime } = await loadNvidiaBuildConfigurations({
      envApiKey: null,
    });

    try {
      expect(configurations[0]?.apiKeyMissing).toBe(true);
      expect(configurations[0]?.models).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });
});
