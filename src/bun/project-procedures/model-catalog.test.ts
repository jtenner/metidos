/**
 * @file src/bun/project-procedures/model-catalog.test.ts
 * @description Tests for Pi/plugin model catalog ownership.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildModelCatalog,
  codexModelApiId,
  codexModelProvider,
  invalidateModelCatalogState,
  resolveCodexModel,
  resolveRunnableCodexModel,
  setActiveBuiltInModelProviderSource,
  setPluginModelProviderCatalogSource,
} from "./model-catalog";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function writePiModelsJson(
  appDataDir: string,
  name = "Stale DeepSeek V4 Pro",
): void {
  const agentDirectory = join(appDataDir, "pi-agent");
  mkdirSync(agentDirectory, { recursive: true });
  writeFileSync(
    join(agentDirectory, "models.json"),
    JSON.stringify({
      providers: {
        openrouter: {
          api: "openai-completions",
          apiKey: "stale-openrouter",
          authHeader: true,
          baseUrl: "https://openrouter.ai/api/v1",
          models: [
            {
              contextWindow: 128_000,
              id: "deepseek/deepseek-v4-pro",
              name,
            },
          ],
        },
      },
    }),
  );
}

afterEach(() => {
  setPluginModelProviderCatalogSource(null);
  setActiveBuiltInModelProviderSource(null);
  invalidateModelCatalogState();
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

describe("model catalog plugin provider ownership", () => {
  it("hides built-in providers that do not have an active provider plugin", () => {
    const appDataDir = createTempDirectory("metidos-model-catalog-active-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    const agentDirectory = join(appDataDir, "pi-agent");
    mkdirSync(agentDirectory, { recursive: true });
    writeFileSync(
      join(agentDirectory, "models.json"),
      JSON.stringify({
        providers: {
          openai: {
            api: "openai-completions",
            apiKey: "openai-key",
            authHeader: true,
            baseUrl: "https://api.openai.com/v1",
            models: [
              { contextWindow: 128_000, id: "gpt-test", name: "GPT Test" },
            ],
          },
          openrouter: {
            api: "openai-completions",
            apiKey: "openrouter-key",
            authHeader: true,
            baseUrl: "https://openrouter.ai/api/v1",
            models: [
              {
                contextWindow: 128_000,
                id: "deepseek/deepseek-v4-pro",
                name: "DeepSeek V4 Pro",
              },
            ],
          },
        },
      }),
    );
    setActiveBuiltInModelProviderSource(() => ["openai"]);

    const catalog = buildModelCatalog();

    expect(catalog.models.some((model) => model.providerId === "openai")).toBe(
      true,
    );
    expect(
      catalog.models.some((model) => model.providerId === "openrouter"),
    ).toBe(false);
  });

  it("lets a plugin refresh a built-in provider in place when it reuses the provider id", () => {
    const appDataDir = createTempDirectory("metidos-model-catalog-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    writePiModelsJson(appDataDir);
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-openrouter",
          authHeader: true,
          baseUrl: "https://openrouter.ai/api/v1",
          models: [
            {
              contextWindow: 256_000,
              id: "deepseek/deepseek-v4-pro",
              input: ["text"],
              maxTokens: 16_384,
              name: "DeepSeek V4 Pro",
              reasoning: true,
            },
          ],
        },
        configurationId: "default",
        configurationLabel: "OpenRouter",
        directoryName: "openrouter",
        executeHandle: null,
        pluginId: "openrouter",
        pluginName: "OpenRouter",
        providerId: "openrouter",
        providerName: "OpenRouter",
        refreshError: null,
        timeoutMs: 30_000,
      },
    ]);

    const catalog = buildModelCatalog();

    expect(
      catalog.models.some(
        (model) =>
          model.id === "openrouter/openrouter/default/deepseek/deepseek-v4-pro",
      ),
    ).toBe(false);
    expect(
      catalog.models.find(
        (model) => model.id === "openrouter:deepseek/deepseek-v4-pro",
      ),
    ).toEqual(
      expect.objectContaining({
        label: "DeepSeek V4 Pro",
        providerId: "openrouter",
      }),
    );
    expect(resolveCodexModel("openrouter:deepseek/deepseek-v4-pro")).toBe(
      "openrouter:deepseek/deepseek-v4-pro",
    );
    expect(codexModelProvider("openrouter:deepseek/deepseek-v4-pro")).toBe(
      "openrouter",
    );
    expect(codexModelApiId("openrouter:deepseek/deepseek-v4-pro")).toBe(
      "deepseek/deepseek-v4-pro",
    );
  });

  it("suppresses Pi's built-in provider rows when a built-in provider refresh returns no models", () => {
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          authHeader: true,
          baseUrl: "https://openrouter.ai/api/v1",
          models: [],
        },
        configurationId: "default",
        configurationLabel: "OpenRouter",
        directoryName: "openrouter",
        executeHandle: null,
        pluginId: "openrouter",
        pluginName: "OpenRouter",
        providerId: "openrouter",
        providerName: "OpenRouter",
        refreshError: "No models",
        timeoutMs: 30_000,
      },
    ]);

    const catalog = buildModelCatalog();
    const openRouterModels = catalog.models.filter(
      (model) => model.providerId === "openrouter",
    );

    expect(openRouterModels).toEqual([
      expect.objectContaining({
        isPlaceholder: true,
        label: "No models",
        providerAvailabilityNote: "No models",
        providerAvailable: false,
      }),
    ]);
  });

  it("exposes Pi thinking-level metadata for Codex models", () => {
    const appDataDir = createTempDirectory(
      "metidos-model-catalog-codex-roles-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    setActiveBuiltInModelProviderSource(() => ["openai-codex"]);

    const catalog = buildModelCatalog();

    expect(
      catalog.models.find((model) => model.id === "openai-codex:gpt-5.4"),
    ).toEqual(
      expect.objectContaining({
        supportedReasoningEfforts: [
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
        ],
      }),
    );
    expect(
      catalog.models.find(
        (model) => model.id === "openai-codex:gpt-5.1-codex-mini",
      ),
    ).toEqual(
      expect.objectContaining({
        supportedReasoningEfforts: ["minimal", "low", "medium", "high"],
      }),
    );
  });

  it("keeps startup catalog hydration non-fatal when no providers are active", () => {
    const appDataDir = createTempDirectory("metidos-model-catalog-empty-");
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    setActiveBuiltInModelProviderSource(() => []);

    const catalog = buildModelCatalog();

    expect(catalog.models).toEqual([
      expect.objectContaining({
        id: "openai-codex:gpt-5.4",
        modelId: "gpt-5.4",
        providerAvailable: false,
        providerId: "openai-codex",
      }),
    ]);
    expect(catalog.defaultModel).toBe("openai-codex:gpt-5.4");
    expect(() => resolveRunnableCodexModel(null)).toThrow(
      "No model providers are active.",
    );
  });

  it("registers every refreshed OpenRouter plugin model over the built-in catalog", () => {
    const appDataDir = createTempDirectory(
      "metidos-model-catalog-openrouter-count-",
    );
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    writePiModelsJson(appDataDir);
    const openRouterModels = Array.from({ length: 371 }, (_value, index) => ({
      contextWindow: 128_000,
      id: `openrouter-live-${index}`,
      input: ["text"] as const,
      maxTokens: 16_384,
      name: `OpenRouter Live ${index}`,
      reasoning: false,
    }));
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-openrouter",
          authHeader: true,
          baseUrl: "https://openrouter.ai/api/v1",
          models: openRouterModels,
        },
        configurationId: "default",
        configurationLabel: "OpenRouter",
        directoryName: "openrouter",
        executeHandle: null,
        pluginId: "openrouter",
        pluginName: "OpenRouter",
        providerId: "openrouter",
        providerName: "OpenRouter",
        refreshError: null,
        timeoutMs: 120_000,
      },
    ]);

    const catalog = buildModelCatalog();
    const openRouterCatalogModels = catalog.models.filter(
      (model) => model.providerId === "openrouter" && !model.isPlaceholder,
    );

    expect(openRouterCatalogModels).toHaveLength(371);
    expect(
      openRouterCatalogModels.some(
        (model) => model.modelId === "openrouter-live-370",
      ),
    ).toBe(true);
  });

  it("does not duplicate matching plugin provider labels or model ids", () => {
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-nvidia-build",
          authHeader: true,
          baseUrl: "https://integrate.api.nvidia.com/v1",
          models: [
            {
              contextWindow: 128_000,
              id: "nvidia/nemotron-test",
              input: ["text"] as const,
              maxTokens: 16_384,
              name: "Nemotron Test",
              reasoning: false,
            },
            {
              contextWindow: 128_000,
              id: "nvidia/nemotron-test",
              input: ["text"] as const,
              maxTokens: 16_384,
              name: "Nemotron Test Duplicate",
              reasoning: false,
            },
          ],
        },
        configurationId: "default",
        configurationLabel: "Build NVIDIA",
        directoryName: "nvidia_build",
        executeHandle: null,
        pluginId: "nvidia_build",
        pluginName: "Build NVIDIA",
        providerId: "nvidia_build",
        providerName: "Build NVIDIA",
        refreshError: null,
        timeoutMs: 30_000,
      },
    ]);

    const catalog = buildModelCatalog();

    const nvidiaModels = catalog.models.filter(
      (model) =>
        model.id === "nvidia_build/nvidia_build/default/nvidia/nemotron-test",
    );
    expect(nvidiaModels).toHaveLength(1);
    expect(nvidiaModels[0]).toEqual(
      expect.objectContaining({
        label: "Nemotron Test",
        providerLabel: "Build NVIDIA",
      }),
    );
  });

  it("removes plugin models when the provider refresh no longer returns them", () => {
    setActiveBuiltInModelProviderSource(() => []);
    let models: Array<{
      contextWindow: number;
      id: string;
      input: ["text"];
      maxTokens: number;
      name: string;
      reasoning: boolean;
    }> = [
      {
        contextWindow: 128_000,
        id: "nvidia/nemotron-test",
        input: ["text"],
        maxTokens: 16_384,
        name: "Nemotron Test",
        reasoning: false,
      },
    ];
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-nvidia-build",
          authHeader: true,
          baseUrl: "https://integrate.api.nvidia.com/v1",
          models,
        },
        configurationId: "default",
        configurationLabel: "Build NVIDIA",
        directoryName: "nvidia_build",
        executeHandle: null,
        pluginId: "nvidia_build",
        pluginName: "Build NVIDIA",
        providerId: "nvidia_build",
        providerName: "Build NVIDIA",
        refreshError: null,
        timeoutMs: 30_000,
      },
    ]);

    expect(
      buildModelCatalog().models.some(
        (model) =>
          model.id === "nvidia_build/nvidia_build/default/nvidia/nemotron-test",
      ),
    ).toBe(true);

    models = [];
    invalidateModelCatalogState();

    const refreshedCatalog = buildModelCatalog();
    expect(
      refreshedCatalog.models.some(
        (model) =>
          model.id === "nvidia_build/nvidia_build/default/nvidia/nemotron-test",
      ),
    ).toBe(false);
    expect(refreshedCatalog.models).toEqual([
      expect.objectContaining({
        isPlaceholder: true,
        label: "No models",
        providerId: "nvidia_build/nvidia_build/default",
      }),
    ]);
  });

  it("marks embedding-capable plugin models in the public catalog", () => {
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-ollama",
          authHeader: true,
          baseUrl: "http://localhost:11434/v1",
          models: [
            {
              compat: { providesEmbeddings: true },
              contextWindow: 128_000,
              id: "nomic-embed-text-v2-moe:latest",
              input: ["text"] as const,
              maxTokens: 8192,
              name: "nomic-embed-text-v2-moe:latest",
              reasoning: false,
            },
          ],
        },
        configurationId: "default",
        configurationLabel: "Ollama",
        directoryName: "ollama",
        embedHandle: "modelProvider:embed:1",
        executeHandle: null,
        pluginId: "ollama",
        pluginName: "Ollama",
        providerId: "ollama",
        providerName: "Ollama",
        providesEmbeddings: true,
        refreshError: null,
        timeoutMs: 30_000,
      },
    ]);

    const catalog = buildModelCatalog();

    expect(
      catalog.models.find(
        (model) =>
          model.id === "ollama/ollama/default/nomic-embed-text-v2-moe:latest",
      ),
    ).toEqual(
      expect.objectContaining({
        providerId: "ollama/ollama/default",
        supportsEmbeddings: true,
      }),
    );
  });

  it("registers refreshed xAI plugin models over the built-in catalog", () => {
    const liveXaiModels = [
      "grok-3",
      "grok-3-mini",
      "grok-4-0709",
      "grok-4-1-fast-non-reasoning",
      "grok-4-1-fast-reasoning",
      "grok-4-fast-non-reasoning",
      "grok-4-fast-reasoning",
      "grok-4.20-0309-non-reasoning",
      "grok-4.20-0309-reasoning",
      "grok-4.20-multi-agent-0309",
      "grok-4.3",
      "grok-code-fast-1",
    ].map((id) => ({
      contextWindow: 256_000,
      id,
      input: ["text"] as const,
      maxTokens: 64_000,
      name: id,
      reasoning: false,
    }));
    setPluginModelProviderCatalogSource(() => [
      {
        configuration: {
          api: "openai-completions",
          apiKey: "plugin-xai",
          authHeader: true,
          baseUrl: "https://api.x.ai/v1",
          models: liveXaiModels,
        },
        configurationId: "default",
        configurationLabel: "xAI",
        directoryName: "xai",
        executeHandle: null,
        pluginId: "xai",
        pluginName: "xAI",
        providerId: "xai",
        providerName: "xAI",
        refreshError: null,
        timeoutMs: 30_000,
      },
    ]);

    const catalog = buildModelCatalog();
    const xaiCatalogModels = catalog.models.filter(
      (model) => model.providerId === "xai" && !model.isPlaceholder,
    );

    expect(xaiCatalogModels).toHaveLength(liveXaiModels.length);
    expect(xaiCatalogModels.some((model) => model.modelId === "grok-4.3")).toBe(
      true,
    );
    expect(xaiCatalogModels.some((model) => model.modelId === "grok-2")).toBe(
      false,
    );
  });

  it("reloads cached model entries when getModelCatalogProcedure refreshes", async () => {
    const refreshableModelId =
      "refresh-openrouter/custom-provider/default/refreshable-model";
    const pluginRegistration = {
      configuration: {
        api: "openai-completions",
        apiKey: "plugin-openrouter-refresh",
        authHeader: true,
        baseUrl: "https://openrouter.ai/api/v1",
        models: [
          {
            contextWindow: 128_000,
            id: "refreshable-model",
            input: ["text"] as const,
            maxTokens: 16_384,
            name: "Stale Refreshable Model",
            reasoning: false,
          },
        ],
      },
      configurationId: "default",
      configurationLabel: "OpenRouter",
      directoryName: "refresh-openrouter",
      executeHandle: null,
      pluginId: "refresh-openrouter",
      pluginName: "Refresh OpenRouter",
      providerId: "custom-provider",
      providerName: "OpenRouter",
      refreshError: null,
      timeoutMs: 30_000,
    };
    setPluginModelProviderCatalogSource(() => [pluginRegistration]);

    const initialCatalog = buildModelCatalog();
    expect(
      initialCatalog.models.find((model) => model.id === refreshableModelId)
        ?.label,
    ).toBe("Stale Refreshable Model");

    const [refreshableModel] = pluginRegistration.configuration.models;
    expect(refreshableModel).toBeDefined();
    if (!refreshableModel) {
      throw new Error(
        "Expected plugin registration to include a refreshable model.",
      );
    }
    refreshableModel.name = "Fresh Refreshable Model";

    const cachedCatalog = buildModelCatalog();
    expect(
      cachedCatalog.models.find((model) => model.id === refreshableModelId)
        ?.label,
    ).toBe("Stale Refreshable Model");

    const { getModelCatalogProcedure } = await import("./model-catalog");
    const refreshedCatalog = await getModelCatalogProcedure(
      { refresh: true },
      {
        auth: {
          isAdmin: false,
          sessionId: "session",
          userId: 1,
          username: "tester",
        },
        priority: "foreground",
        signal: new AbortController().signal,
        timeoutMs: null,
      },
    );
    expect(
      refreshedCatalog.models.find((model) => model.id === refreshableModelId)
        ?.label,
    ).toBe("Fresh Refreshable Model");
  });
});
