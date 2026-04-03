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
  createAuthSession,
  createAuthWebSocketTicket,
  createSecurityAuditEvent,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  deleteExpiredAuthWebSocketTickets,
  getAuthSession,
  getAuthSettings,
  getAuthWebSocketTicket,
  listAuthRecoveryCodes,
  markAuthRecoveryCodeUsed,
  replaceAuthRecoveryCodeHashes,
  resetAuthFailureState,
  setAuthFailureState,
  setAuthSessionStepUpValidUntil,
  touchAuthSession,
  upsertAuthSettings,
} from "./db";

const SESSION_COOKIE_NAME = "jolt_session";
const SESSION_COOKIE_PATH = "/";
const DEFAULT_TOTP_ISSUER = "Jolt";
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
  };

type LoginInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
  };

type RecoveryLoginInput = TimestampOptions & {
  primaryFactor: string;
  recoveryCode: string;
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

type StepUpInput = LoginInput & {
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
  lockedUntil: string | null;
  primaryFactorType: AuthPrimaryFactorType | null;
  sessionExpiresAt: string | null;
};

type SessionCookieOptions = {
  maxAgeSeconds: number;
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
  constructor(
    readonly code:
      | "auth_already_configured"
      | "auth_not_configured"
      | "auth_locked"
      | "invalid_credentials"
      | "step_up_required"
      | "session_required"
      | "session_expired"
      | "invalid_websocket_ticket",
    message: string,
    readonly status: number,
    readonly details?: Record<string, string | null>,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

function nowDate(nowMs = Date.now()): Date {
  return new Date(nowMs);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function addMilliseconds(date: Date, milliseconds: number): Date {
  return new Date(date.getTime() + milliseconds);
}

function isSessionIdleExpired(session: AuthSessionRecord, now: Date): boolean {
  return (
    Date.parse(session.lastUsedAt) + DEFAULT_SESSION_IDLE_TIMEOUT_MS <=
    now.getTime()
  );
}

function formatHttpDate(date: Date): string {
  return date.toUTCString();
}

function normalizeSessionLifetimeDays(value?: number): number {
  if (typeof value !== "number") {
    return DEFAULT_SESSION_LIFETIME_DAYS;
  }
  if (!Number.isInteger(value) || value < 1 || value > 30) {
    throw new Error("Session lifetime must be an integer between 1 and 30.");
  }
  return value;
}

function buildTimestampOptions(nowMs?: number): TimestampOptions {
  return typeof nowMs === "number" ? { nowMs } : {};
}

function buildAuthSecretOptions(appDataDir?: string): AuthSecretOptions {
  return typeof appDataDir === "string" ? { appDataDir } : {};
}

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

function incrementFailedAttempts(
  database: Database,
  failedAttempts: number,
  now: Date,
): { lockedUntil: string | null } {
  const nextAttempts = failedAttempts + 1;
  if (nextAttempts >= LOGIN_LOCKOUT_AFTER_FAILURES) {
    const lockedUntil = addMilliseconds(
      now,
      LOGIN_LOCKOUT_WINDOW_MS,
    ).toISOString();
    setAuthFailureState(database, 0, lockedUntil);
    return {
      lockedUntil,
    };
  }

  setAuthFailureState(database, nextAttempts, null);
  return {
    lockedUntil: null,
  };
}

function readCurrentAuthSettings(
  database: Database,
  now: Date,
): ReturnType<typeof getAuthSettings> {
  const settings = getAuthSettings(database);
  if (!settings) {
    return null;
  }

  if (
    settings.lockedUntil &&
    Date.parse(settings.lockedUntil) <= now.getTime()
  ) {
    resetAuthFailureState(database);
    return getAuthSettings(database);
  }

  return settings;
}

function enforceConfigured(
  database: Database,
  now: Date,
): NonNullable<ReturnType<typeof getAuthSettings>> {
  const settings = readCurrentAuthSettings(database, now);
  if (!settings) {
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
  return settings;
}

async function createSessionRecord(
  database: Database,
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
  });
}

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
 */
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }
  return parseCookieHeaderValue(cookieHeader, SESSION_COOKIE_NAME);
}

/**
 * Serialize the authenticated session cookie.
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
 * Serialize an expired session cookie so browsers remove it immediately.
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
  const settings = readCurrentAuthSettings(database, nowDate(options.nowMs));
  const session = sessionId
    ? resolveSession(database, {
        sessionId,
        ...buildTimestampOptions(options.nowMs),
      })
    : null;

  return {
    authenticated: options.devBypass === true || session !== null,
    configured: settings !== null,
    devBypass: options.devBypass === true,
    lockedUntil: settings?.lockedUntil ?? null,
    primaryFactorType: settings?.primaryFactorType ?? null,
    sessionExpiresAt: session?.expiresAt ?? null,
  };
}

/**
 * Verify the configured primary factor and TOTP code without creating a session.
 * Shared by login, CLI recovery flows, and future step-up paths.
 */
export async function verifyPrimaryFactorAndTotp(
  database: Database,
  input: LoginInput,
): Promise<AuthSettingsRecord> {
  const now = nowDate(input.nowMs);
  const settings = enforceConfigured(database, now);

  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );
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

  if (!primaryFactorValid || !totpValid) {
    const failure = incrementFailedAttempts(
      database,
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

  resetAuthFailureState(database);
  return settings;
}

/**
 * Verify the configured primary factor and consume one recovery code in place of TOTP.
 */
export async function verifyPrimaryFactorAndRecoveryCode(
  database: Database,
  input: RecoveryLoginInput,
): Promise<AuthSettingsRecord> {
  const now = nowDate(input.nowMs);
  const settings = enforceConfigured(database, now);
  const primaryFactorValid = await verifyPrimaryFactor(
    input.primaryFactor,
    settings.primaryFactorHash,
  );

  let matchingCodeHash: string | null = null;
  if (primaryFactorValid) {
    for (const record of listAuthRecoveryCodes(database)) {
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
    const failure = incrementFailedAttempts(
      database,
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
  );
  if (!markedUsed) {
    throw new AuthServiceError(
      "invalid_credentials",
      "The provided credentials are invalid.",
      401,
    );
  }

  resetAuthFailureState(database);
  return settings;
}

/**
 * Complete first-run auth setup, persist settings, and create an authenticated session.
 */
export async function setupAuth(
  database: Database,
  input: SetupAuthInput,
): Promise<SetupAuthResult> {
  if (getAuthSettings(database)) {
    throw new AuthServiceError(
      "auth_already_configured",
      "Authentication has already been configured.",
      409,
    );
  }

  const now = nowDate(input.nowMs);
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

  const primaryFactorHash = await hashPrimaryFactor(
    input.primaryFactorType,
    input.primaryFactor,
  );
  const totpSecretCiphertext = await encryptAuthSecret(
    input.totpSecret,
    buildAuthSecretOptions(input.appDataDir),
  );
  const sessionLifetimeDays = normalizeSessionLifetimeDays(
    input.sessionLifetimeDays,
  );
  const recoveryCodes = generateRecoveryCodes();
  const recoveryCodeHashes = await Promise.all(
    recoveryCodes.map((code) => hashRecoveryCode(code)),
  );

  upsertAuthSettings(database, {
    primaryFactorHash,
    primaryFactorType: input.primaryFactorType,
    sessionLifetimeDays,
    totpSecretCiphertext,
  });
  replaceAuthRecoveryCodeHashes(database, recoveryCodeHashes);
  const session = await createSessionRecord(database, sessionLifetimeDays, now);
  recordAuthAuditEvent(database, {
    eventType: "auth_configured",
    payload: {
      primaryFactorType: input.primaryFactorType,
      sessionLifetimeDays,
    },
    summaryText:
      "Authentication was configured and the first session was created.",
  });

  return {
    recoveryCodes,
    session,
  };
}

/**
 * Authenticate a user with their primary factor and mandatory TOTP code.
 */
export async function login(
  database: Database,
  input: LoginInput,
): Promise<LoginResult> {
  const now = nowDate(input.nowMs);
  const settings = await verifyPrimaryFactorAndTotp(database, input);
  const session = await createSessionRecord(
    database,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "auth_login",
    payload: {
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
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
  const settings = await verifyPrimaryFactorAndRecoveryCode(database, input);
  const session = await createSessionRecord(
    database,
    settings.sessionLifetimeDays,
    now,
  );
  recordAuthAuditEvent(database, {
    eventType: "recovery_code_login",
    payload: {
      method: "recovery_code",
      primaryFactorType: settings.primaryFactorType,
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

  const settings = await verifyPrimaryFactorAndTotp(database, input);
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
