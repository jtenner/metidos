/**
 * @file src/bun/plugin/vertex-core-plugin.test.ts
 * @description Regression coverage for the first-party Google Vertex AI provider plugin.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

import {
  normalizeVertexLocation,
  normalizeVertexProjectId,
  vertexOpenAiBaseUrl,
} from "../../../core_plugins/vertex";
import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import { buildPluginEntrypoint } from "./entrypoint-build";
import { registerPluginModelProviderConfigurations } from "./model-providers";
import { parsePluginManifest } from "./manifest";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";
import { validatePluginStartupRegistrations } from "./startup-registrations";

const VERTEX_PLUGIN_ROOT = join("core_plugins", "vertex");

type ModelProviderRegistration = {
  embedHandle?: string | null;
  executeHandle?: string | null;
  getProviderConfigurationsHandle: string;
  id: string;
};

type RuntimeSetup = {
  modelProviders: ModelProviderRegistration[];
};

type VertexConfiguration = {
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
    compat: { supportsStore: boolean };
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
  const manifestPath = join(VERTEX_PLUGIN_ROOT, "metidos-plugin.json");
  const result = parsePluginManifest(
    readFileSync(manifestPath, "utf8"),
    manifestPath,
  );
  expect(result.issues).toEqual([]);
  if (!result.manifest) {
    throw new Error("Expected Google Vertex AI plugin manifest to parse.");
  }
  return result.manifest as unknown as RpcPluginInventoryPlugin["manifest"];
}

async function loadVertexConfigurations(
  settings: Record<string, boolean | number | string | string[] | null> = {
    access_token: null,
    location: "global",
    project_id: null,
  },
  envOverrides: Record<string, string | null> = {},
) {
  const build = await buildPluginEntrypoint({
    pluginRoot: VERTEX_PLUGIN_ROOT,
  });
  const runtime = await startPluginQuickJsRuntime(build, {
    pluginApi: {
      env: [
        {
          key: "GOOGLE_VERTEX_ACCESS_TOKEN",
          required: false,
          secret: true,
          value: envOverrides.GOOGLE_VERTEX_ACCESS_TOKEN ?? null,
        },
        {
          key: "VERTEX_AI_ACCESS_TOKEN",
          required: false,
          secret: true,
          value: envOverrides.VERTEX_AI_ACCESS_TOKEN ?? null,
        },
        {
          key: "GOOGLE_VERTEX_PROJECT_ID",
          required: false,
          secret: false,
          value: envOverrides.GOOGLE_VERTEX_PROJECT_ID ?? null,
        },
        {
          key: "GOOGLE_VERTEX_LOCATION",
          required: false,
          secret: false,
          value: envOverrides.GOOGLE_VERTEX_LOCATION ?? null,
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
        "Missing Google Vertex AI provider configuration handle.",
      );
    }
    const configurations = (await runtime.invokeCallback({
      args: [],
      deadlineMs: Date.now() + 1_000,
      handle,
      label: "Google Vertex AI provider refresh",
    })) as VertexConfiguration[];
    return { configurations, runtime, setup };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Google Vertex AI plugin", () => {
  it("registers the Vertex provider and reports missing project configuration", async () => {
    const parsedManifest = manifest();
    expect(parsedManifest.permissions).toEqual(["provider:register"]);
    expect(parsedManifest.env?.map((entry) => entry.key)).toEqual([
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "VERTEX_AI_ACCESS_TOKEN",
      "GOOGLE_VERTEX_PROJECT_ID",
      "GOOGLE_VERTEX_LOCATION",
    ]);
    expect(parsedManifest.piAuth).toEqual([
      {
        kind: "api_key",
        provider: "vertex",
        source: "setting",
        value: "access_token",
      },
      {
        kind: "api_key",
        provider: "vertex",
        source: "env",
        value: "GOOGLE_VERTEX_ACCESS_TOKEN",
      },
      {
        kind: "api_key",
        provider: "vertex",
        source: "env",
        value: "VERTEX_AI_ACCESS_TOKEN",
      },
    ]);

    const { configurations, runtime, setup } = await loadVertexConfigurations();

    try {
      expect(
        setup.modelProviders.map((provider) => ({
          hasEmbed: typeof provider.embedHandle === "string",
          hasExecute: typeof provider.executeHandle === "string",
          id: provider.id,
        })),
      ).toEqual([{ hasEmbed: false, hasExecute: false, id: "vertex" }]);
      expect(() =>
        validatePluginStartupRegistrations(setup, {
          manifest: parsedManifest,
          pluginId: "vertex",
        } as RpcPluginInventoryPlugin),
      ).not.toThrow();
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKeyMissing: true,
          authHeader: true,
          baseUrl:
            "https://aiplatform.googleapis.com/v1/projects/example-project/locations/global/endpoints/openapi",
          configurationMissing: true,
          id: "default",
          label: "Google Vertex AI",
          models: [],
          piAuth: [
            { kind: "api_key", source: "setting", value: "access_token" },
            {
              kind: "api_key",
              source: "env",
              value: "GOOGLE_VERTEX_ACCESS_TOKEN",
            },
            { kind: "api_key", source: "env", value: "VERTEX_AI_ACCESS_TOKEN" },
          ],
        }),
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("exposes a static Vertex Gemini chat catalog when configured", async () => {
    const { configurations, runtime } = await loadVertexConfigurations({
      access_token: "configured-token",
      location: "us-central1",
      project_id: "metidos-test-project",
    });

    try {
      expect(configurations).toEqual([
        expect.objectContaining({
          api: "openai-completions",
          apiKey: "configured-token",
          apiKeyMissing: false,
          baseUrl:
            "https://aiplatform.googleapis.com/v1/projects/metidos-test-project/locations/us-central1/endpoints/openapi",
          configurationMissing: false,
          id: "metidos-test-project-us-central1",
          models: expect.arrayContaining([
            expect.objectContaining({
              api: "openai-completions",
              contextWindow: 1048576,
              id: "google/gemini-2.5-pro",
              input: ["text", "image"],
              maxTokens: 65536,
              name: "Gemini 2.5 Pro",
              reasoning: true,
            }),
            expect.objectContaining({
              id: "google/gemini-2.0-flash-001",
              reasoning: false,
            }),
          ]),
        }),
      ]);
      expect(configurations[0]?.models).toHaveLength(4);
      const registry = ModelRegistry.inMemory(AuthStorage.inMemory());
      registerPluginModelProviderConfigurations(registry, [
        {
          configuration: configurations[0] as unknown as Record<
            string,
            unknown
          >,
          configurationId: "metidos-test-project-us-central1",
          configurationLabel: "Google Vertex AI",
          directoryName: "vertex",
          executeHandle: null,
          pluginId: "vertex",
          pluginName: "Google Vertex AI",
          providerId: "vertex",
          providerName: "Google Vertex AI",
          refreshError: null,
          timeoutMs: 30_000,
        },
      ]);
      expect(
        registry.find(
          "vertex/vertex/metidos-test-project-us-central1",
          "google/gemini-2.5-pro",
        )?.contextWindow,
      ).toBe(1048576);
    } finally {
      runtime.dispose();
    }
  });

  it("uses declared environment fallbacks for project, location, and token", async () => {
    const { configurations, runtime } = await loadVertexConfigurations(
      {
        access_token: null,
        location: null,
        project_id: null,
      },
      {
        GOOGLE_VERTEX_ACCESS_TOKEN: "env-token",
        GOOGLE_VERTEX_LOCATION: "europe-west4",
        GOOGLE_VERTEX_PROJECT_ID: "env-project-123",
      },
    );

    try {
      expect(configurations[0]).toEqual(
        expect.objectContaining({
          apiKey: "env-token",
          baseUrl:
            "https://aiplatform.googleapis.com/v1/projects/env-project-123/locations/europe-west4/endpoints/openapi",
          configurationMissing: false,
          id: "env-project-123-europe-west4",
        }),
      );
    } finally {
      runtime.dispose();
    }
  });

  it("normalizes Vertex project ids, locations, and base URLs defensively", () => {
    expect(normalizeVertexProjectId("metidos-test-project")).toBe(
      "metidos-test-project",
    );
    expect(normalizeVertexProjectId("1bad-project")).toBeNull();
    expect(normalizeVertexProjectId("bad_project")).toBeNull();
    expect(normalizeVertexProjectId("ab")).toBeNull();
    expect(normalizeVertexLocation("global")).toBe("global");
    expect(normalizeVertexLocation("US-CENTRAL1")).toBe("us-central1");
    expect(normalizeVertexLocation("us-central1/foo")).toBeNull();
    expect(normalizeVertexLocation("https://example.test")).toBeNull();
    expect(vertexOpenAiBaseUrl("metidos-test-project", "global")).toBe(
      "https://aiplatform.googleapis.com/v1/projects/metidos-test-project/locations/global/endpoints/openapi",
    );
  });
});
