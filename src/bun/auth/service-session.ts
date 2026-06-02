/**
 * @file src/bun/auth/service-session.ts
 * @description Session resolution, step-up, logout, and websocket ticket flows.
 */

import type { Database } from "bun:sqlite";
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
  tryAdvanceTotpLastUsedCounter,
  touchAuthSessionIfExpiresAfter,
} from "../db";
import {
  pruneLruMapToMaxEntries,
  readLruMapValue,
  writeLruMapValue,
} from "../lru-map";
import {
  generateWebSocketTicketId,
  parseStoredTotpSecret,
  verifyPrimaryFactor,
  verifyTotpMatchedCounter,
} from "./";
import {
  AUTH_TOTP_SECRET_PURPOSE,
  AuthSecretAccessError,
  type AuthSecretOptions,
  buildLocalOperatorAuthSecretAdditionalData,
  decryptAuthSecret,
} from "./secrets";
import {
  AuthServiceError,
  addMilliseconds,
  buildAuthSecretOptions,
  type ConsumeWebSocketTicketInput,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_STEP_UP_LIFETIME_MS,
  enforceConfiguredUserById,
  type IssueWebSocketTicketInput,
  type IssueWebSocketTicketResult,
  incrementFailedAttempts,
  isSessionIdleExpired,
  nowDate,
  type ResolveSessionInput,
  recordAuthAuditEvent,
  recordInvalidAuthAttempt,
  type StepUpInput,
  type StepUpResult,
  WEBSOCKET_TICKET_LIFETIME_MS,
} from "./service-core";

function rethrowAuthSecretError(error: unknown): never {
  if (error instanceof AuthSecretAccessError) {
    throw new AuthServiceError("auth_secret_unavailable", error.message, 503);
  }
  throw error;
}

function buildTotpAuthSecretOptions(
  _userId: number,
  appDataDir?: string,
): AuthSecretOptions {
  return {
    ...buildAuthSecretOptions(appDataDir),
    additionalData: buildLocalOperatorAuthSecretAdditionalData(
      AUTH_TOTP_SECRET_PURPOSE,
    ),
  };
}

const EXPIRED_AUTH_SESSION_SWEEP_INTERVAL_MS = 60_000;
// Persist session activity at most once per minute per session. The cached
// timestamp intentionally records the last accepted touch, not every request:
// `resolveSession()` advances it only after this interval so idle-time checks
// stay correct while hot websocket/RPC clients do not write SQLite on every
// frame.
const AUTH_SESSION_TOUCH_INTERVAL_MS = 60_000;
const AUTH_SESSION_RESOLVE_CACHE_TTL_MS = 5_000;
const MAX_AUTH_SESSION_TOUCH_CACHE_ENTRIES = 1_024;
const MAX_AUTH_SESSION_RESOLVE_CACHE_ENTRIES = 1_024;
let lastExpiredAuthSessionSweepAt = 0;
// These process-local caches are intentionally unsynchronized: Bun runs these
// HTTP/WebSocket handlers in one JS isolate/event loop, and each mutation is a
// short synchronous Map operation. Cross-process correctness still comes from
// SQLite session rows; stale resolve entries are short-lived and all local
// revocation/reset paths clear them explicitly.
const authSessionLastTouchedAtCache = new Map<string, number>();
type AuthSessionResolveCacheEntry = {
  cachedUntilMs: number;
  session: AuthSessionRecord;
};
let authSessionResolveCacheByDatabase = new WeakMap<
  Database,
  Map<string, AuthSessionResolveCacheEntry>
>();

export function clearAuthSessionTouchCache(): void {
  authSessionLastTouchedAtCache.clear();
  authSessionResolveCacheByDatabase = new WeakMap<
    Database,
    Map<string, AuthSessionResolveCacheEntry>
  >();
}

export function getAuthSessionTouchCacheSize(): number {
  return authSessionLastTouchedAtCache.size;
}

function readAuthSessionLastTouchedAt(sessionId: string): number | undefined {
  return readLruMapValue(authSessionLastTouchedAtCache, sessionId);
}

function readCachedResolvedAuthSession(
  database: Database,
  sessionId: string,
  nowMs: number,
): AuthSessionRecord | null {
  const cache = authSessionResolveCacheByDatabase.get(database);
  const entry = cache ? readLruMapValue(cache, sessionId) : undefined;
  if (!entry) {
    return null;
  }
  if (entry.cachedUntilMs <= nowMs) {
    cache?.delete(sessionId);
    return null;
  }
  return entry.session;
}

