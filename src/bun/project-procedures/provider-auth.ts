/**
 * @file src/bun/project-procedures/provider-auth.ts
 * @description Backend-managed provider-auth state for Codex-via-Pi support.
 */

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import {
  clearCodexAuthFileCredential,
  clearPiOpenAICodexCredential,
  createPiAuthStorage,
  loginPiOpenAICodex,
  OPENAI_CODEX_PROVIDER_ID,
  persistCodexAuthFileCredential,
  persistPiOpenAICodexCredential,
  refreshPiOpenAICodexCredential,
  startPiOpenAICodexDeviceLogin,
} from "../pi-codex-auth";
import type {
  RpcProviderAuthLogin,
  RpcProviderAuthLoginMode,
  RpcProviderAuthLoginState,
  RpcProviderAuthStatus,
} from "../rpc-schema";

const OPENAI_CODEX_PROVIDER_LABEL = "OpenAI Codex";

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
};

type ProviderAuthLoginAttempt = {
  authUrl: string | null;
  cancel: (() => void) | null;
  completionPromise: Promise<void>;
  deviceCode: string | null;
  error: string | null;
  instructions: string | null;
  loginId: string;
  mode: RpcProviderAuthLoginMode;
  manualCodeDeferred: Deferred<string>;
  progressMessages: string[];
  prompt: string | null;
  startedAt: string;
  state: RpcProviderAuthLoginState;
  updatedAt: string;
};

const providerAuthLoginAttempts = new Map<string, ProviderAuthLoginAttempt>();
const providerAuthLastErrors = new Map<string, string>();

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: Deferred<T>["resolve"];
  let rejectPromise!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

function isSupportedProvider(providerId: string): providerId is "openai-codex" {
  return providerId === OPENAI_CODEX_PROVIDER_ID;
}

function providerLabel(providerId: string): string {
  return providerId === OPENAI_CODEX_PROVIDER_ID
    ? OPENAI_CODEX_PROVIDER_LABEL
    : providerId;
}

function updateLoginAttempt(
  attempt: ProviderAuthLoginAttempt,
  updates: Partial<
    Pick<
      ProviderAuthLoginAttempt,
      "authUrl" | "deviceCode" | "error" | "instructions" | "prompt" | "state"
    >
  > & {
    progressMessage?: string | null;
  },
): void {
  if (typeof updates.authUrl !== "undefined") {
    attempt.authUrl = updates.authUrl;
  }
  if (typeof updates.error !== "undefined") {
    attempt.error = updates.error;
  }
  if (typeof updates.deviceCode !== "undefined") {
    attempt.deviceCode = updates.deviceCode;
  }
  if (typeof updates.instructions !== "undefined") {
    attempt.instructions = updates.instructions;
  }
  if (typeof updates.prompt !== "undefined") {
    attempt.prompt = updates.prompt;
  }
  if (typeof updates.state !== "undefined") {
    attempt.state = updates.state;
  }
  if (
    typeof updates.progressMessage === "string" &&
    updates.progressMessage.trim().length > 0
  ) {
    attempt.progressMessages = [
      ...attempt.progressMessages,
      updates.progressMessage.trim(),
    ].slice(-8);
  }
  attempt.updatedAt = isoNow();
}

function snapshotLoginAttempt(
  attempt: ProviderAuthLoginAttempt,
): RpcProviderAuthLogin {
  return {
    authUrl: attempt.authUrl,
    deviceCode: attempt.deviceCode,
    error: attempt.error,
    instructions: attempt.instructions,
    loginId: attempt.loginId,
    mode: attempt.mode,
    progressMessages: [...attempt.progressMessages],
    prompt: attempt.prompt,
    startedAt: attempt.startedAt,
    state: attempt.state,
    updatedAt: attempt.updatedAt,
  };
}

