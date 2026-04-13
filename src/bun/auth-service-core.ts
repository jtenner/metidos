/**
 * @file src/bun/auth-service-core.ts
 * @description Shared auth-service types, errors, and low-level state helpers.
 */

import type { Database } from "bun:sqlite";

import { DEFAULT_SESSION_LIFETIME_DAYS, generateSessionId } from "./auth";
import {
  type AuthPrimaryFactorType,
  type AuthSessionRecord,
  type AuthSettingsRecord,
  countConfiguredAuthUsers,
  createAuthSession,
  createSecurityAuditEvent,
  deleteExpiredAuthSessions,
  deleteExpiredAuthWebSocketTickets,
  getAuthSettings,
  getUserById,
  getUserByUsername,
  resetAuthFailureState,
  setAuthFailureState,
  type UserRecord,
} from "./db";

export const SESSION_COOKIE_NAME = "metidos_session";
export const SESSION_COOKIE_PATH = "/";
export const WEBSOCKET_TICKET_COOKIE_NAME = "metidos_ws_ticket";
export const WEBSOCKET_TICKET_COOKIE_PATH = "/rpc";
export const DEFAULT_TOTP_ISSUER = "Metidos";
const LOGIN_LOCKOUT_AFTER_FAILURES = 3;
const LOGIN_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STEP_UP_LIFETIME_MS = 10 * 60 * 1000;
export const WEBSOCKET_TICKET_LIFETIME_MS = 60 * 1000;

export type AuthSecretOptions = {
  appDataDir?: string;
};

export type TimestampOptions = {
  devBypass?: boolean;
  nowMs?: number;
};

export type SetupAuthInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    primaryFactorType: AuthPrimaryFactorType;
    sessionLifetimeDays?: number;
    totpCode: string;
    totpSecret: string;
    username: string;
  };

export type LoginInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
    username: string;
  };

export type RecoveryLoginInput = TimestampOptions & {
  primaryFactor: string;
  recoveryCode: string;
  username: string;
};

export type PrepareTotpEnrollmentInput = {
  accountName: string;
  issuer?: string;
};

export type ResolveSessionInput = TimestampOptions & {
  sessionId: string | null;
  touch?: boolean;
};

export type IssueWebSocketTicketInput = TimestampOptions & {
  sessionId: string;
};

export type RequireFreshStepUpInput = TimestampOptions & {
  actionDescription: string;
  sessionId: string | null;
};

export type StepUpInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
    sessionId: string;
  };

export type ConsumeWebSocketTicketInput = TimestampOptions & {
  sessionId: string;
  ticketId: string;
};

export type AuthStatus = {
  authenticated: boolean;
  configured: boolean;
  devBypass: boolean;
  isAdmin?: boolean;
  knownUsernames?: string[];
  lockedUntil: string | null;
  primaryFactorType: AuthPrimaryFactorType | null;
  sessionExpiresAt: string | null;
  username?: string | null;
};

export type SessionCookieOptions = {
  maxAgeSeconds: number;
  secure: boolean;
};

export type WebSocketTicketCookieOptions = {
  maxAgeSeconds?: number;
  secure: boolean;
};

export type LoginResult = {
  session: AuthSessionRecord;
};

export type SetupAuthResult = LoginResult & {
  recoveryCodes: string[];
};

export type IssueWebSocketTicketResult = {
  expiresAt: string;
  ticket: string;
};

export type StepUpResult = {
  stepUpValidUntil: string;
};

export type ConfiguredAuthUser = {
  settings: AuthSettingsRecord;
  user: UserRecord;
};

export class AuthServiceError extends Error {
  /**
   * Error object used for auth service failures.
   * Includes a stable error code and HTTP status.
   */

