/**
 * @file src/bun/auth-service.ts
 * @description Auth service orchestration for setup, login, sessions, and websocket tickets.
 */

import type { Database } from "bun:sqlite";

import {
  type AuthSetupMaterial,
  buildTotpUri,
  DEFAULT_SESSION_LIFETIME_DAYS,
  generateRecoveryCodes,
  generateSessionId,
  generateTotpSecret,
  generateWebSocketTicketId,
  hashPrimaryFactor,
  hashRecoveryCode,
  verifyPrimaryFactor,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./auth";
import { decryptAuthSecret, encryptAuthSecret } from "./auth-secrets";
import {
  type AuthPrimaryFactorType,
  type AuthSessionRecord,
  type AuthSettingsRecord,
  consumeAuthWebSocketTicket,
  countConfiguredAuthUsers,
  createAuthSession,
  createAuthWebSocketTicket,
  createSecurityAuditEvent,
  createUser,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  deleteExpiredAuthWebSocketTickets,
  getAuthSession,
  getAuthSettings,
  getAuthWebSocketTicket,
  getUserById,
  getUserByUsername,
  listAuthRecoveryCodes,
  listKnownAuthUsernames,
  markAuthRecoveryCodeUsed,
  replaceAuthRecoveryCodeHashes,
  resetAuthFailureState,
  setAuthFailureState,
  setAuthSessionStepUpValidUntil,
  touchAuthSession,
  type UserRecord,
  updateUserAdminStatus,
  upsertAuthSettings,
} from "./db";

const SESSION_COOKIE_NAME = "metidos_session";
const SESSION_COOKIE_PATH = "/";
const WEBSOCKET_TICKET_COOKIE_NAME = "metidos_ws_ticket";
const WEBSOCKET_TICKET_COOKIE_PATH = "/rpc";
const DEFAULT_TOTP_ISSUER = "Metidos";
const LOGIN_LOCKOUT_AFTER_FAILURES = 3;
const LOGIN_LOCKOUT_WINDOW_MS = 10 * 60 * 1000;
export const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STEP_UP_LIFETIME_MS = 10 * 60 * 1000;
const WEBSOCKET_TICKET_LIFETIME_MS = 60 * 1000;

type AuthSecretOptions = {
  appDataDir?: string;
};

type TimestampOptions = {
  devBypass?: boolean;
  nowMs?: number;
};

type SetupAuthInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    primaryFactorType: AuthPrimaryFactorType;
    sessionLifetimeDays?: number;
    totpCode: string;
    totpSecret: string;
    username: string;
  };

type LoginInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
    username: string;
  };

type RecoveryLoginInput = TimestampOptions & {
  primaryFactor: string;
  recoveryCode: string;
  username: string;
};

type PrepareTotpEnrollmentInput = {
  accountName: string;
  issuer?: string;
};

type ResolveSessionInput = TimestampOptions & {
  sessionId: string | null;
  touch?: boolean;
};

type IssueWebSocketTicketInput = TimestampOptions & {
  sessionId: string;
};

type RequireFreshStepUpInput = TimestampOptions & {
  actionDescription: string;
  sessionId: string | null;
};

type StepUpInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
    sessionId: string;
  };

type ConsumeWebSocketTicketInput = TimestampOptions & {
  sessionId: string;
  ticketId: string;
};

