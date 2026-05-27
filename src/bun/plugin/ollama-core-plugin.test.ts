/**
 * @file src/bun/plugin/ollama-core-plugin.test.ts
 * @description Regression coverage for first-party Ollama model discovery.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import { buildPluginEntrypoint } from "./entrypoint-build";
import { startPluginQuickJsRuntime } from "./quickjs-runtime";

const testServers: Array<ReturnType<typeof Bun.serve>> = [];

function coreOllamaPluginPath(): string {
  return join(process.cwd(), "core_plugins", "ollama");
}

function pluginApiForOllamaTest(baseUrl: string) {
  return {
    env: [
      { key: "OLLAMA_BASE_URL", required: false, secret: false, value: null },
      { key: "OLLAMA_API_KEY", required: false, secret: true, value: null },
    ],
    network: { allow: [`${baseUrl}/**`], enforceHttps: false },
    permissions: ["network:fetch", "provider:register", "log:write"],
    settings: {
      missingRequiredKeys: [],
      values: { api_key: "test-token", base_url: baseUrl },
    },
    unsafeAllowPrivateNetwork: true,
  };
}

afterEach(() => {
  for (const server of testServers.splice(0)) {
    server.stop(true);
  }
});

async function refreshCoreOllamaProvider(baseUrl: string) {
  const buildResult = await buildPluginEntrypoint({
    pluginRoot: coreOllamaPluginPath(),
  });
  const runtime = await startPluginQuickJsRuntime(buildResult, {
    pluginApi: pluginApiForOllamaTest(baseUrl),
    startupTimeoutMs: 1_000,
  });
  try {
    const setupResult = runtime.setupResult as {
      modelProviders: Array<{ getProviderConfigurationsHandle: string }>;
    };
    return {
      configurations: (await runtime.invokeCallback({
        args: [],
        deadlineMs: Date.now() + 1_000,
        handle:
          setupResult.modelProviders[0]?.getProviderConfigurationsHandle ??
          "missing",
        label: "Ollama model provider refresh",
      })) as Array<{ models: Array<{ id: string; name: string }> }>,
      runtime,
    };
  } catch (error) {
    runtime.dispose();
    throw error;
  }
}

describe("core Ollama plugin", () => {
  it("discovers locally available Ollama tags before the OpenAI-compatible model endpoint", async () => {
    const requests: Array<{ authorization: string | null; path: string }> = [];
    const server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);
        requests.push({
          authorization: request.headers.get("authorization"),
          path: url.pathname,
        });
        if (url.pathname === "/api/tags") {
          return Response.json({
            models: [
              {
                model: "nomic-embed-text-v2-moe:latest",
                name: "nomic-embed-text-v2-moe:latest",
              },
              { model: "n27/gemma-4-26B-A4B-it-UD-Q4_K_M-32k:latest" },
              { name: "MedAIBase/MedGemma1.5:4b-it-q8_0" },
              { model: "gemma4:latest", name: "gemma4:latest" },
            ],
          });
        }
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "stale-openai-list" }] });
        }
        return new Response("not found", { status: 404 });
      },
      port: 0,
    });
    testServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const { configurations, runtime } =
      await refreshCoreOllamaProvider(baseUrl);

    try {
      expect(requests).toEqual([
        { authorization: "Bearer test-token", path: "/api/tags" },
      ]);
      expect(configurations[0]?.models.map((model) => model.id)).toEqual([
        "nomic-embed-text-v2-moe:latest",
        "n27/gemma-4-26B-A4B-it-UD-Q4_K_M-32k:latest",
        "MedAIBase/MedGemma1.5:4b-it-q8_0",
        "gemma4:latest",
      ]);
    } finally {
      runtime.dispose();
    }
  });

  it("returns no phantom model when both discovery endpoints fail", async () => {
    const server = Bun.serve({
      fetch() {
        return Response.json({ error: "offline" }, { status: 503 });
      },
      port: 0,
    });
    testServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const { configurations, runtime } =
      await refreshCoreOllamaProvider(baseUrl);

    try {
      expect(configurations[0]?.models).toEqual([]);
    } finally {
      runtime.dispose();
    }
  });

  it("falls back to /v1/models for OpenAI-compatible local servers", async () => {
    const requests: string[] = [];
    const server = Bun.serve({
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url.pathname);
        if (url.pathname === "/api/tags") {
          return Response.json({ error: "unsupported" }, { status: 404 });
        }
        if (url.pathname === "/v1/models") {
          return Response.json({ data: [{ id: "local-openai-model" }] });
        }
        return new Response("not found", { status: 404 });
      },
      port: 0,
    });
    testServers.push(server);
    const baseUrl = `http://127.0.0.1:${server.port}`;
    const { configurations, runtime } =
      await refreshCoreOllamaProvider(baseUrl);

    try {
      expect(requests).toEqual(["/api/tags", "/v1/models"]);
      expect(configurations[0]?.models.map((model) => model.id)).toEqual([
        "local-openai-model",
      ]);
    } finally {
      runtime.dispose();
    }
  });
});
