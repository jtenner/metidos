/**
 * @file src/bun/plugin/stepfun-core-plugin.test.ts
 * @description Regression coverage for the first-party StepFun provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { normalizeStepFunModel } from "../../../core_plugins/stepfun";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const STEPFUN_PLUGIN_ROOT = join("core_plugins", "stepfun");

type ModelProviderRegistration = {
  embedHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type StepFunConfiguration = {
  api: string;
  authHeader: boolean;
  baseUrl: string;
  id: string;
  label: string;
  models: Array<{
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
  const manifestPath = join(STEPFUN_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected StepFun plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadStepFunConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: STEPFUN_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "STEPFUN_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
        {
          key: "STEP_API_KEY",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: ["https://api.stepfun.ai/v1/models"],
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
      throw new Error("Missing StepFun provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "StepFun provider refresh",
    })) as StepFunConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core StepFun plugin", () => {
  it("registers the StepFun provider and auth handoff", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: ["https://api.stepfun.ai/v1/models"],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "STEPFUN_API_KEY", secret: true }),
      expect.objectContaining({ key: "STEP_API_KEY", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadStepFunConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, id: "stepfun" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "stepfun",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://api.stepfun.ai/v1",
          id: "default",
          label: "StepFun",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "api_key" },
            { kind: "api_key", source: "env", value: "STEPFUN_API_KEY" },
            { kind: "api_key", source: "env", value: "STEP_API_KEY" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes StepFun chat model metadata", () => {
    expect(
      normalizeStepFunModel({
        id: "step-3.5-flash",
        object: "model",
        owned_by: "stepfun",
      }),
    ).toEqual({
      contextWindow: 256000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "step-3.5-flash",
      input: ["text", "image"],
      maxTokens: 4096,
      name: "Step 3 5 Flash",
      reasoning: true,
    });

    expect(
      normalizeStepFunModel({
        context_window: 32000,
        id: "step-1o-turbo-vision",
        max_output_tokens: 8192,
        name: "Step 1o Turbo Vision",
        supported_input_modalities: ["text", "image"],
        supported_output_modalities: ["text"],
      }),
    ).toEqual({
      contextWindow: 32000,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "step-1o-turbo-vision",
      input: ["text", "image"],
      maxTokens: 8192,
      name: "Step 1o Turbo Vision",
      reasoning: false,
    });
  });

  it("filters non-chat StepFun model metadata defensively", () => {
    expect(normalizeStepFunModel({ id: "step-tts-2-mini" })).toBeNull();
    expect(normalizeStepFunModel({ id: "step-asr" })).toBeNull();
    expect(normalizeStepFunModel({ id: "step-embedding" })).toBeNull();
    expect(
      normalizeStepFunModel({
        id: "step-image-edit-v1",
        supported_output_modalities: ["image"],
      }),
    ).toBeNull();
    expect(normalizeStepFunModel({ id: " ", object: "model" })).toBeNull();
    expect(
      normalizeStepFunModel({ id: "step-chat", status: "disabled" }),
    ).toBeNull();
  });
});
