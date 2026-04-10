/**
 * @file src/bun/project-procedures/ollama-provider-config.ts
 * @description Ollama provider config helpers backed by Pi models.json.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Api, Model } from "@mariozechner/pi-ai";
import { ModelRegistry } from "@mariozechner/pi-coding-agent";

import { getAppDataDirectoryPath } from "../db";
import { createPiAuthStorage } from "../pi-codex-auth";
import type { RpcOllamaProviderConfig } from "../rpc-schema";

const PI_AGENT_DIRECTORY_NAME = "pi-agent";
const MODELS_JSON_FILE_NAME = "models.json";
const OLLAMA_DEFAULT_API_KEY = "ollama";
export const OLLAMA_PROVIDER_ID = "ollama";

type ModelsJsonRoot = Record<string, unknown> & {
  providers?: Record<string, unknown>;
};

type ModelsJsonReadResult = {
  parseError: string | null;
  root: ModelsJsonRoot;
};

type OllamaSaveInput = {
  apiKey: string;
  url: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), {
    mode: 0o700,
    recursive: true,
  });
}

function writeJsonRecord(path: string, record: unknown): void {
  ensureParentDirectory(path);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
  chmodSync(path, 0o600);
}

function toDisplayError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

export function buildPiModelsJsonPath(appDataDir?: string): string {
  return join(
    typeof appDataDir === "string"
      ? getAppDataDirectoryPath({
          appDataDir,
        })
      : getAppDataDirectoryPath(),
    PI_AGENT_DIRECTORY_NAME,
    MODELS_JSON_FILE_NAME,
  );
}

function readModelsJsonRoot(modelsJsonPath: string): ModelsJsonReadResult {
  if (!existsSync(modelsJsonPath)) {
    return {
      parseError: null,
      root: {},
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(modelsJsonPath, "utf8"));
    if (!isPlainObject(parsed)) {
      return {
        parseError:
          "The Pi models config must contain a top-level JSON object.",
        root: {},
      };
    }
    return {
      parseError: null,
      root: parsed,
    };
  } catch (error) {
    return {
      parseError: `Invalid JSON: ${toDisplayError(error)}`,
      root: {},
    };
  }
}

function extractOllamaProviderConfig(
  root: ModelsJsonRoot,
): Record<string, unknown> | null {
  if (!isPlainObject(root.providers)) {
    return null;
  }
  const providerConfig = root.providers[OLLAMA_PROVIDER_ID];
  return isPlainObject(providerConfig) ? providerConfig : null;
}

function ollamaModelIds(models: Model<Api>[]): string[] {
  return models
    .filter((model) => model.provider === OLLAMA_PROVIDER_ID)
    .map((model) => model.id)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/u, "");
}

function stripOllamaDiscoverySuffix(url: string): string {
  if (url.endsWith("/v1/models")) {
    return url.slice(0, -"/v1/models".length);
  }
  if (url.endsWith("/api/tags")) {
    return url.slice(0, -"/api/tags".length);
  }
  if (url.endsWith("/v1")) {
    return url.slice(0, -"/v1".length);
  }
  if (url.endsWith("/api")) {
    return url.slice(0, -"/api".length);
  }
  return url;
}

function normalizeOllamaRootUrl(url: string): string {
  return stripOllamaDiscoverySuffix(normalizeUrl(url));
}

function providerBaseUrlFromRootUrl(rootUrl: string): string {
  const normalizedRootUrl = normalizeOllamaRootUrl(rootUrl);
  return normalizedRootUrl ? `${normalizedRootUrl}/v1` : "";
}

function uiUrlFromProviderConfig(
  providerConfig: Record<string, unknown> | null,
): string {
  const baseUrl =
    typeof providerConfig?.baseUrl === "string" ? providerConfig.baseUrl : "";
  return baseUrl ? normalizeOllamaRootUrl(baseUrl) : "";
}

function uiApiKeyFromProviderConfig(
  providerConfig: Record<string, unknown> | null,
): string {
  const apiKey =
    typeof providerConfig?.apiKey === "string" ? providerConfig.apiKey : "";
  return apiKey === OLLAMA_DEFAULT_API_KEY ? "" : apiKey;
}

function ollamaStatusNote(
  configured: boolean,
  available: boolean,
  parseError: string | null,
  registryError: string | null,
  modelIds: string[],
): string | null {
  if (available) {
    return null;
  }
  if (parseError) {
    return "Ollama is unavailable because the Pi models config file is invalid.";
  }
  if (!configured) {
    return "Ollama is not setup. Open Settings and set an Ollama URL.";
  }
  if (registryError) {
    return "Ollama is unavailable because the Pi Ollama config is invalid.";
  }
  if (modelIds.length === 0) {
    return "Ollama is configured, but no models are available.";
  }
  return "Ollama is unavailable.";
}

function buildSnapshotFromInputs(options: {
  modelsJsonPath: string;
  parsedModelsJson: ModelsJsonReadResult;
  registryError: string | null;
  registryModels: Model<Api>[];
}): RpcOllamaProviderConfig {
  const providerConfig = extractOllamaProviderConfig(
    options.parsedModelsJson.root,
  );
  const modelIds = ollamaModelIds(options.registryModels);
  const configured = providerConfig !== null;
  const available = options.registryError == null && modelIds.length > 0;
  return {
    apiKey: uiApiKeyFromProviderConfig(providerConfig),
    available,
    configured,
    configFilePath: options.modelsJsonPath,
    errorDetail: options.parsedModelsJson.parseError ?? options.registryError,
    modelIds,
    statusNote: ollamaStatusNote(
      configured,
      available,
      options.parsedModelsJson.parseError,
      options.registryError,
      modelIds,
    ),
    url: uiUrlFromProviderConfig(providerConfig),
  };
}

export function getOllamaProviderConfigSnapshot(options?: {
  modelsJsonPath?: string;
  registryError?: string | null;
  registryModels?: Model<Api>[];
}): RpcOllamaProviderConfig {
  const modelsJsonPath = options?.modelsJsonPath ?? buildPiModelsJsonPath();
  const parsedModelsJson = readModelsJsonRoot(modelsJsonPath);

  if (
    Array.isArray(options?.registryModels) &&
    Object.hasOwn(options ?? {}, "registryError")
  ) {
    return buildSnapshotFromInputs({
      modelsJsonPath,
      parsedModelsJson,
      registryError: options?.registryError ?? null,
      registryModels: options.registryModels,
    });
  }

  const agentDirectory = dirname(modelsJsonPath);
  const { authStorage } = createPiAuthStorage(agentDirectory);
  const registry = ModelRegistry.create(authStorage, modelsJsonPath);
  return buildSnapshotFromInputs({
    modelsJsonPath,
    parsedModelsJson,
    registryError: registry.getError() ?? null,
    registryModels: registry.getAll(),
  });
}

function dedupeModelIds(modelIds: string[]): string[] {
  return [
    ...new Set(modelIds.map((modelId) => modelId.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}

function parseOpenAiModelsPayload(payload: unknown): string[] {
  if (!isPlainObject(payload) || !Array.isArray(payload.data)) {
    throw new Error("Unexpected response shape from /v1/models.");
  }
  return dedupeModelIds(
    payload.data.flatMap((entry) => {
      if (!isPlainObject(entry) || typeof entry.id !== "string") {
        return [];
      }
      return [entry.id];
    }),
  );
}

function parseApiTagsPayload(payload: unknown): string[] {
  if (!isPlainObject(payload) || !Array.isArray(payload.models)) {
    throw new Error("Unexpected response shape from /api/tags.");
  }
  return dedupeModelIds(
    payload.models.flatMap((entry) => {
      if (!isPlainObject(entry)) {
        return [];
      }
      if (typeof entry.model === "string") {
        return [entry.model];
      }
      if (typeof entry.name === "string") {
        return [entry.name];
      }
      return [];
    }),
  );
}

function ollamaRequestHeaders(apiKey: string): HeadersInit | undefined {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    return undefined;
  }
  return {
    Authorization: `Bearer ${trimmedApiKey}`,
  };
}

async function fetchJson(url: string, apiKey: string): Promise<unknown> {
  const headers = ollamaRequestHeaders(apiKey);
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    throw new Error(
      `Request failed with ${response.status} ${response.statusText}`.trim(),
    );
  }
  return response.json();
}

async function discoverOllamaModels(
  url: string,
  apiKey: string,
): Promise<string[]> {
  const rootUrl = normalizeOllamaRootUrl(url);
  if (!rootUrl) {
    return [];
  }

  const attempts = [
    {
      parse: parseOpenAiModelsPayload,
      url: `${rootUrl}/v1/models`,
    },
    {
      parse: parseApiTagsPayload,
      url: `${rootUrl}/api/tags`,
    },
  ] as const;
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      const payload = await fetchJson(attempt.url, apiKey);
      const modelIds = attempt.parse(payload);
      if (modelIds.length === 0) {
        throw new Error("No models were returned.");
      }
      return modelIds;
    } catch (error) {
      errors.push(`${attempt.url}: ${toDisplayError(error)}`);
    }
  }

  throw new Error(`Unable to load Ollama models. ${errors.join(" ")}`.trim());
}

function buildOllamaProviderConfig(
  url: string,
  apiKey: string,
  modelIds: string[],
): Record<string, unknown> {
  return {
    api: "openai-completions",
    apiKey: apiKey.trim() || OLLAMA_DEFAULT_API_KEY,
    baseUrl: providerBaseUrlFromRootUrl(url),
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: modelIds.map((modelId) => ({
      id: modelId,
    })),
  };
}

function withUpdatedOllamaProvider(
  root: ModelsJsonRoot,
  providerConfig: Record<string, unknown> | null,
): ModelsJsonRoot {
  const nextRoot: ModelsJsonRoot = {
    ...root,
  };
  const nextProviders = isPlainObject(root.providers)
    ? { ...root.providers }
    : {};
  if (providerConfig) {
    nextProviders[OLLAMA_PROVIDER_ID] = providerConfig;
  } else {
    delete nextProviders[OLLAMA_PROVIDER_ID];
  }
  if (Object.keys(nextProviders).length > 0) {
    nextRoot.providers = nextProviders;
  } else {
    delete nextRoot.providers;
  }
  return nextRoot;
}

function validateCandidateModelsJson(
  root: ModelsJsonRoot,
  options?: {
    requireOllamaModels?: boolean;
  },
): void {
  const tempDirectory = mkdtempSync(join(tmpdir(), "metidos-ollama-models-"));
  const tempModelsJsonPath = join(tempDirectory, MODELS_JSON_FILE_NAME);
  try {
    writeJsonRecord(tempModelsJsonPath, root);
    const { authStorage } = createPiAuthStorage(
      join(getAppDataDirectoryPath(), PI_AGENT_DIRECTORY_NAME),
    );
    const registry = ModelRegistry.create(authStorage, tempModelsJsonPath);
    const registryError = registry.getError();
    if (registryError) {
      throw new Error(`Pi rejected the models config: ${registryError}`);
    }
    if (options?.requireOllamaModels) {
      const modelIds = ollamaModelIds(registry.getAll());
      if (modelIds.length === 0) {
        throw new Error(
          "Pi accepted the file but did not expose any Ollama models.",
        );
      }
    }
  } finally {
    rmSync(tempDirectory, {
      force: true,
      recursive: true,
    });
  }
}

function assertMergeableModelsJson(
  existing: ModelsJsonReadResult,
  modelsJsonPath: string,
): void {
  if (!existing.parseError) {
    return;
  }
  throw new Error(
    `Unable to update Ollama settings because ${modelsJsonPath} contains invalid JSON.`,
  );
}

export function getOllamaProviderConfig(): RpcOllamaProviderConfig {
  return getOllamaProviderConfigSnapshot();
}

export async function saveOllamaProviderConfig(
  input: OllamaSaveInput,
): Promise<RpcOllamaProviderConfig> {
  const normalizedUrl = normalizeOllamaRootUrl(input.url);
  const normalizedApiKey = input.apiKey.trim();
  const modelsJsonPath = buildPiModelsJsonPath();
  const existing = readModelsJsonRoot(modelsJsonPath);
  assertMergeableModelsJson(existing, modelsJsonPath);

  const nextRoot =
    normalizedUrl.length === 0
      ? withUpdatedOllamaProvider(existing.root, null)
      : withUpdatedOllamaProvider(
          existing.root,
          buildOllamaProviderConfig(
            normalizedUrl,
            normalizedApiKey,
            await discoverOllamaModels(normalizedUrl, normalizedApiKey),
          ),
        );

  validateCandidateModelsJson(nextRoot, {
    requireOllamaModels: normalizedUrl.length > 0,
  });
  writeJsonRecord(modelsJsonPath, nextRoot);
  return getOllamaProviderConfig();
}