function buildProviderAuthStatus(
  agentDirectory: string,
  providerId: string,
): RpcProviderAuthStatus {
  if (!isSupportedProvider(providerId)) {
    throw new Error(`Unsupported provider auth provider: ${providerId}`);
  }

  const { authStorage, codexAuthState } = createPiAuthStorage(agentDirectory);
  const storedCredential = authStorage.get(providerId);
  const oauthCredential =
    storedCredential?.type === "oauth" ? storedCredential : null;
  const loginAttempt = providerAuthLoginAttempts.get(providerId) ?? null;
  const lastError =
    loginAttempt?.error ?? providerAuthLastErrors.get(providerId) ?? null;

  return {
    accountId:
      oauthCredential && typeof oauthCredential.accountId === "string"
        ? oauthCredential.accountId
        : null,
    codexAuthFilePath: codexAuthState.codexAuthFilePath,
    codexCliAuthDetail: codexAuthState.codexCliAuthDetail,
    codexCliAuthStatus: codexAuthState.codexCliAuthStatus,
    codexConfigFilePath: codexAuthState.codexConfigFilePath,
    codexCredentialStoreMode: codexAuthState.credentialStoreMode,
    configured: oauthCredential != null,
    credentialExpiresAt:
      oauthCredential && Number.isFinite(oauthCredential.expires)
        ? new Date(oauthCredential.expires).toISOString()
        : null,
    lastError,
    login: loginAttempt ? snapshotLoginAttempt(loginAttempt) : null,
    piAuthFilePath: codexAuthState.piAuthFilePath,
    providerId,
    providerLabel: providerLabel(providerId),
    source: codexAuthState.source,
    sourceReason: codexAuthState.reason,
  };
}

export function getProviderAuthStatus(
  agentDirectory: string,
  providerId: string,
): RpcProviderAuthStatus {
  return buildProviderAuthStatus(agentDirectory, providerId);
}

export async function startProviderAuthLogin(
  agentDirectory: string,
  params: {
    loginMode?: RpcProviderAuthLoginMode;
    providerId: string;
  },
): Promise<RpcProviderAuthStatus> {
  const { providerId } = params;
  const loginMode = params.loginMode ?? "browser";
  if (!isSupportedProvider(providerId)) {
    throw new Error(`Unsupported provider auth provider: ${providerId}`);
  }

  const existingAttempt = providerAuthLoginAttempts.get(providerId);
  if (
    existingAttempt &&
    (existingAttempt.state === "awaiting_browser" ||
      existingAttempt.state === "awaiting_code" ||
      existingAttempt.state === "completing")
  ) {
    return buildProviderAuthStatus(agentDirectory, providerId);
  }

  const attempt: ProviderAuthLoginAttempt = {
    authUrl: null,
    cancel: null,
    completionPromise: Promise.resolve(),
    deviceCode: null,
    error: null,
    instructions: null,
    loginId: randomUUID(),
    mode: loginMode,
    manualCodeDeferred: createDeferred<string>(),
    progressMessages: [],
    prompt: null,
    startedAt: isoNow(),
    state: "awaiting_browser",
    updatedAt: isoNow(),
  };
  const authReady = createDeferred<void>();

  providerAuthLastErrors.delete(providerId);
  providerAuthLoginAttempts.set(providerId, attempt);

  attempt.completionPromise = (async () => {
    try {
      const credential =
        loginMode === "device"
          ? await (() => {
              const handle = startPiOpenAICodexDeviceLogin(agentDirectory, {
                onAuth: (info) => {
                  updateLoginAttempt(attempt, {
                    authUrl: info.url,
                    deviceCode: info.code,
                    instructions: info.instructions,
                    prompt: null,
                    state: "awaiting_browser",
                  });
                  authReady.resolve();
                },
                onProgress: (message) => {
                  updateLoginAttempt(attempt, {
                    progressMessage: message,
                  });
                },
              });
              attempt.cancel = handle.cancel;
              return handle.completionPromise;
            })()
          : await loginPiOpenAICodex({
              onAuth: (info) => {
                updateLoginAttempt(attempt, {
                  authUrl: info.url,
                  deviceCode: null,
                  instructions: info.instructions ?? null,
                  prompt: null,
                  state: "awaiting_browser",
                });
                authReady.resolve();
              },
              onManualCodeInput: async () => {
                updateLoginAttempt(attempt, {
                  prompt:
                    "Paste the authorization code or the full redirect URL.",
                  state: "awaiting_code",
                });
                authReady.resolve();
                return attempt.manualCodeDeferred.promise;
              },
              onProgress: (message) => {
                updateLoginAttempt(attempt, {
                  progressMessage: message,
                });
              },
              onPrompt: async (prompt) => {
                updateLoginAttempt(attempt, {
                  prompt: prompt.message,
                  state: "awaiting_code",
                });
                authReady.resolve();
                return attempt.manualCodeDeferred.promise;
              },
              originator: "metidos",
            });
      persistPiOpenAICodexCredential(agentDirectory, credential);
      persistCodexAuthFileCredential(credential);
      providerAuthLastErrors.delete(providerId);
      updateLoginAttempt(attempt, {
        deviceCode: null,
        error: null,
        prompt: null,
        state: "completed",
      });
      authReady.resolve();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "Unknown error");
      const state = attempt.state === "cancelled" ? "cancelled" : "failed";
      updateLoginAttempt(attempt, {
        error: message,
        state,
      });
      if (state !== "cancelled") {
        providerAuthLastErrors.set(providerId, message);
      }
      authReady.resolve();
    }
  })();

  await Promise.race([authReady.promise, attempt.completionPromise]);

  return buildProviderAuthStatus(agentDirectory, providerId);
}