function recordResolvedAuthSession(
  database: Database,
  session: AuthSessionRecord,
  nowMs: number,
): void {
  let cache = authSessionResolveCacheByDatabase.get(database);
  if (!cache) {
    cache = new Map<string, AuthSessionResolveCacheEntry>();
    authSessionResolveCacheByDatabase.set(database, cache);
  }
  writeLruMapValue(cache, session.id, {
    cachedUntilMs: nowMs + AUTH_SESSION_RESOLVE_CACHE_TTL_MS,
    session,
  });
  pruneLruMapToMaxEntries(cache, MAX_AUTH_SESSION_RESOLVE_CACHE_ENTRIES);
}

function deleteResolvedAuthSession(
  database: Database,
  sessionId: string,
): void {
  authSessionResolveCacheByDatabase.get(database)?.delete(sessionId);
}

function recordAuthSessionTouchedAt(sessionId: string, nowMs: number): void {
  // Refresh insertion order so the bounded Map behaves as a small LRU cache;
  // pruneAuthSessionTouchCache below caps churn at MAX_AUTH_SESSION_TOUCH_CACHE_ENTRIES.
  writeLruMapValue(authSessionLastTouchedAtCache, sessionId, nowMs);
}

function updateCachedResolvedAuthSession(
  database: Database,
  sessionId: string,
  updater: (session: AuthSessionRecord) => AuthSessionRecord,
): void {
  const cache = authSessionResolveCacheByDatabase.get(database);
  if (!cache) {
    return;
  }
  const entry = cache.get(sessionId);
  if (!entry) {
    return;
  }
  entry.session = updater(entry.session);
  writeLruMapValue(cache, sessionId, entry);
}

function pruneAuthSessionTouchCache(nowMs: number): void {
  // This scan is capped by MAX_AUTH_SESSION_TOUCH_CACHE_ENTRIES and runs only
  // with the session sweep cadence, not on every websocket frame. Keeping the
  // cache bounded avoids unbounded touch-state growth while hot sessions still
  // avoid SQLite writes between touch intervals.
  const staleTouchedBeforeMs =
    nowMs -
    DEFAULT_SESSION_IDLE_TIMEOUT_MS -
    EXPIRED_AUTH_SESSION_SWEEP_INTERVAL_MS;
  for (const [sessionId, lastTouchedAtMs] of authSessionLastTouchedAtCache) {
    if (lastTouchedAtMs <= staleTouchedBeforeMs) {
      authSessionLastTouchedAtCache.delete(sessionId);
    }
  }
  pruneLruMapToMaxEntries(
    authSessionLastTouchedAtCache,
    MAX_AUTH_SESSION_TOUCH_CACHE_ENTRIES,
  );
}

