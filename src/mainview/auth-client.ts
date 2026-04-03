import type { AuthPrimaryFactorType } from "../bun/db";

export const AUTH_REQUIRED_EVENT_NAME = "jolt:auth-required";

type AuthErrorDetails = Record<string, string | null>;

export type AuthStatus = {
  authenticated: boolean;
  configured: boolean;
  devBypass: boolean;
  lockedUntil: string | null;
  primaryFactorType: AuthPrimaryFactorType | null;
  sessionExpiresAt: string | null;
};

export type TotpEnrollment = {
  totpSecret: string;
  totpUri: string;
};

export class AuthApiError extends Error {
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
    "jolt:auth-required": CustomEvent<{
      reason: string;
    }>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Auth endpoint returned invalid JSON.");
  }
}

function toAuthApiError(response: Response, payload: unknown): AuthApiError {
  const body = payload as AuthErrorResponse;
  const message =
    typeof body.error?.message === "string"
      ? body.error.message
      : `Auth request failed with status ${response.status}.`;
  const code =
    typeof body.error?.code === "string" ? body.error.code : "auth_error";
  return new AuthApiError(
    code,
    message,
    response.status,
    normalizeAuthErrorDetails(body.error?.details),
  );
}

async function requestAuthJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers,
  });
  const payload = await readJsonBody(response);
  if (!response.ok) {
    throw toAuthApiError(response, payload);
  }
  return payload as T;
}

export function dispatchAuthRequired(reason: string): void {
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

export async function prepareSetupEnrollment(): Promise<TotpEnrollment> {
  const payload = await requestAuthJson<{
    enrollment: TotpEnrollment;
    ok: true;
  }>("/auth/setup/start", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return payload.enrollment;
}

export async function completeAuthSetup(input: {
  primaryFactor: string;
  primaryFactorType: AuthPrimaryFactorType;
  sessionLifetimeDays?: number;
  totpCode: string;
  totpSecret: string;
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

export async function loginAuth(input: {
  primaryFactor: string;
  totpCode: string;
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

export async function loginWithRecoveryCodeAuth(input: {
  primaryFactor: string;
  recoveryCode: string;
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

export async function logoutAuth(): Promise<AuthStatus> {
  const payload = await requestAuthJson<{
    ok: true;
    status: AuthStatus;
  }>("/auth/logout", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return payload.status;
}

export async function stepUpAuth(input: {
  primaryFactor: string;
  totpCode: string;
}): Promise<{
  status: AuthStatus;
  stepUpValidUntil: string;
}> {
  return requestAuthJson<{
    ok: true;
    status: AuthStatus;
    stepUpValidUntil: string;
  }>("/auth/step-up", {
    body: JSON.stringify(input),
    method: "POST",
  });
}

export async function issueWebSocketTicket(): Promise<{
  expiresAt: string;
  ticket: string;
}> {
  const payload = await requestAuthJson<{
    ok: true;
    ticket: {
      expiresAt: string;
      ticket: string;
    };
  }>("/auth/ws-ticket", {
    body: JSON.stringify({}),
    method: "POST",
  });
  return payload.ticket;
}
