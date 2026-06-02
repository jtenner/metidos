/**
 * @file src/bun/pi/builtin-provider-settings.ts
 * @description Bridges Metidos provider settings into Pi's built-in auth storage.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AuthStorage as PiAuthStorage,
  OAuthCredential,
} from "@mariozechner/pi-coding-agent";

import type { AppDataPathOptions } from "../db";
import { getPluginsDirectoryPath } from "../plugin/discovery";
import {
  type PluginRuntimeSettings,
  readPluginSettingsForRuntime,
} from "../plugin/settings";
import type { RpcPluginManifestSettingSummary } from "../rpc-schema";

export type PiAuthPluginBinding = {
  directoryName: string;
  envValues: ReadonlyMap<string, string | null>;
  settings: RpcPluginManifestSettingSummary[];
  kind: "api_key" | "codex_auth" | "pi_oauth_file";
  providerId: string;
  source: "env" | "setting";
  value: string;
};

type CodexCliAuthJson = {
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
  } | null;
};

type RuntimeSettingsScope = PluginRuntimeSettings | null;

function usableSecret(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed: unknown = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function jwtExpiresAt(token: string): number {
  const payload = decodeJwtPayload(token);
  return typeof payload?.exp === "number" && Number.isFinite(payload.exp)
    ? payload.exp * 1000
    : Date.now() + 15 * 60 * 1000;
}

function codexAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const authClaim = isRecord(payload?.["https://api.openai.com/auth"])
    ? payload["https://api.openai.com/auth"]
    : null;
  const accountId = isRecord(authClaim)
    ? authClaim.chatgpt_account_id
    : undefined;
  return typeof accountId === "string" && accountId.trim().length > 0
    ? accountId.trim()
    : null;
}

function isSafePluginDataPath(value: string): boolean {
  return (
    value.startsWith(".data/") &&
    !value.startsWith(".data//") &&
    !value.split("/").includes("..") &&
    !value.includes("\\")
  );
}

function authValueFromSource(input: {
  binding: PiAuthPluginBinding;
  settings: RuntimeSettingsScope;
}): string | null {
  if (input.binding.source === "env") {
    return usableSecret(input.binding.envValues.get(input.binding.value));
  }
  return usableSecret(input.settings?.values[input.binding.value]);
}

function resolvePluginAuthPath(
  binding: PiAuthPluginBinding,
  rawPath: string,
  options?: AppDataPathOptions,
): string | null {
  if (!rawPath.startsWith(".data/")) {
    return null;
  }
  return isSafePluginDataPath(rawPath)
    ? join(getPluginsDirectoryPath(options), binding.directoryName, rawPath)
    : null;
}

function defaultCodexCliAuthPaths(): string[] {
  const paths: string[] = [];
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) {
    paths.push(join(codexHome, "auth.json"));
  }
  paths.push(join(homedir(), ".codex", "auth.json"));
  return [...new Set(paths)];
}

async function readCodexAuthJsonFile(input: {
  directoryName: string;
  path: string;
  settingKey: string;
}): Promise<CodexCliAuthJson | null> {
  try {
    const text = await readFile(input.path, "utf8");
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? (parsed as CodexCliAuthJson) : null;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return null;
    }
    // This importer can run before plugin/provider logging is wired. Use stderr
    // for operator repair guidance and log only the plugin setting identity plus
    // parse/read failure, never imported auth contents.
    console.warn(
      `Plugin Pi auth file for ${input.directoryName}/${input.settingKey} could not be imported: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function readCodexPluginAuthJson(input: {
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
  settings: RuntimeSettingsScope;
}): Promise<CodexCliAuthJson | null> {
  const rawPath = authValueFromSource(input);
  const path = rawPath
    ? resolvePluginAuthPath(input.binding, rawPath, input.options)
    : null;
  if (!rawPath || !path) {
    return null;
  }
  const auth = await readCodexAuthJsonFile({
    directoryName: input.binding.directoryName,
    path,
    settingKey: input.binding.value,
  });
  if (auth) {
    return auth;
  }
  if (rawPath !== ".data/auth.json") {
    return null;
  }

  for (const fallbackPath of defaultCodexCliAuthPaths()) {
    const auth = await readCodexAuthJsonFile({
      directoryName: input.binding.directoryName,
      path: fallbackPath,
      settingKey: input.binding.value,
    });
    if (auth) {
      return auth;
    }
  }
  return null;
}

async function readSettings(input: {
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
}): Promise<PluginRuntimeSettings> {
  return await readPluginSettingsForRuntime({
    declarations: input.binding.settings,
    directoryName: input.binding.directoryName,
    options: input.options,
  });
}

async function applyCodexPluginAuth(input: {
  authStorage: PiAuthStorage;
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
}): Promise<boolean> {
  const settings =
    input.binding.source === "env" ? null : await readSettings(input);
  const auth = await readCodexPluginAuthJson({
    binding: input.binding,
    ...(input.options ? { options: input.options } : {}),
    settings,
  });
  const tokens = isRecord(auth?.tokens) ? auth.tokens : null;
  const access = usableSecret(tokens?.access_token);
  if (!access) {
    return false;
  }
  const refresh = usableSecret(tokens?.refresh_token);
  if (!refresh) {
    input.authStorage.setRuntimeApiKey(input.binding.providerId, access);
    return true;
  }
  input.authStorage.set(input.binding.providerId, {
    access,
    accountId: codexAccountId(access) ?? undefined,
    expires: jwtExpiresAt(access),
    refresh,
    type: "oauth",
  });
  return true;
}

async function readPiOAuthPluginAuthJson(input: {
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
  settings: RuntimeSettingsScope;
}): Promise<Record<string, unknown> | null> {
  const rawPath = authValueFromSource(input);
  const path = rawPath
    ? resolvePluginAuthPath(input.binding, rawPath, input.options)
    : null;
  if (!rawPath || !path) {
    return null;
  }
  const auth = await readCodexAuthJsonFile({
    directoryName: input.binding.directoryName,
    path,
    settingKey: input.binding.value,
  });
  return isRecord(auth) ? auth : null;
}

function normalizePiOAuthCredential(value: unknown): OAuthCredential | null {
  if (!isRecord(value) || value.type !== "oauth") {
    return null;
  }
  const access = usableSecret(value.access);
  const refresh = usableSecret(value.refresh);
  if (!access || !refresh) {
    return null;
  }
  const credential: OAuthCredential = {
    access,
    expires:
      typeof value.expires === "number" && Number.isFinite(value.expires)
        ? value.expires
        : jwtExpiresAt(access),
    refresh,
    type: "oauth",
  };
  if (typeof value.accountId === "string" && value.accountId.trim()) {
    credential.accountId = value.accountId.trim();
  }
  if (typeof value.enterpriseUrl === "string" && value.enterpriseUrl.trim()) {
    credential.enterpriseUrl = value.enterpriseUrl.trim();
  }
  return credential;
}

async function applyPiOAuthFilePluginAuth(input: {
  authStorage: PiAuthStorage;
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
}): Promise<boolean> {
  const settings =
    input.binding.source === "env" ? null : await readSettings(input);
  const auth = await readPiOAuthPluginAuthJson({
    binding: input.binding,
    ...(input.options ? { options: input.options } : {}),
    settings,
  });
  const providerAuth = auth?.[input.binding.providerId];
  const credential = normalizePiOAuthCredential(providerAuth ?? auth);
  if (!credential) {
    return false;
  }
  input.authStorage.set(input.binding.providerId, credential);
  return true;
}

async function applyApiKeyPluginAuth(input: {
  authStorage: PiAuthStorage;
  binding: PiAuthPluginBinding;
  options?: AppDataPathOptions;
}): Promise<boolean> {
  let apiKey: string | null = null;
  if (input.binding.source === "env") {
    apiKey = usableSecret(input.binding.envValues.get(input.binding.value));
  } else {
    const settings = await readSettings(input);
    apiKey = usableSecret(settings.values[input.binding.value]);
  }
  if (apiKey) {
    input.authStorage.setRuntimeApiKey(input.binding.providerId, apiKey);
    return true;
  }
  return false;
}

export async function applyPiBuiltinProviderSettings(input: {
  authStorage: PiAuthStorage;
  bindings?: readonly PiAuthPluginBinding[];
  options?: AppDataPathOptions;
}): Promise<void> {
  const configuredProviders = new Set<string>();
  for (const binding of input.bindings ?? []) {
    if (configuredProviders.has(binding.providerId)) {
      continue;
    }
    let configured = false;
    if (binding.kind === "api_key") {
      configured = await applyApiKeyPluginAuth({
        authStorage: input.authStorage,
        binding,
        ...(input.options ? { options: input.options } : {}),
      });
    } else if (binding.kind === "codex_auth") {
      configured = await applyCodexPluginAuth({
        authStorage: input.authStorage,
        binding,
        ...(input.options ? { options: input.options } : {}),
      });
    } else {
      configured = await applyPiOAuthFilePluginAuth({
        authStorage: input.authStorage,
        binding,
        ...(input.options ? { options: input.options } : {}),
      });
    }
    if (configured) {
      configuredProviders.add(binding.providerId);
    }
  }
}