function maybeDeleteExpiredAuthSessions(
  database: Database,
  nowIso: string,
  nowMs: number,
): void {
  if (
    lastExpiredAuthSessionSweepAt !== 0 &&
    nowMs - lastExpiredAuthSessionSweepAt <
      EXPIRED_AUTH_SESSION_SWEEP_INTERVAL_MS
  ) {
    return;
  }

  deleteExpiredAuthSessions(database, nowIso);
  pruneAuthSessionTouchCache(nowMs);
  lastExpiredAuthSessionSweepAt = nowMs;
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
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  maybeDeleteExpiredAuthSessions(database, nowIso, nowMs);
  // We deliberately do not add fake touch/idle work for missing ids. Session
  // ids are high-entropy bearer tokens, and auth/WebSocket routes already rate
  // limit access, so hiding row-existence timing would add database churn
  // without materially reducing a practical enumeration risk.
  const cachedSession = readCachedResolvedAuthSession(
    database,
    input.sessionId,
    nowMs,
  );
  let session: AuthSessionRecord | null;
  if (cachedSession !== null) {
    session = getAuthSession(database, input.sessionId);
    if (!session) {
      authSessionLastTouchedAtCache.delete(input.sessionId);
      deleteResolvedAuthSession(database, input.sessionId);
      return null;
    }
  } else {
    session = getAuthSession(database, input.sessionId);
    if (!session) {
      return null;
    }
  }
  recordResolvedAuthSession(database, session, nowMs);

  if (Date.parse(session.expiresAt) <= nowMs) {
    deleteAuthSession(database, session.id);
    authSessionLastTouchedAtCache.delete(session.id);
    deleteResolvedAuthSession(database, session.id);
    return null;
  }

  const persistedLastUsedAtMs = Date.parse(session.lastUsedAt);
  const lastTouchedAtMs =
    readAuthSessionLastTouchedAt(session.id) ??
    (Number.isFinite(persistedLastUsedAtMs) ? persistedLastUsedAtMs : 0);
  const sessionForIdleCheck =
    lastTouchedAtMs > persistedLastUsedAtMs
      ? {
          ...session,
          lastUsedAt: new Date(lastTouchedAtMs).toISOString(),
        }
      : session;
  if (isSessionIdleExpired(sessionForIdleCheck, now)) {
    deleteAuthSession(database, session.id);
    authSessionLastTouchedAtCache.delete(session.id);
    deleteResolvedAuthSession(database, session.id);
    return null;
  }

  if (!input.touch) {
    return sessionForIdleCheck;
  }

  if (nowMs - lastTouchedAtMs >= AUTH_SESSION_TOUCH_INTERVAL_MS) {
    if (!touchAuthSessionIfExpiresAfter(database, session.id, nowIso, nowIso)) {
      authSessionLastTouchedAtCache.delete(session.id);
      deleteResolvedAuthSession(database, session.id);
      return null;
    }
    recordAuthSessionTouchedAt(session.id, nowMs);
    pruneAuthSessionTouchCache(nowMs);
    const touchedSession = {
      ...session,
      lastUsedAt: nowIso,
    };
    recordResolvedAuthSession(database, touchedSession, nowMs);
    return touchedSession;
  }

  return sessionForIdleCheck;
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
  // Cache eviction is unconditional because logout is intentionally idempotent:
  // stale or already-expired session ids should still clear any in-memory touch
  // state, while audit events are reserved for sessions that existed at logout.
  authSessionLastTouchedAtCache.delete(sessionId);
  deleteResolvedAuthSession(database, sessionId);
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
 * Re-verify the configured primary factor plus TOTP for a live session.
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
      method: "primary_factor",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        "Too many failed authentication attempts. Try again later.",
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
      buildTotpAuthSecretOptions(session.userId, input.appDataDir),
    );
  } catch (error) {
    rethrowAuthSecretError(error);
  }
  const parsedTotpSecret = parseStoredTotpSecret(totpSecret);
  const matchedCounter = await verifyTotpMatchedCounter(
    parsedTotpSecret.secret,
    input.totpCode,
    {
      algorithm: parsedTotpSecret.algorithm,
      atMs: now.getTime(),
    },
  );
  const totpValid =
    matchedCounter !== null &&
    tryAdvanceTotpLastUsedCounter(database, matchedCounter, session.userId);
  if (!totpValid) {
    const failure = incrementFailedAttempts(database, session.userId, now);
    recordInvalidAuthAttempt(database, {
      lockedUntil: failure.lockedUntil,
      method: "totp",
      primaryFactorType: settings.primaryFactorType,
    });

    if (failure.lockedUntil) {
      throw new AuthServiceError(
        "auth_locked",
        "Too many failed authentication attempts. Try again later.",
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

  resetAuthFailureState(database, session.userId);
  const stepUpValidUntil = addMilliseconds(
    now,
    DEFAULT_STEP_UP_LIFETIME_MS,
  ).toISOString();
  setAuthSessionStepUpValidUntil(database, session.id, stepUpValidUntil);
  updateCachedResolvedAuthSession(database, session.id, (cachedSession) => ({
    ...cachedSession,
    stepUpValidUntil,
  }));
  recordAuthAuditEvent(database, {
    eventType: "auth_step_up",
    payload: {
      primaryFactorType: settings.primaryFactorType,
      stepUpValidUntil,
      userId: session.userId,
      username: session.username,
    },
    summaryText: "Completed optional step-up authentication.",
  });

  return {
    stepUpValidUntil,
  };
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
 *
 * The live-session check intentionally happens before ticket lookup so invalid
 * sessions fail closed and do not burn unrelated ticket rows. That ordering and
 * the primary-key ticket query can have observable timing differences for
 * missing sessions/tickets; this is an accepted negligible risk because both
 * values are high-entropy bearer tokens, tickets are single-use and short-lived,
 * and every successful upgrade still requires the matching live session.
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

  const nowIso = now.toISOString();
  // Consume before the WebSocket upgrade is accepted. Burning a ticket on a
  // later upgrade failure is intentional: it preserves single-use semantics for
  // bearer cookies and forces the authenticated client to mint a fresh ticket.
  const consumed = consumeAuthWebSocketTicket(database, ticket.id, nowIso, {
    expiresAfter: nowIso,
    sessionId: session.id,
  });
  if (!consumed) {
    throw new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket has already been consumed.",
      401,
    );
  }
}
