/**
 * @file src/mainview/auth-client.ts
 * @description Module for auth client.
 */

import type { AuthPrimaryFactorType } from "../bun/db";

export const AUTH_REQUIRED_EVENT_NAME = "metidos:auth-required";

type AuthErrorDetails = Record<string, string | null>;

export type AuthStatus = {
  authenticated: boolean;
  configured: boolean;
  isAdmin?: boolean;
  knownUsernames?: string[];
  lockedUntil: string | null;
  primaryFactorType: AuthPrimaryFactorType | null;
  sessionExpiresAt: string | null;
  username?: string | null;
};

export type AuthStepUpResult = {
  status: AuthStatus;
  stepUpValidUntil: string;
};

export type TotpEnrollment = {
  totpSecret: string;
  totpUri: string;
};

export class AuthApiError extends Error {
  /**
   * Creates and initializes a new instance.
   * @param code - code value.
   * @param message - Message payload.
   * @param status - status value.
   * @param details - details value.
   */

  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: AuthErrorDetails | null,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

type AuthErrorResponse = {
  error?: {
    code?: unknown;
    details?: unknown;
    message?: unknown;
  };
};

declare global {
  interface WindowEventMap {
    "metidos:auth-required": CustomEvent<{
      reason: string;
    }>;
  }
}
/**
 * Is record.
 * @param value - Input value.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
 * Normalizes auth error details.
 * @param value - Input value.
 */

function normalizeAuthErrorDetails(value: unknown): AuthErrorDetails | null {
  if (!isRecord(value)) {
    return null;
  }

  const next: AuthErrorDetails = {};
  for (const [key, entry] of Object.entries(value)) {
    next[key] = typeof entry === "string" ? entry : null;
  }
  return next;
}
/**
 * Reads json body.
 * @param response - Response payload.
 */

async function readJsonBody(
  response: Response,
  endpoint: string,
): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    const statusText = response.statusText.trim();
    const status = statusText
      ? `${response.status} ${statusText}`
      : String(response.status);
    const preview = text.trim().replace(/\s+/g, " ").slice(0, 140);
    throw new Error(
      preview
        ? `Auth endpoint ${endpoint} returned invalid JSON with status ${status}. Response body started with: ${preview}`
        : `Auth endpoint ${endpoint} returned invalid JSON with status ${status}.`,
    );
  }
}
/**
 * Converts auth api error value.
 * @param response - Response payload.
 * @param payload - payload value.
 */

function toAuthApiError(response: Response, payload: unknown): AuthApiError {
  const body: AuthErrorResponse = isRecord(payload)
    ? (payload as AuthErrorResponse)
    : {};
  const error = isRecord(body.error) ? body.error : {};
  const message =
    typeof error.message === "string"
      ? error.message
      : `Auth request failed with status ${response.status}.`;
  const code = typeof error.code === "string" ? error.code : "auth_error";
  return new AuthApiError(
    code,
    message,
    response.status,
    normalizeAuthErrorDetails(error.details),
  );
}
/**
 * Sends an authenticated request and decodes the JSON payload from auth endpoints.
 * @param path - Auth endpoint path.
 * @param init - Request init options.
 */

let cachedCsrfToken: string | null = null;

export function clearCachedCsrfToken(): void {
  cachedCsrfToken = null;
}

async function ensureCsrfToken(): Promise<string> {
  if (cachedCsrfToken) {
    return cachedCsrfToken;
  }
  const response = await fetch("/auth/csrf", {
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload = await readJsonBody(response, "/auth/csrf");
  if (!response.ok) {
    throw toAuthApiError(response, payload);
  }
  const token = (payload as { csrfToken?: unknown } | null)?.csrfToken;
  if (typeof token !== "string" || !token) {
    throw new Error("Auth endpoint did not return a CSRF token.");
  }
  cachedCsrfToken = token;
  return token;
}

async function requestAuthJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  const method = init.method?.toUpperCase() ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    headers.set("x-metidos-csrf-token", await ensureCsrfToken());
  }

  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers,
  });
  const payload = await readJsonBody(response, path);
  if (!response.ok) {
    const error = toAuthApiError(response, payload);
    if (error.code === "csrf_token_invalid") {
      clearCachedCsrfToken();
    }
    throw error;
  }
  return payload as T;
}
/**
 * Broadcasts an auth-required event to prompt re-authentication.
 * @param reason - Reason auth is required.
 */

