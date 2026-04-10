/**
 * @file src/bun/pi-codex-auth.ts
 * @description Syncs external Codex auth into Jolt's Pi auth store.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  loginOpenAICodex as loginOpenAICodexWithPiOAuth,
  type OAuthCredentials,
  type OAuthLoginCallbacks,
  refreshOpenAICodexToken as refreshOpenAICodexTokenWithPiOAuth,
} from "@mariozechner/pi-ai/oauth";
import { AuthStorage } from "@mariozechner/pi-coding-agent";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const AUTH_FILE_NAME = "auth.json";
const CONFIG_FILE_NAME = "config.toml";
const DEFAULT_CODEX_HOME_DIRECTORY = ".codex";

type CodexAuthJson = {
  auth_mode?: unknown;
  tokens?: {
    access_token?: unknown;
    refresh_token?: unknown;
    account_id?: unknown;
  } | null;
};

export type PiCodexAuthSource = "codex-file" | "pi-auth" | "none";
export type PiCodexCredentialStoreMode = "auto" | "file" | "keyring";
export type PiCodexCliAuthStatus =
  | "logged_in_api_key"
  | "logged_in_chatgpt"
  | "not_logged_in"
  | "unavailable"
  | "unknown";

export type PiCodexAuthReason =
  | "codex_auth_file_already_current"
  | "codex_auth_file_missing"
  | "codex_auth_file_unusable"
  | "codex_auth_file_unusable_fell_back_to_pi_auth"
  | "no_codex_auth_available"
  | "synced_from_codex_auth_file"
  | "using_existing_pi_codex_auth";

export type PiCodexAuthState = {
  codexAuthFilePath: string;
  codexCliAuthDetail: string | null;
  codexCliAuthStatus: PiCodexCliAuthStatus;
  codexConfigFilePath: string;
  credentialStoreMode: PiCodexCredentialStoreMode | null;
  overrideApplied: boolean;
  piAuthFilePath: string;
  reason: PiCodexAuthReason;
  source: PiCodexAuthSource;
};

export type PiOpenAICodexCredential = {
  access: string;
  accountId?: string;
  expires: number;
  refresh: string;
};

type CodexAuthJsonRecord = Record<string, unknown>;

type PersistedPiOpenAICodexCredential = PiOpenAICodexCredential & {
  type: "oauth";
};

type OpenAICodexLoginOptions = OAuthLoginCallbacks & {
  originator?: string;
};

type PiCodexAuthTestOverrides = {
  codexCliStatus?: (codexHomeDirectory: string) => {
    detail: string | null;
    status: PiCodexCliAuthStatus;
  };
  login?: (options: OpenAICodexLoginOptions) => Promise<OAuthCredentials>;
  refresh?: (refreshToken: string) => Promise<OAuthCredentials>;
};

let piCodexAuthTestOverrides: PiCodexAuthTestOverrides | null = null;
let cachedCodexCliStatus: {
  codexHomeDirectory: string;
  expiresAt: number;
  result: {
    detail: string | null;
    status: PiCodexCliAuthStatus;
  };
} | null = null;
const CODEX_CLI_STATUS_CACHE_TTL_MS = 5_000;

function decodeBase64Url(segment: string): string | null {
  const normalized = segment.replaceAll("-", "+").replaceAll("_", "/");
  const paddingLength = normalized.length % 4;
  if (paddingLength === 1) {
    return null;
  }
  const padded =
    paddingLength === 0
      ? normalized
      : normalized.padEnd(normalized.length + (4 - paddingLength), "=");
  try {
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  if (segments.length < 2) {
    return null;
  }
  const decodedPayload = decodeBase64Url(segments[1] ?? "");
  if (!decodedPayload) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodedPayload);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function extractJwtExpiryEpochMs(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}

function persistedCredential(
  credential: PiOpenAICodexCredential,
): PersistedPiOpenAICodexCredential {
  return {
    type: "oauth",
    ...credential,
  };
}

function persistedCredentialsEqual(
  left: unknown,
  right: PersistedPiOpenAICodexCredential,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeOAuthCredential(
  credential: OAuthCredentials,
): PiOpenAICodexCredential {
  const access =
    typeof credential.access === "string" ? credential.access.trim() : "";
  const refresh =
    typeof credential.refresh === "string" ? credential.refresh.trim() : "";
  const expires =
    typeof credential.expires === "number" &&
    Number.isFinite(credential.expires)
      ? credential.expires
      : NaN;
  const accountId =
    typeof credential.accountId === "string" ? credential.accountId.trim() : "";

  if (!access || !refresh || !Number.isFinite(expires)) {
    throw new Error("OpenAI Codex OAuth returned unusable credentials.");
  }

  return {
    access,
    ...(accountId ? { accountId } : {}),
    expires,
    refresh,
  };
}

function ensureParentDirectory(path: string): void {
  mkdirSync(dirname(path), {
    mode: 0o700,
    recursive: true,
  });
}

function readCodexCliStatusCache(codexHomeDirectory: string): {
  detail: string | null;
  status: PiCodexCliAuthStatus;
} | null {
  if (
    cachedCodexCliStatus?.codexHomeDirectory !== codexHomeDirectory ||
    cachedCodexCliStatus.expiresAt <= Date.now()
  ) {
    return null;
  }
  return cachedCodexCliStatus.result;
}

function clearCodexCliStatusCache(): void {
  cachedCodexCliStatus = null;
}

function writeCodexCliStatusCache(
  codexHomeDirectory: string,
  result: {
    detail: string | null;
    status: PiCodexCliAuthStatus;
  },
): {
  detail: string | null;
  status: PiCodexCliAuthStatus;
} {
  cachedCodexCliStatus = {
    codexHomeDirectory,
    expiresAt: Date.now() + CODEX_CLI_STATUS_CACHE_TTL_MS,
    result,
  };
  return result;
}

function currentProcessEnvironment(): Record<string, string> {
  const entries = Object.entries(process.env).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function readJsonRecord(path: string): CodexAuthJsonRecord {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as CodexAuthJsonRecord)
      : {};
  } catch {
    return {};
  }
}

function writeJsonRecord(path: string, record: CodexAuthJsonRecord): void {
  ensureParentDirectory(path);
  writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
  chmodSync(path, 0o600);
}

export function resolveCodexHomeDirectoryPath(): string {
  const configuredCodexHome = process.env.CODEX_HOME?.trim();
  return resolve(
    configuredCodexHome && configuredCodexHome.length > 0
      ? configuredCodexHome
      : join(homedir(), DEFAULT_CODEX_HOME_DIRECTORY),
  );
}

export function resolveCodexAuthFilePath(): string {
  return join(resolveCodexHomeDirectoryPath(), AUTH_FILE_NAME);
}

export function resolveCodexConfigFilePath(): string {
  return join(resolveCodexHomeDirectoryPath(), CONFIG_FILE_NAME);
}

export function resolvePiAuthFilePath(agentDirectory: string): string {
  return join(agentDirectory, AUTH_FILE_NAME);
}

export function readCodexCredentialStoreMode(
  configFilePath: string = resolveCodexConfigFilePath(),
): PiCodexCredentialStoreMode | null {
  if (!existsSync(configFilePath)) {
    return null;
  }
  try {
    const configText = readFileSync(configFilePath, "utf8");
    const match = configText.match(
      /^\s*cli_auth_credentials_store\s*=\s*"(file|keyring|auto)"\s*$/mu,
    );
    if (!match) {
      return null;
    }
    const mode = match[1];
    return mode === "file" || mode === "keyring" || mode === "auto"
      ? mode
      : null;
  } catch {
    return null;
  }
}

export function probeCodexCliAuthStatus(
  codexHomeDirectory: string = resolveCodexHomeDirectoryPath(),
): {
  detail: string | null;
  status: PiCodexCliAuthStatus;
} {
  const override = piCodexAuthTestOverrides?.codexCliStatus;
  if (override) {
    return override(codexHomeDirectory);
  }

  const cached = readCodexCliStatusCache(codexHomeDirectory);
  if (cached) {
    return cached;
  }

  const codexExecutablePath = Bun.which("codex");
  if (!codexExecutablePath) {
    return writeCodexCliStatusCache(codexHomeDirectory, {
      detail: "Codex CLI is not installed on PATH.",
      status: "unavailable",
    });
  }

  try {
    const result = Bun.spawnSync({
      cmd: [codexExecutablePath, "login", "status"],
      env: {
        ...currentProcessEnvironment(),
        CODEX_HOME: codexHomeDirectory,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = Buffer.from(result.stdout).toString("utf8").trim();
    const stderr = Buffer.from(result.stderr).toString("utf8").trim();
    const detail = stdout || stderr || null;
    const combinedOutput = [stdout, stderr].filter(Boolean).join("\n");

    if (result.exitCode === 0) {
      if (/logged in using chatgpt/iu.test(combinedOutput)) {
        return writeCodexCliStatusCache(codexHomeDirectory, {
          detail,
          status: "logged_in_chatgpt",
        });
      }
      if (/logged in using .*api key/iu.test(combinedOutput)) {
        return writeCodexCliStatusCache(codexHomeDirectory, {
          detail,
          status: "logged_in_api_key",
        });
      }
      return writeCodexCliStatusCache(codexHomeDirectory, {
        detail,
        status: "unknown",
      });
    }

    if (result.exitCode === 1 && /not logged in/iu.test(combinedOutput)) {
      return writeCodexCliStatusCache(codexHomeDirectory, {
        detail: stdout || "Not logged in",
        status: "not_logged_in",
      });
    }

    return writeCodexCliStatusCache(codexHomeDirectory, {
      detail,
      status: "unknown",
    });
  } catch (error) {
    return writeCodexCliStatusCache(codexHomeDirectory, {
      detail:
        error instanceof Error
          ? error.message
          : String(error ?? "Failed to run Codex CLI."),
      status: "unavailable",
    });
  }
}

export function persistPiOpenAICodexCredential(
  agentDirectory: string,
  credential: PiOpenAICodexCredential,
): void {
  const authStorage = AuthStorage.create(resolvePiAuthFilePath(agentDirectory));
  authStorage.set(OPENAI_CODEX_PROVIDER_ID, persistedCredential(credential));
  clearCodexCliStatusCache();
}

export function clearPiOpenAICodexCredential(agentDirectory: string): void {
  const authStorage = AuthStorage.create(resolvePiAuthFilePath(agentDirectory));
  authStorage.remove(OPENAI_CODEX_PROVIDER_ID);
  clearCodexCliStatusCache();
}

export function persistCodexAuthFileCredential(
  credential: PiOpenAICodexCredential,
): void {
  const authFilePath = resolveCodexAuthFilePath();
  const existing = readJsonRecord(authFilePath);
  const existingTokens =
    existing.tokens &&
    typeof existing.tokens === "object" &&
    !Array.isArray(existing.tokens)
      ? (existing.tokens as Record<string, unknown>)
      : {};

  writeJsonRecord(authFilePath, {
    ...existing,
    auth_mode: "chatgpt",
    tokens: {
      ...existingTokens,
      access_token: credential.access,
      ...(credential.accountId ? { account_id: credential.accountId } : {}),
      refresh_token: credential.refresh,
    },
  });
  clearCodexCliStatusCache();
}

export function clearCodexAuthFileCredential(): void {
  const authFilePath = resolveCodexAuthFilePath();
  if (!existsSync(authFilePath)) {
    return;
  }

  const existing = readJsonRecord(authFilePath);
  delete existing.auth_mode;
  delete existing.tokens;
  writeJsonRecord(authFilePath, existing);
  clearCodexCliStatusCache();
}

export async function loginPiOpenAICodex(
  options: OpenAICodexLoginOptions,
): Promise<PiOpenAICodexCredential> {
  const login = piCodexAuthTestOverrides?.login ?? loginOpenAICodexWithPiOAuth;
  const credential = await login(options);
  return normalizeOAuthCredential(credential);
}

export async function refreshPiOpenAICodexCredential(
  refreshToken: string,
): Promise<PiOpenAICodexCredential> {
  const refresh =
    piCodexAuthTestOverrides?.refresh ?? refreshOpenAICodexTokenWithPiOAuth;
  const credential = await refresh(refreshToken);
  return normalizeOAuthCredential(credential);
}

export function setPiCodexAuthTestOverrides(
  overrides: PiCodexAuthTestOverrides,
): void {
  piCodexAuthTestOverrides = overrides;
  clearCodexCliStatusCache();
}

export function resetPiCodexAuthTestOverrides(): void {
  piCodexAuthTestOverrides = null;
  clearCodexCliStatusCache();
}

export function translateCodexAuthToPiCredential(
  codexAuth: unknown,
  options?: {
    nowMs?: number;
  },
): PiOpenAICodexCredential | null {
  if (!codexAuth || typeof codexAuth !== "object") {
    return null;
  }

  const record = codexAuth as CodexAuthJson;
  const access =
    typeof record.tokens?.access_token === "string"
      ? record.tokens.access_token.trim()
      : "";
  const refresh =
    typeof record.tokens?.refresh_token === "string"
      ? record.tokens.refresh_token.trim()
      : "";
  const accountId =
    typeof record.tokens?.account_id === "string"
      ? record.tokens.account_id.trim()
      : "";
  if (!access || !refresh) {
    return null;
  }

  return {
    access,
    ...(accountId ? { accountId } : {}),
    expires:
      extractJwtExpiryEpochMs(access) ?? (options?.nowMs ?? Date.now()) - 1,
    refresh,
  };
}

export function createPiAuthStorage(agentDirectory: string): {
  authStorage: AuthStorage;
  codexAuthState: PiCodexAuthState;
} {
  mkdirSync(agentDirectory, {
    mode: 0o700,
    recursive: true,
  });

  const codexHomeDirectory = resolveCodexHomeDirectoryPath();
  const piAuthFilePath = resolvePiAuthFilePath(agentDirectory);
  const codexAuthFilePath = join(codexHomeDirectory, AUTH_FILE_NAME);
  const codexConfigFilePath = join(codexHomeDirectory, CONFIG_FILE_NAME);
  const credentialStoreMode = readCodexCredentialStoreMode(codexConfigFilePath);
  const codexCliStatus = probeCodexCliAuthStatus(codexHomeDirectory);
  const authStorage = AuthStorage.create(piAuthFilePath);

  const codexAuthFileExists = existsSync(codexAuthFilePath);
  let codexCredential: PiOpenAICodexCredential | null = null;
  let codexAuthUsable = false;
  if (codexAuthFileExists) {
    try {
      const parsed = JSON.parse(readFileSync(codexAuthFilePath, "utf8"));
      codexCredential = translateCodexAuthToPiCredential(parsed);
      codexAuthUsable = codexCredential != null;
    } catch {
      codexCredential = null;
    }
  }

  if (codexCredential) {
    const nextCredential = persistedCredential(codexCredential);
    const overrideApplied = !persistedCredentialsEqual(
      authStorage.get(OPENAI_CODEX_PROVIDER_ID),
      nextCredential,
    );
    if (overrideApplied) {
      authStorage.set(OPENAI_CODEX_PROVIDER_ID, nextCredential);
    }
    return {
      authStorage,
      codexAuthState: {
        codexAuthFilePath,
        codexCliAuthDetail: codexCliStatus.detail,
        codexCliAuthStatus: codexCliStatus.status,
        codexConfigFilePath,
        credentialStoreMode,
        overrideApplied,
        piAuthFilePath,
        reason: overrideApplied
          ? "synced_from_codex_auth_file"
          : "codex_auth_file_already_current",
        source: "codex-file",
      },
    };
  }

  const existingPiCodexCredential = authStorage.get(OPENAI_CODEX_PROVIDER_ID);
  const hasPiOAuthCodexCredential = existingPiCodexCredential?.type === "oauth";
  if (hasPiOAuthCodexCredential) {
    return {
      authStorage,
      codexAuthState: {
        codexAuthFilePath,
        codexCliAuthDetail: codexCliStatus.detail,
        codexCliAuthStatus: codexCliStatus.status,
        codexConfigFilePath,
        credentialStoreMode,
        overrideApplied: false,
        piAuthFilePath,
        reason:
          codexAuthFileExists && !codexAuthUsable
            ? "codex_auth_file_unusable_fell_back_to_pi_auth"
            : "using_existing_pi_codex_auth",
        source: "pi-auth",
      },
    };
  }

  return {
    authStorage,
    codexAuthState: {
      codexAuthFilePath,
      codexCliAuthDetail: codexCliStatus.detail,
      codexCliAuthStatus: codexCliStatus.status,
      codexConfigFilePath,
      credentialStoreMode,
      overrideApplied: false,
      piAuthFilePath,
      reason:
        codexAuthFileExists && !codexAuthUsable
          ? "codex_auth_file_unusable"
          : codexAuthFileExists
            ? "no_codex_auth_available"
            : "codex_auth_file_missing",
      source: "none",
    },
  };
}