export async function completeProviderAuthLogin(
  agentDirectory: string,
  params: {
    loginId: string;
    manualCode?: string | null;
    providerId: string;
  },
): Promise<RpcProviderAuthStatus> {
  const { loginId, manualCode, providerId } = params;
  if (!isSupportedProvider(providerId)) {
    throw new Error(`Unsupported provider auth provider: ${providerId}`);
  }

  const attempt = providerAuthLoginAttempts.get(providerId);
  if (!attempt || attempt.loginId !== loginId) {
    providerAuthLastErrors.set(
      providerId,
      "The requested OpenAI Codex login is no longer active.",
    );
    return buildProviderAuthStatus(agentDirectory, providerId);
  }

  const trimmedManualCode = manualCode?.trim() ?? "";
  if (
    trimmedManualCode &&
    (attempt.state === "awaiting_browser" || attempt.state === "awaiting_code")
  ) {
    updateLoginAttempt(attempt, {
      prompt: null,
      state: "completing",
    });
    attempt.manualCodeDeferred.resolve(trimmedManualCode);
  }

  await attempt.completionPromise.catch(() => undefined);
  return buildProviderAuthStatus(agentDirectory, providerId);
}

export async function refreshProviderAuth(
  agentDirectory: string,
  providerId: string,
): Promise<RpcProviderAuthStatus> {
  if (!isSupportedProvider(providerId)) {
    throw new Error(`Unsupported provider auth provider: ${providerId}`);
  }

  const { authStorage, codexAuthState } = createPiAuthStorage(agentDirectory);
  const storedCredential = authStorage.get(providerId);
  if (storedCredential?.type !== "oauth") {
    providerAuthLastErrors.set(
      providerId,
      "OpenAI Codex is not authenticated yet.",
    );
    return buildProviderAuthStatus(agentDirectory, providerId);
  }

  try {
    const refreshedCredential = await refreshPiOpenAICodexCredential(
      storedCredential.refresh,
    );
    persistPiOpenAICodexCredential(agentDirectory, refreshedCredential);
    if (
      codexAuthState.source === "codex-file" ||
      existsSync(codexAuthState.codexAuthFilePath)
    ) {
      persistCodexAuthFileCredential(refreshedCredential);
    }
    providerAuthLastErrors.delete(providerId);
  } catch (error) {
    providerAuthLastErrors.set(
      providerId,
      error instanceof Error ? error.message : String(error ?? "Unknown error"),
    );
  }

  return buildProviderAuthStatus(agentDirectory, providerId);
}

export async function logoutProviderAuth(
  agentDirectory: string,
  providerId: string,
): Promise<RpcProviderAuthStatus> {
  if (!isSupportedProvider(providerId)) {
    throw new Error(`Unsupported provider auth provider: ${providerId}`);
  }

  const attempt = providerAuthLoginAttempts.get(providerId);
  if (attempt) {
    updateLoginAttempt(attempt, {
      error: "OpenAI Codex login cancelled.",
      state: "cancelled",
    });
    attempt.cancel?.();
    if (attempt.mode === "browser") {
      attempt.manualCodeDeferred.reject(
        new Error("OpenAI Codex login cancelled."),
      );
    }
    providerAuthLoginAttempts.delete(providerId);
  }

  clearPiOpenAICodexCredential(agentDirectory);
  clearCodexAuthFileCredential();
  providerAuthLastErrors.delete(providerId);

  return buildProviderAuthStatus(agentDirectory, providerId);
}

export function resetProviderAuthStateForTests(): void {
  for (const attempt of providerAuthLoginAttempts.values()) {
    attempt.cancel?.();
    if (attempt.mode === "browser") {
      attempt.manualCodeDeferred.reject(
        new Error("Provider auth test state reset."),
      );
    }
  }
  providerAuthLoginAttempts.clear();
  providerAuthLastErrors.clear();
}