  constructor(
    readonly code:
      | "auth_already_configured"
      | "auth_not_configured"
      | "auth_locked"
      | "auth_secret_unavailable"
      | "admin_required"
      | "invalid_credentials"
      | "step_up_required"
      | "session_required"
      | "session_expired"
      | "invalid_websocket_ticket"
      | "totp_setup_required"
      | "username_taken",
    message: string,
    readonly status: number,
    readonly details?: Record<string, string | null>,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

/**
 * Return a Date from an optional override timestamp.
 * @param nowMs - Timestamp in milliseconds, or current time if omitted.
 */
export function nowDate(nowMs = Date.now()): Date {
  return new Date(nowMs);
}

/**
 * Add whole days to a Date.
 * @param date - Base date.
 * @param days - Number of days to add.
 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Add milliseconds to a Date.
 * @param date - Base date.
 * @param milliseconds - Milliseconds to add.
 */
export function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

/**
 * Check if a session has exceeded the idle timeout window.
 * @param session - Session row to inspect.
 * @param now - Current timestamp.
 */
export function isSessionIdleExpired(
  session: AuthSessionRecord,
  now: Date,
): boolean {
  return (
    Date.parse(session.lastUsedAt) + DEFAULT_SESSION_IDLE_TIMEOUT_MS <=
    now.getTime()
  );
}

/**
 * Format a date for HTTP cookie headers.
 * @param date - Date to format.
 */
export function formatHttpDate(date: Date): string {
  return date.toUTCString();
}

/**
 * Normalize session lifetime days and enforce bounds.
 * @param value - Optional custom lifetime.
 */
export function normalizeSessionLifetimeDays(value?: number): number {
  if (typeof value !== "number") {
    return DEFAULT_SESSION_LIFETIME_DAYS;
  }
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error("Session lifetime must be an integer between 1 and 30.");
  }
  return value;
}

/**
 * Build timestamp options from optional override.
 * @param nowMs - Optional override timestamp.
 */
export function buildTimestampOptions(nowMs?: number): TimestampOptions {
  return typeof nowMs === "number" ? { nowMs } : {};
}

/**
 * Build auth secret options from app-data override.
 * @param appDataDir - Optional app data directory.
 */
export function buildAuthSecretOptions(appDataDir?: string): AuthSecretOptions {
  return typeof appDataDir === "string" ? { appDataDir } : {};
}

export function normalizeUsername(username: string): string {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }
  return normalizedUsername;
}

function runInImmediateAuthTransaction<T>(
  database: Database,
  callback: () => T,
): T {
  database.run("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.run("COMMIT");
    return result;
  } catch (error) {
    try {
      database.run("ROLLBACK");
    } catch {
      // Preserve the original failure when rollback also fails.
    }
    throw error;
  }
}

function readMutableAuthSettingsForUser(
  database: Database,
  userId: number,
  now: Date,
): AuthSettingsRecord {
  const settings = getAuthSettings(database, userId);
  if (!settings) {
    throw new Error(
      `Authentication settings were not found for user ${userId}.`,
    );
  }

  if (
    settings.lockedUntil &&
    Date.parse(settings.lockedUntil) <= now.getTime()
  ) {
    resetAuthFailureState(database, userId);
    const refreshedSettings = getAuthSettings(database, userId);
    if (!refreshedSettings) {
      throw new Error(
        `Authentication settings were not found for user ${userId}.`,
      );
    }
    return refreshedSettings;
  }

  return settings;
}

export function hasTotpEnrollment(
  settings: Pick<AuthSettingsRecord, "totpSecretCiphertext">,
): boolean {
  return settings.totpSecretCiphertext.trim().length > 0;
}

/**
 * Build a new session record object with expiration timestamps.
 * @param sessionLifetimeDays - Session TTL in days.
 * @param now - Timestamp for issued/last-used values.
 */
export function buildSession(
  sessionLifetimeDays: number,
  now = new Date(),
): {
  expiresAt: string;
  issuedAt: string;
  lastUsedAt: string;
  sessionId: string;
} {
  return {
    expiresAt: addDays(now, sessionLifetimeDays).toISOString(),
    issuedAt: now.toISOString(),
    lastUsedAt: now.toISOString(),
    sessionId: generateSessionId(),
  };
}

/**
 * Increment failed login attempts and update lockout state.
 * @param database - Database handle.
 * @param failedAttempts - Prior failed attempt count.
 * @param now - Current timestamp.
 */
export function incrementFailedAttempts(
  database: Database,
  userId: number,
  now: Date,
): { lockedUntil: string | null } {
  return runInImmediateAuthTransaction(database, () => {
    const settings = readMutableAuthSettingsForUser(database, userId, now);
    const nextAttempts = settings.failedPrimaryFactorAttempts + 1;
    if (nextAttempts >= LOGIN_LOCKOUT_AFTER_FAILURES) {
      const lockedUntil = addMilliseconds(
        now,
        LOGIN_LOCKOUT_WINDOW_MS,
      ).toISOString();
      setAuthFailureState(database, 0, lockedUntil, userId);
      return {
        lockedUntil,
      };
    }

    setAuthFailureState(database, nextAttempts, null, userId);
    return {
      lockedUntil: null,
    };
  });
}

/**
 * Read current auth settings for one user and clear stale lockout state.
 * @param database - Database handle.
 * @param userId - Authenticated user identifier.
 * @param now - Current timestamp.
 */
