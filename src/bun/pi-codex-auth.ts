/**
 * @file src/bun/pi-codex-auth.ts
 * @description Syncs external Codex auth into Jolt's Pi auth store.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { AuthStorage } from "@mariozechner/pi-coding-agent";

const OPENAI_CODEX_PROVIDER_ID = "openai-codex";
const AUTH_FILE_NAME = "auth.json";
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

type PersistedPiOpenAICodexCredential = PiOpenAICodexCredential & {
  type: "oauth";
};

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

export function resolvePiAuthFilePath(agentDirectory: string): string {
  return join(agentDirectory, AUTH_FILE_NAME);
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

  const piAuthFilePath = resolvePiAuthFilePath(agentDirectory);
  const codexAuthFilePath = resolveCodexAuthFilePath();
  const authStorage = AuthStorage.create(piAuthFilePath);

  let codexCredential: PiOpenAICodexCredential | null = null;
  let codexAuthUsable = false;
  if (existsSync(codexAuthFilePath)) {
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
        overrideApplied: false,
        piAuthFilePath,
        reason: codexAuthUsable
          ? "using_existing_pi_codex_auth"
          : existsSync(codexAuthFilePath)
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
      overrideApplied: false,
      piAuthFilePath,
      reason: existsSync(codexAuthFilePath)
        ? "codex_auth_file_unusable"
        : "no_codex_auth_available",
      source: "none",
    },
  };
}