type AuthStatus = {
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

type SessionCookieOptions = {
  maxAgeSeconds: number;
  secure: boolean;
};

type WebSocketTicketCookieOptions = {
  maxAgeSeconds?: number;
  secure: boolean;
};

type LoginResult = {
  session: AuthSessionRecord;
};

type SetupAuthResult = LoginResult & {
  recoveryCodes: string[];
};

type IssueWebSocketTicketResult = {
  expiresAt: string;
  ticket: string;
};

type StepUpResult = {
  stepUpValidUntil: string;
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

function nowDate(nowMs = Date.now()): Date {
  return new Date(nowMs);
}
/**
 * Add whole days to a Date.
 * @param date - Base date.
 * @param days - Number of days to add.
 */

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
/**
 * Add milliseconds to a Date.
 * @param date - Base date.
 * @param milliseconds - Milliseconds to add.
 */

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}
/**
 * Check if a session has exceeded the idle timeout window.
 * @param session - Session row to inspect.
 * @param now - Current timestamp.
 */

function isSessionIdleExpired(session: AuthSessionRecord, now: Date): boolean {
  return (
    Date.parse(session.lastUsedAt) + DEFAULT_SESSION_IDLE_TIMEOUT_MS <=
    now.getTime()
  );
}
/**
 * Format a date for HTTP cookie headers.
 * @param date - Date to format.
 */

function formatHttpDate(date: Date): string {
  return date.toUTCString();
}
/**
 * Normalize session lifetime days and enforce bounds.
 * @param value - Optional custom lifetime.
 */

function normalizeSessionLifetimeDays(value?: number): number {
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

function buildTimestampOptions(nowMs?: number): TimestampOptions {
  return typeof nowMs === "number" ? { nowMs } : {};
}
/**
 * Build auth secret options from app-data override.
 * @param appDataDir - Optional app data directory.
 */

function buildAuthSecretOptions(appDataDir?: string): AuthSecretOptions {
  return typeof appDataDir === "string" ? { appDataDir } : {};
}

function normalizeUsername(username: string): string {
  const normalizedUsername = username.trim();
  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }
  return normalizedUsername;
}

type ConfiguredAuthUser = {
  settings: AuthSettingsRecord;
  user: UserRecord;
};

function hasTotpEnrollment(
  settings: Pick<AuthSettingsRecord, "totpSecretCiphertext">,
): boolean {
  return settings.totpSecretCiphertext.trim().length > 0;
}
/**
 * Build a new session record object with expiration timestamps.
 * @param sessionLifetimeDays - Session TTL in days.
 * @param now - Timestamp for issued/last-used values.
 */

function buildSession(
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

function incrementFailedAttempts(
  database: Database,
  userId: number,
  failedAttempts: number,
  now: Date,
): { lockedUntil: string | null } {
  const nextAttempts = failedAttempts + 1;
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
}
/**
 * Read current auth settings for one user and clear stale lockout state.
 * @param database - Database handle.
 * @param userId - Authenticated user identifier.
 * @param now - Current timestamp.
 */

function readCurrentAuthSettingsForUser(
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

function findConfiguredAuthUserByUsername(
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

function enforceConfiguredUserByUsername(
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

function enforceConfiguredUserById(
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

async function createSessionRecord(
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

function recordAuthAuditEvent(
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

function recordInvalidAuthAttempt(
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
/**
 * Parse one cookie value from a Cookie header.
 * @param cookieHeader - Raw Cookie header.
 * @param name - Cookie name to parse.
 */

function parseCookieHeaderValue(
  cookieHeader: string,
  name: string,
): string | null {
  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }
    return rawValueParts.join("=") || null;
  }
  return null;
}

/**
 * Parse the session cookie from an incoming Cookie header.
 * @param cookieHeader - Raw Cookie header.
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  return parseCookieHeaderValue(cookieHeader, SESSION_COOKIE_NAME);
}

/**
 * Parse the websocket ticket cookie from an incoming Cookie header.
 * @param cookieHeader - Raw Cookie header.
 */
export function readWebSocketTicketCookie(
  cookieHeader: string | null,
): string | null {
  if (!cookieHeader) {
    return null;
  }
  return parseCookieHeaderValue(cookieHeader, WEBSOCKET_TICKET_COOKIE_NAME);
}

/**
 * Serialize an authenticated session cookie header.
 * @param sessionId - Session identifier value.
 * @param options - Session cookie attributes.
 */

export function buildSessionCookieHeader(
  sessionId: string,
  options: SessionCookieOptions,
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${sessionId}`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize the short-lived websocket ticket cookie used during RPC upgrades.
 * @param ticketId - Ticket identifier.
 * @param options - Ticket cookie attributes.
 */
export function buildWebSocketTicketCookieHeader(
  ticketId: string,
  options: WebSocketTicketCookieOptions,
): string {
  const parts = [
    `${WEBSOCKET_TICKET_COOKIE_NAME}=${ticketId}`,
    `Path=${WEBSOCKET_TICKET_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${options.maxAgeSeconds ?? Math.ceil(WEBSOCKET_TICKET_LIFETIME_MS / 1000)}`,
  ];
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize a session cookie that forces immediate browser removal.
 * @param secure - Whether to include the Secure attribute.
 */
export function buildClearedSessionCookieHeader(secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    `Path=${SESSION_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    `Expires=${formatHttpDate(new Date(0))}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Serialize a websocket ticket cookie that forces immediate removal.
 * @param secure - Whether to include the Secure attribute.
 */
export function buildClearedWebSocketTicketCookieHeader(
  secure: boolean,
): string {
  const parts = [
    `${WEBSOCKET_TICKET_COOKIE_NAME}=`,
    `Path=${WEBSOCKET_TICKET_COOKIE_PATH}`,
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
    `Expires=${formatHttpDate(new Date(0))}`,
  ];
  if (secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * Create the TOTP secret and URI needed for QR-code enrollment.
 */

export function prepareTotpEnrollment(
  input: PrepareTotpEnrollmentInput,
): Pick<AuthSetupMaterial, "totpSecret" | "totpUri"> {
  const totpSecret = generateTotpSecret();
  return {
    totpSecret,
    totpUri: buildTotpUri({
      accountName: input.accountName,
      issuer: input.issuer ?? DEFAULT_TOTP_ISSUER,
      secret: totpSecret,
    }),
  };
}

/**
 * Return the current auth status for the app and an optional session cookie.
 */

export function getAuthStatus(
  database: Database,
  sessionId: string | null,
  options: TimestampOptions = {},
): AuthStatus {
  const now = nowDate(options.nowMs);
  const knownUsernames = listKnownAuthUsernames(database);
  const session = sessionId
    ? resolveSession(database, {
        sessionId,
        ...buildTimestampOptions(options.nowMs),
      })
    : null;
  const settings =
    session === null
      ? null
      : readCurrentAuthSettingsForUser(database, session.userId, now);

  return {
    authenticated: options.devBypass === true || session !== null,
    configured: knownUsernames.length > 0,
    devBypass: options.devBypass === true,
    isAdmin: session?.isAdmin ?? false,
    knownUsernames,
    lockedUntil: session === null ? null : (settings?.lockedUntil ?? null),
    primaryFactorType:
      session === null ? null : (settings?.primaryFactorType ?? null),
    sessionExpiresAt: session?.expiresAt ?? null,
    username: session?.username ?? null,
  };
}

/**
 * Verify the configured primary factor and TOTP code without creating a session.
 * Shared by login, CLI recovery flows, and step-up verification paths.
 */

export async function verifyPrimaryFactorAndTotp(
  database: Database,
  input: LoginInput,
): Promise<ConfiguredAuthUser> {
  const now = nowDate(input.nowMs);
  const normalizedUsername = normalizeUsername(input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );

  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );
  if (!primaryFactorValid) {
    const failure = incrementFailedAttempts(
      database,
      user.id,
      settings.failedPrimaryFactorAttempts,
      now,
    );
    recordInvalidAuthAttempt(database, {
      lockedUntil: failure.lockedUntil,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        `Authentication is locked until ${failure.lockedUntil}.`,
        423,
        {
          lockedUntil: failure.lockedUntil,
        },
      );
    }

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  if (!hasTotpEnrollment(settings)) {
    throw new AuthServiceError(
      "totp_setup_required",
      "Complete authenticator setup to finish signing in.",
      409,
      {
        username: user.username,
      },
    );
  }

  const totpSecret = primaryFactorValid
    ? await decryptAuthSecret(
        settings.totpSecretCiphertext,
        buildAuthSecretOptions(input.appDataDir),
      )
    : null;
  const totpValid =
    totpSecret === null
      ? false
      : await verifyTotpCode(totpSecret, input.totpCode, {
          atMs: now.getTime(),
        });

  if (!totpValid) {
    recordInvalidAuthAttempt(database, {
      lockedUntil: null,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database, user.id);
  return {
    settings,
    user,
  };
}

/**
 * Verify the configured primary factor and consume one recovery code in place of TOTP.
 */

export async function verifyPrimaryFactorAndRecoveryCode(
  database: Database,
  input: RecoveryLoginInput,
): Promise<ConfiguredAuthUser> {
  const now = nowDate(input.nowMs);
  const normalizedUsername = normalizeUsername(input.username);
  const { settings, user } = enforceConfiguredUserByUsername(
    database,
    normalizedUsername,
    now,
  );
  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );

  let matchingCodeHash: string | null = null;
  if (primaryFactorValid) {
    for (const record of listAuthRecoveryCodes(database, user.id)) {
      if (record.usedAt !== null) {
        continue;
      }
      if (await verifyRecoveryCode(input.recoveryCode, record.codeHash)) {
        matchingCodeHash = record.codeHash;
        break;
      }
    }
  }

  if (!primaryFactorValid || !matchingCodeHash) {
    if (!primaryFactorValid) {
      const failure = incrementFailedAttempts(
        database,
        user.id,
        settings.failedPrimaryFactorAttempts,
        now,
      );
      recordInvalidAuthAttempt(database, {
        lockedUntil: failure.lockedUntil,
        method: "recovery_code",
        primaryFactorType: settings.primaryFactorType,
      });

      if (failure.lockedUntil) {
        throw new AuthServiceError(
          "auth_locked",
          `Authentication is locked until ${failure.lockedUntil}.`,
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }
    } else {
      recordInvalidAuthAttempt(database, {
        lockedUntil: null,
        method: "recovery_code",
        primaryFactorType: settings.primaryFactorType,
      });
    }

    if (primaryFactorValid && !hasTotpEnrollment(settings)) {
      throw new AuthServiceError(
        "totp_setup_required",
        "Complete authenticator setup to finish signing in.",
        409,
        {
          username: user.username,
        },
      );
    }

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  const markedUsed = markAuthRecoveryCodeUsed(
    database,
    matchingCodeHash,
    now.toISOString(),
    user.id,
  );
  if (!markedUsed) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database, user.id);
  return {
    settings,
    user,
  };
}

/**
 * Complete first-run auth setup, persist settings, and create an authenticated session.
 */

export async function setupAuth(
  database: Database,
  input: SetupAuthInput,
): Promise<SetupAuthResult> {
  const normalizedUsername = normalizeUsername(input.username);
  const now = nowDate(input.nowMs);
  const configuredUserCount = countConfiguredAuthUsers(database);
  const existingUser = getUserByUsername(database, normalizedUsername);
  const existingSettings = existingUser
    ? readCurrentAuthSettingsForUser(database, existingUser.id, now)
    : null;
  if (existingSettings && hasTotpEnrollment(existingSettings)) {
    throw new AuthServiceError(
      "username_taken",
      `The username "${normalizedUsername}" is already configured.`,
      409,
    );
  }
  if (configuredUserCount > 0 && !existingUser) {
    throw new AuthServiceError(
      "admin_required",
      `Only administrators can create users. Ask the primary user to create "${normalizedUsername}" first.`,
      403,
    );
  }
  if (existingSettings?.lockedUntil) {
    throw new AuthServiceError(
      "auth_locked",
      `Authentication is locked until ${existingSettings.lockedUntil}.`,
      423,
      {
        lockedUntil: existingSettings.lockedUntil,
      },
    );
  }
  const totpValid = await verifyTotpCode(input.totpSecret, input.totpCode, {
    atMs: now.getTime(),
  });
  if (!totpValid) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided TOTP code is invalid.",
      401,
    );
  }

  const totpSecretCiphertext = await encryptAuthSecret(
    input.totpSecret,
    buildAuthSecretOptions(input.appDataDir),
  );
  const requestedSessionLifetimeDays = normalizeSessionLifetimeDays(
    input.sessionLifetimeDays,
  );
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(
    recoveryCodes.map((code) => hashRecoveryCode(code)),
  );
  let primaryFactorHash: string;
  let primaryFactorType: AuthPrimaryFactorType;
  let sessionLifetimeDays: number;
  let user: UserRecord;

  if (existingUser && existingSettings) {
    const primaryFactorValid = await verifyPrimaryFactor(
      input.primaryFactor,
      existingSettings.primaryFactorHash,
    );
    if (!primaryFactorValid) {
      const failure = incrementFailedAttempts(
        database,
        existingUser.id,
        existingSettings.failedPrimaryFactorAttempts,
        now,
      );
      recordInvalidAuthAttempt(database, {
        lockedUntil: failure.lockedUntil,
        method: "totp",
        primaryFactorType: existingSettings.primaryFactorType,
      });

      if (failure.lockedUntil) {
        throw new AuthServiceError(
          "auth_locked",
          `Authentication is locked until ${failure.lockedUntil}.`,
          423,
          {
            lockedUntil: failure.lockedUntil,
          },
        );
      }

      throw new AuthServiceError(
        "invalid_credentials",
        "The provided credentials are invalid.",
        401,
      );
    }

    resetAuthFailureState(database, existingUser.id);
    primaryFactorHash = existingSettings.primaryFactorHash;
    primaryFactorType = existingSettings.primaryFactorType;
    sessionLifetimeDays = existingSettings.sessionLifetimeDays;
    user = existingUser;
  } else {
    primaryFactorHash = await hashPrimaryFactor(
      input.primaryFactorType,
      input.primaryFactor,
    );
    primaryFactorType = input.primaryFactorType;
    sessionLifetimeDays = requestedSessionLifetimeDays;
    user = existingUser
      ? configuredUserCount === 0 && !existingUser.isAdmin
        ? updateUserAdminStatus(database, existingUser.id, true)
        : existingUser
      : createUser(database, {
          isAdmin: configuredUserCount === 0,
          username: normalizedUsername,
        });
  }

  upsertAuthSettings(database, {
    primaryFactorHash,
    primaryFactorType,
    sessionLifetimeDays,
    totpSecretCiphertext,
    userId: user.id,
  });
  replaceAuthRecoveryCodeHashes(database, recoveryCodeHashes, user.id);
  const session = await createSessionRecord(
    database,
    user.id,
    sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "auth_configured",
    payload: {
      primaryFactorType,
      sessionLifetimeDays,
      userId: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
    },
    summaryText:
      "Authentication was configured for a user and a session was created.",
  });

  return {
    recoveryCodes,
    session,
  };
}

/**
 * Create a regular pending user who must finish auth setup later.
 */
export async function createPendingUser(
  database: Database,
  input: {
    actorUserId?: number | null;
    actorUsername?: string | null;
    pin: string;
    username: string;
  },
): Promise<UserRecord> {
  if (countConfiguredAuthUsers(database) === 0) {
    throw new AuthServiceError(
      "auth_not_configured",
      "Configure the primary user before creating additional users.",
      409,
    );
  }

  const normalizedUsername = normalizeUsername(input.username);
  const existingUser = getUserByUsername(database, normalizedUsername);
  if (existingUser) {
    throw new AuthServiceError(
      "username_taken",
      `The username "${normalizedUsername}" already exists.`,
      409,
    );
  }

  const user = createUser(database, {
    isAdmin: false,
    username: normalizedUsername,
  });
  upsertAuthSettings(database, {
    primaryFactorHash: await hashPrimaryFactor("pin", input.pin),
    primaryFactorType: "pin",
    sessionLifetimeDays: DEFAULT_SESSION_LIFETIME_DAYS,
    totpSecretCiphertext: "",
    userId: user.id,
  });
  recordAuthAuditEvent(database, {
    eventType: "user_created",
    payload: {
      createdByUserId: input.actorUserId ?? null,
      createdByUsername: input.actorUsername ?? null,
      isAdmin: user.isAdmin,
      userId: user.id,
      username: user.username,
    },
    summaryText:
      "A regular user account was created with an assigned PIN and pending authenticator setup.",
  });
  return user;
}

/**
 * Authenticate a user with their primary factor and mandatory TOTP code.
 */

export async function login(
  database: Database,
  input: LoginInput,
): Promise<LoginResult> {
  const now = nowDate(input.nowMs);
  const { settings, user } = await verifyPrimaryFactorAndTotp(database, input);
  const session = await createSessionRecord(
    database,
    user.id,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "auth_login",
    payload: {
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
      userId: user.id,
      username: user.username,
    },
    summaryText: "Authenticated with the configured primary factor and TOTP.",
  });
  return {
    session,
  };
}

/**
 * Authenticate a user with their primary factor plus a single-use recovery code.
 */

export async function loginWithRecoveryCode(
  database: Database,
  input: RecoveryLoginInput,
): Promise<LoginResult> {
  const now = nowDate(input.nowMs);
  const { settings, user } = await verifyPrimaryFactorAndRecoveryCode(
    database,
    input,
  );
  const session = await createSessionRecord(
    database,
    user.id,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "recovery_code_login",
    payload: {
      method: "recovery_code",
      primaryFactorType: settings.primaryFactorType,
      userId: user.id,
      username: user.username,
    },
    summaryText:
      "Authenticated with the configured primary factor and a recovery code.",
  });
  return {
    session,
  };
}

/**
 * Resolve a valid session row from a session id, pruning expired rows first.
 */

export function resolveSession(
  database: Database,
  input: ResolveSessionInput,
): AuthSessionRecord | null {
  if (!input.sessionId) {
    return null;
  }

  const now = nowDate(input.nowMs);
  deleteExpiredAuthSessions(database, now.toISOString());
  const session = getAuthSession(database, input.sessionId);
  if (!session) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= now.getTime()) {
    deleteAuthSession(database, session.id);
    return null;
  }

  if (isSessionIdleExpired(session, now)) {
    deleteAuthSession(database, session.id);
    return null;
  }

  if (input.touch) {
    touchAuthSession(database, session.id, now.toISOString());
    return getAuthSession(database, session.id);
  }

  return session;
}

/**
 * Delete one authenticated session.
 * @param database - Database handle.
 * @param sessionId - Session identifier from cookie/JWT context.
 */
export function logout(database: Database, sessionId: string | null): void {
  if (!sessionId) {
    return;
  }
  const session = getAuthSession(database, sessionId);
  deleteAuthSession(database, sessionId);
  if (!session) {
    return;
  }
  recordAuthAuditEvent(database, {
    eventType: "auth_logout",
    payload: {
      userId: session.userId,
      username: session.username,
    },
    summaryText: "Logged out of the current authenticated session.",
  });
}

/**
 * Re-verify the configured primary factor plus TOTP for a live session and open a short freshness window.
 */

export async function stepUpSession(
  database: Database,
  input: StepUpInput,
): Promise<StepUpResult> {
  const now = nowDate(input.nowMs);
  const session = resolveSession(database, {
    nowMs: now.getTime(),
    sessionId: input.sessionId,
    touch: true,
  });
  if (!session) {
    throw new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );
  }

  const { settings } = enforceConfiguredUserById(database, session.userId, now);
  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );
  if (!primaryFactorValid) {
    const failure = incrementFailedAttempts(
      database,
      session.userId,
      settings.failedPrimaryFactorAttempts,
      now,
    );
    recordInvalidAuthAttempt(database, {
      lockedUntil: failure.lockedUntil,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        `Authentication is locked until ${failure.lockedUntil}.`,
        423,
        {
          lockedUntil: failure.lockedUntil,
        },
      );
    }

    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  const totpSecret = await decryptAuthSecret(
    settings.totpSecretCiphertext,
    buildAuthSecretOptions(input.appDataDir),
  );
  const totpValid = await verifyTotpCode(totpSecret, input.totpCode, {
    atMs: now.getTime(),
  });
  if (!totpValid) {
    recordInvalidAuthAttempt(database, {
      lockedUntil: null,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database, session.userId);
  const stepUpValidUntil = addMilliseconds(
    now,
    DEFAULT_STEP_UP_LIFETIME_MS,
  ).toISOString();
  setAuthSessionStepUpValidUntil(database, session.id, stepUpValidUntil);
  recordAuthAuditEvent(database, {
    eventType: "auth_step_up",
    payload: {
      primaryFactorType: settings.primaryFactorType,
      stepUpValidUntil,
      userId: session.userId,
      username: session.username,
    },
    summaryText:
      "Completed step-up authentication for privileged local actions.",
  });

  return {
    stepUpValidUntil,
  };
}

/**
 * Ensure the current session has a fresh step-up window for a high-risk action.
 */

export function requireFreshStepUp(
  database: Database,
  input: RequireFreshStepUpInput,
): AuthSessionRecord {
  const now = nowDate(input.nowMs);
  const session = resolveSession(database, {
    nowMs: now.getTime(),
    sessionId: input.sessionId,
    touch: true,
  });
  if (!session) {
    throw new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );
  }

  if (
    session.stepUpValidUntil &&
    Date.parse(session.stepUpValidUntil) <= now.getTime()
  ) {
    setAuthSessionStepUpValidUntil(database, session.id, null);
    session.stepUpValidUntil = null;
  }

  if (!session.stepUpValidUntil) {
    throw new AuthServiceError(
      "step_up_required",
      `A fresh step-up authentication is required to ${input.actionDescription}.`,
      403,
      {
        action: input.actionDescription,
      },
    );
  }

  return session;
}

/**
 * Create a short-lived single-use websocket ticket for an authenticated session.
 */

export function issueWebSocketTicket(
  database: Database,
  input: IssueWebSocketTicketInput,
): IssueWebSocketTicketResult {
  const now = nowDate(input.nowMs);
  const session = resolveSession(database, {
    nowMs: now.getTime(),
    sessionId: input.sessionId,
    touch: true,
  });
  if (!session) {
    throw new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );
  }

  const expiresAt = addMilliseconds(
    now,
    WEBSOCKET_TICKET_LIFETIME_MS,
  ).toISOString();
  deleteExpiredAuthWebSocketTickets(database, now.toISOString());
  const ticket = createAuthWebSocketTicket(database, {
    expiresAt,
    id: generateWebSocketTicketId(),
    issuedAt: now.toISOString(),
    sessionId: session.id,
  });

  return {
    expiresAt: ticket.expiresAt,
    ticket: ticket.id,
  };
}

/**
 * Consume a websocket ticket, ensuring it belongs to the expected live session.
 */

export function validateAndConsumeWebSocketTicket(
  database: Database,
  input: ConsumeWebSocketTicketInput,
): void {
  const now = nowDate(input.nowMs);
  const session = resolveSession(database, {
    nowMs: now.getTime(),
    sessionId: input.sessionId,
  });
  if (!session) {
    throw new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );
  }

  const ticket = getAuthWebSocketTicket(database, input.ticketId);
  if (
    !ticket ||
    ticket.sessionId !== session.id ||
    ticket.consumedAt !== null ||
    Date.parse(ticket.expiresAt) <= now.getTime()
  ) {
    throw new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );
  }

  const consumed = consumeAuthWebSocketTicket(
    database,
    ticket.id,
    now.toISOString(),
  );
  if (!consumed) {
    throw new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket has already been consumed.",
      401,
    );
  }
}