export function dispatchAuthRequired(reason: string): void {
  clearCachedCsrfToken();
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(AUTH_REQUIRED_EVENT_NAME, {
      detail: {
        reason,
      },
    }),
  );
}
/**
 * Is auth required error.
 * @param error - Error value to process.
 */

export function isAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof AuthApiError &&
    (error.code === "session_required" ||
      error.code === "invalid_websocket_ticket" ||
      error.status === 401)
  );
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const payload = await requestAuthJson<{
    ok: true;
    status: AuthStatus;
  }>("/auth/status");
  return payload.status;
}

export async function issueWebSocketTicket(): Promise<void> {
  await requestAuthJson<{
    ok: true;
    ticket: {
      expiresAt: string;
    };
  }>("/auth/ws-ticket", {
    body: JSON.stringify({}),
    method: "POST",
  });
}

export async function prepareSetupEnrollment(input?: {
  username?: string;
}): Promise<TotpEnrollment> {
  const payload = await requestAuthJson<{
    enrollment: TotpEnrollment;
    ok: true;
  }>("/auth/setup/start", {
    body: JSON.stringify(
      input?.username
        ? {
            username: input.username,
          }
        : {},
    ),
    method: "POST",
  });
  return payload.enrollment;
}
/**
 * Sends setup completion credentials and reads generated recovery material.
 * @param input - Enrollment completion request payload.
 */

export async function completeAuthSetup(input: {
  primaryFactor: string;
  primaryFactorType: AuthPrimaryFactorType;
  sessionLifetimeDays?: number;
  totpCode: string;
  totpSecret: string;
  username?: string;
}): Promise<{
  recoveryCodes: string[];
  status: AuthStatus;
}> {
  return requestAuthJson<{
    ok: true;
    recoveryCodes: string[];
    status: AuthStatus;
  }>("/auth/setup", {
    body: JSON.stringify(input),
    method: "POST",
  });
}
/**
 * Exchanges primary factor credentials for an authenticated session.
 * @param input - Login credentials.
 */

export async function loginAuth(input: {
  primaryFactor: string;
  totpCode: string;
  username?: string;
}): Promise<{
  status: AuthStatus;
}> {
  return requestAuthJson<{
    ok: true;
    status: AuthStatus;
  }>("/auth/login", {
    body: JSON.stringify(input),
    method: "POST",
  });
}
/**
 * Exchanges a recovery code for an authenticated session.
 * @param input - Recovery login payload.
 */

export async function loginWithRecoveryCodeAuth(input: {
  primaryFactor: string;
  recoveryCode: string;
  username?: string;
}): Promise<{
  status: AuthStatus;
}> {
  return requestAuthJson<{
    ok: true;
    status: AuthStatus;
  }>("/auth/recovery-login", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

/**
 * Reset the current authenticated user's PIN after confirming a TOTP code.
 * @param input - Reset-PIN payload.
 */
export async function resetPinAuth(input: {
  newPin: string;
  totpCode: string;
}): Promise<{
  status: AuthStatus;
}> {
  return requestAuthJson<{
    ok: true;
    status: AuthStatus;
  }>("/auth/reset-pin", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function stepUpAuth(input: {
  primaryFactor: string;
  totpCode: string;
}): Promise<AuthStepUpResult> {
  return requestAuthJson<{
    ok: true;
    status: AuthStatus;
    stepUpValidUntil: string;
  }>("/auth/step-up", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function logoutAuth(): Promise<AuthStatus> {
  try {
    const payload = await requestAuthJson<{
      ok: true;
      status: AuthStatus;
    }>("/auth/logout", {
      body: JSON.stringify({}),
      method: "POST",
    });
    return payload.status;
  } finally {
    clearCachedCsrfToken();
  }
}
