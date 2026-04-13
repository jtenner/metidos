/**
 * @file src/bun/auth-service-session.ts
 * @description Session resolution, step-up, logout, and websocket ticket flows.
 */

import type { Database } from "bun:sqlite";

import {
  generateWebSocketTicketId,
  verifyPrimaryFactor,
  verifyTotpCode,
} from "./auth";
import { AuthSecretAccessError, decryptAuthSecret } from "./auth-secrets";
import {
  AuthServiceError,
  addMilliseconds,
  buildAuthSecretOptions,
  type ConsumeWebSocketTicketInput,
  DEFAULT_STEP_UP_LIFETIME_MS,
  enforceConfiguredUserById,
  type IssueWebSocketTicketInput,
  type IssueWebSocketTicketResult,
  incrementFailedAttempts,
  isSessionIdleExpired,
  nowDate,
  type RequireFreshStepUpInput,
  type ResolveSessionInput,
  recordAuthAuditEvent,
  recordInvalidAuthAttempt,
  type StepUpInput,
  type StepUpResult,
  WEBSOCKET_TICKET_LIFETIME_MS,
} from "./auth-service-core";
import {
  type AuthSessionRecord,
  consumeAuthWebSocketTicket,
  createAuthWebSocketTicket,
  deleteAuthSession,
  deleteExpiredAuthSessions,
  deleteExpiredAuthWebSocketTickets,
  getAuthSession,
  getAuthWebSocketTicket,
  resetAuthFailureState,
  setAuthSessionStepUpValidUntil,
  touchAuthSession,
} from "./db";

function rethrowAuthSecretError(error: unknown): never {
  if (error instanceof AuthSecretAccessError) {
    throw new AuthServiceError("auth_secret_unavailable", error.message, 503);
  }
  throw error;
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
    const failure = incrementFailedAttempts(database, session.userId, now);
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

  let totpSecret: string;
  try {
    totpSecret = await decryptAuthSecret(
      settings.totpSecretCiphertext,
      buildAuthSecretOptions(input.appDataDir),
    );
  } catch (error) {
    rethrowAuthSecretError(error);
  }
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
