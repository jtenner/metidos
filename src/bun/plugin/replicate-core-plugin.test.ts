/**
 * @file src/bun/plugin/replicate-core-plugin.test.ts
 * @description Regression coverage for the first-party Replicate provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildPredictionInput,
  contextToPrompt,
  normalizeReplicateModel,
  predictionOutputText,
} from "../../../core_plugins/replicate";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const REPLICATE_PLUGIN_ROOT = join("core_plugins", "replicate");

type ModelProviderRegistration = {
  embedHandle?: string;
  executeHandle?: string;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type ReplicateConfiguration = {
  api: string;
  id: string;
  label: string;
  models: Array<{
    compat: Record<string, unknown>;
    id: string;
    input: string[];
    name: string;
  }>;
};

function manifest(): RpcPluginInventoryPlugin["manifest"] {
  const manifestPath = join(REPLICATE_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Replicate plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadReplicateConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    api_key: null,
  },
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: REPLICATE_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "REPLICATE_API_TOKEN",
          required: false,
          secret: true,
          value: null,
        },
      ],
      network: {
        allow: [
          "https://api.replicate.com/v1/models",
          "https://api.replicate.com/v1/models/**/predictions",
        ],
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
      throw new Error("Missing Replicate provider configuration handle.");
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Replicate provider refresh",
    })) as ReplicateConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Replicate plugin", () => {
  it("registers the Replicate provider and fixed network allowlist", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual([
      "network:fetch",
      "provider:register",
      "log:write",
    ]);
    expect(parsedManifest.network).toEqual(
      expect.objectContaining({
        allow: [
          "https://api.replicate.com/v1/models",
          "https://api.replicate.com/v1/models/**/predictions",
        ],
        enforceHttps: true,
      }),
    );
    expect(parsedManifest.env).toEqual([
      expect.objectContaining({ key: "REPLICATE_API_TOKEN", secret: true }),
    ]);

    const { configurations, runtime, setup } =
      await loadReplicateConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          hasExecute: typeof provider.executeHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, hasExecute: true, id: "replicate" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "replicate",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "replicate-predictions",
          id: "default",
          label: "Replicate",
          models: [],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("requires credentials before executing Replicate predictions", async () => {
    const { runtime, setup } = await loadReplicateConfigurations();
    try {
      const handle = setup.modelProviders[0]?.executeHandle;
      expect(handle).toBe("modelProvider:execute:2");
      await expect(
        runtime.invokeCallback({
          args: [
            { contextKind: "providerExecution" },
            {
              model: {
                compat: {
                  replicate: {
                    model: "llama-3",
                    owner: "meta",
                    promptField: "prompt",
                  },
                },
              },
              modelContext: { messages: [{ role: "user", content: "Hello" }] },
            },
          ],
          deadlineMs: Date.now() + 1_000,
          handle: handle ?? "missing",
          label: "Replicate provider execute",
        }),
      ).rejects.toThrow(
        "Replicate execution requires an api_key Plugin Setting or REPLICATE_API_TOKEN.",
      );
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Replicate text-generation model metadata defensively", () => {
    expect(
      normalizeReplicateModel({
        owner: "meta",
        name: "meta-llama-3-70b-instruct",
        description: "Meta Llama 3 70B Instruct",
        latest_version: {
          openapi_schema: {
            title: "Meta Llama 3 70B Instruct",
            components: {
              schemas: {
                Input: {
                  properties: {
                    max_new_tokens: {
                      default: 1024,
                      maximum: 4096,
                      type: "integer",
                    },
                    prompt: { title: "Prompt", type: "string" },
                    system_prompt: { title: "System Prompt", type: "string" },
                    temperature: { default: 0.75, type: "number" },
                  },
                },
                Output: {
                  items: { type: "string" },
                  title: "Output",
                  type: "array",
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      compat: {
        replicate: {
          maxTokensField: "max_new_tokens",
          model: "meta-llama-3-70b-instruct",
          owner: "meta",
          promptField: "prompt",
          systemField: "system_prompt",
          temperatureField: "temperature",
        },
      },
      contextWindow: 8192,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
      id: "meta/meta-llama-3-70b-instruct",
      input: ["text"],
      maxTokens: 4096,
      name: "Meta Llama 3 70B Instruct",
      reasoning: false,
    });

    expect(
      normalizeReplicateModel({
        id: "owner/text-model",
        openapi_schema: {
          components: {
            schemas: {
              Input: { properties: { prompt: { type: "string" } } },
              Output: { type: "string" },
            },
          },
        },
      })?.id,
    ).toBe("owner/text-model");
  });

  it("filters non-text Replicate schemas", () => {
    expect(
      normalizeReplicateModel({
        id: "owner/image-model",
        latest_version: {
          openapi_schema: {
            components: {
              schemas: {
                Input: {
                  properties: {
                    image: { type: "string" },
                    prompt: { type: "string" },
                  },
                },
                Output: { format: "uri", type: "string" },
              },
            },
          },
        },
      }),
    ).toBeNull();
    expect(
      normalizeReplicateModel({
        id: "owner/no-prompt",
        latest_version: {
          openapi_schema: {
            components: {
              schemas: {
                Input: { properties: { text: { type: "string" } } },
                Output: { type: "string" },
              },
            },
          },
        },
      })?.compat.replicate.promptField,
    ).toBe("text");
  });

  it("serializes Pi context and parses Replicate prediction output", () => {
    const prompt = contextToPrompt({
      systemPrompt: "Be concise.",
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [{ type: "text", text: "Hi!" }],
        },
        {
          role: "toolResult",
          toolName: "lookup",
          content: [{ type: "text", text: "42" }],
        },
      ],
    });
    expect(prompt).toContain("System: Be concise.");
    expect(prompt).toContain("User: Hello");
    expect(prompt).toContain("Assistant: Hi!");
    expect(prompt).toContain("Tool lookup: 42");
    expect(prompt.endsWith("Assistant:")).toBe(true);

    expect(
      buildPredictionInput({
        model: {
          compat: {
            replicate: {
              maxTokensField: "max_new_tokens",
              model: "llama-3",
              owner: "meta",
              promptField: "prompt",
              systemField: "system_prompt",
              temperatureField: "temperature",
            },
          },
          maxTokens: 512,
        },
        modelContext: { messages: [{ role: "user", content: "Hello" }] },
        options: { maxTokens: 128, temperature: 0.2 },
      }),
    ).toEqual({
      input: {
        max_new_tokens: 128,
        prompt: "User: Hello\n\nAssistant:",
        temperature: 0.2,
      },
      model: "llama-3",
      owner: "meta",
    });

    expect(predictionOutputText(["Hel", "lo"])).toBe("Hello");
    expect(predictionOutputText({ generated_text: "Hello" })).toBe("Hello");
  });
});