export function readCurrentAuthSettingsForUser(
  database: Database,
  userId: number,
  now: Date,
): ReturnType<typeof getAuthSettings> {
  const settings = getAuthSettings(database, userId);
  if (!settings) {
    return null;
  }

  if (
    settings.lockedUntil &&
    Date.parse(settings.lockedUntil) <= now.getTime()
  ) {
    resetAuthFailureState(database, userId);
    return getAuthSettings(database, userId);
  }

  return settings;
}

/**
 * Resolve a configured auth user by username.
 */
export function findConfiguredAuthUserByUsername(
  database: Database,
  username: string,
  now: Date,
): ConfiguredAuthUser | null {
  const user = getUserByUsername(database, username);
  if (!user) {
    return null;
  }
  const settings = readCurrentAuthSettingsForUser(database, user.id, now);
  if (!settings) {
    return null;
  }
  return {
    settings,
    user,
  };
}

export function enforceConfiguredUserByUsername(
  database: Database,
  username: string,
  now: Date,
): ConfiguredAuthUser {
  if (countConfiguredAuthUsers(database) === 0) {
    throw new AuthServiceError(
      "auth_not_configured",
      "Authentication is not configured yet.",
      409,
    );
  }

  const resolved = findConfiguredAuthUserByUsername(database, username, now);
  if (!resolved) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }
  if (resolved.settings.lockedUntil) {
    throw new AuthServiceError(
      "auth_locked",
      `Authentication is locked until ${resolved.settings.lockedUntil}.`,
      423,
      {
        lockedUntil: resolved.settings.lockedUntil,
      },
    );
  }
  return resolved;
}

export function enforceConfiguredUserById(
  database: Database,
  userId: number,
  now: Date,
): ConfiguredAuthUser {
  const user = getUserById(database, userId);
  const settings = readCurrentAuthSettingsForUser(database, userId, now);
  if (!user || !settings) {
    throw new AuthServiceError(
      "auth_not_configured",
      "Authentication is not configured yet.",
      409,
    );
  }
  if (settings.lockedUntil) {
    throw new AuthServiceError(
      "auth_locked",
      `Authentication is locked until ${settings.lockedUntil}.`,
      423,
      {
        lockedUntil: settings.lockedUntil,
      },
    );
  }
  return {
    settings,
    user,
  };
}

/**
 * Create and persist a session row after cleaning expired auth data.
 * @param database - Database handle.
 * @param userId - User that owns the new session.
 * @param sessionLifetimeDays - Session TTL in days.
 * @param now - Current timestamp.
 */
export async function createSessionRecord(
  database: Database,
  userId: number,
  sessionLifetimeDays: number,
  now = new Date(),
): Promise<AuthSessionRecord> {
  const session = buildSession(sessionLifetimeDays, now);
  deleteExpiredAuthSessions(database, now.toISOString());
  deleteExpiredAuthWebSocketTickets(database, now.toISOString());
  return createAuthSession(database, {
    expiresAt: session.expiresAt,
    id: session.sessionId,
    issuedAt: session.issuedAt,
    lastUsedAt: session.lastUsedAt,
    stepUpValidUntil: null,
    userId,
  });
}

/**
 * Persist an auth audit event with normalized payload.
 * @param database - Database handle.
 * @param input - Audit event details.
 */
export function recordAuthAuditEvent(
  database: Database,
  input: {
    eventType: string;
    payload?: Record<string, string | number | boolean | null>;
    summaryText: string;
  },
): void {
  createSecurityAuditEvent(database, {
    eventType: input.eventType,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
    summaryText: input.summaryText,
  });
}

/**
 * Record failed auth attempts and lockout state transitions.
 * @param database - Database handle.
 * @param input - Failure metadata.
 */
export function recordInvalidAuthAttempt(
  database: Database,
  input: {
    lockedUntil: string | null;
    method: "recovery_code" | "totp";
    primaryFactorType: AuthPrimaryFactorType;
  },
): void {
  if (input.lockedUntil) {
    recordAuthAuditEvent(database, {
      eventType: "auth_lockout_started",
      payload: {
        lockedUntil: input.lockedUntil,
        method: input.method,
        primaryFactorType: input.primaryFactorType,
      },
      summaryText:
        "Authentication lockout started after repeated invalid credentials.",
    });
    return;
  }

  recordAuthAuditEvent(database, {
    eventType: "auth_invalid_credentials",
    payload: {
      method: input.method,
      primaryFactorType: input.primaryFactorType,
    },
    summaryText:
      "Authentication failed because the provided credentials were invalid.",
  });
}
