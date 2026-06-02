/**
 * @file src/bun/auth/rate-limit.ts
 * @description Persistent auth-route rate limiting for local HTTP auth endpoints.
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";

import {
  getAppDatabasePath,
  resolveAppDatabaseRuntimePragmas,
  SQL_BUSY_TIMEOUT_MS,
} from "../db";

export type RateLimitedAuthPath =
  | "/auth/login"
  | "/auth/recovery-login"
  | "/auth/reset-password"
  | "/auth/reset-pin"
  | "/auth/setup"
  | "/auth/step-up"
  | "/auth/ws-ticket";

export type AuthRouteRateLimitContext = {
  // Optional for deterministic unit tests and internal replay helpers only.
  // HTTP route callers build this from Date.now(); clients never provide it.
  nowMs?: number;
  pathname: RateLimitedAuthPath;
  peerKey: string;
  subjectKey?: string | null;
};

export type AuthRouteRateLimitStatus = {
  retryAfterSeconds: number;
};

type AuthRouteRateLimitConfig = {
  lockoutMs: number;
  peerFailureLimit: number;
  subjectFailureLimit: number;
  windowMs: number;
};

type AuthRouteRateLimitBucket = {
  failuresMs: number[];
  lockedUntilMs: number | null;
};

const AUTH_ROUTE_RATE_LIMITS: Record<
  RateLimitedAuthPath,
  AuthRouteRateLimitConfig
> = {
  "/auth/login": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/recovery-login": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/setup": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/reset-password": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/reset-pin": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/step-up": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
  "/auth/ws-ticket": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
};

type RateLimitSqlRow = {
  failuresJson: string;
  lockedUntilMs: number | null;
};

const AUTH_ROUTE_RATE_LIMIT_MAX_BUCKET_AGE_MS = Math.max(
  ...Object.values(AUTH_ROUTE_RATE_LIMITS).flatMap((config) => [
    config.lockoutMs,
    config.windowMs,
  ]),
);
const AUTH_ROUTE_RATE_LIMIT_PRUNE_INTERVAL_MS =
  AUTH_ROUTE_RATE_LIMIT_MAX_BUCKET_AGE_MS;

let authRouteRateLimitDatabase: Database | null = null;
let lastAuthRouteRateLimitPruneAtMs = 0;

function authRouteRateLimitDb(): Database {
  if (!authRouteRateLimitDatabase) {
    // Use a dedicated connection so auth throttling can run before or alongside
    // higher-level auth service setup without sharing mutable transaction state
    // with login/setup flows. BEGIN IMMEDIATE plus busy_timeout serializes the
    // small bucket updates with other SQLite writers; lock contention degrades
    // availability rather than weakening brute-force protection.
    authRouteRateLimitDatabase = new Database(getAppDatabasePath(), {
      create: true,
      strict: true,
    });
    const pragmas = resolveAppDatabaseRuntimePragmas();
    authRouteRateLimitDatabase.exec("PRAGMA foreign_keys = ON");
    authRouteRateLimitDatabase.exec(
      `PRAGMA busy_timeout = ${SQL_BUSY_TIMEOUT_MS}`,
    );
    try {
      // The main app connection normally applies journal mode first. This
      // dedicated auth-throttle connection mirrors that setting when it wins
      // startup ordering, but SQLite may reject journal-mode changes while
      // another test/runtime connection is already holding the database.
      authRouteRateLimitDatabase.exec(
        `PRAGMA journal_mode = ${pragmas.journalMode.toUpperCase()}`,
      );
    } catch {
      // Do not fail startup or disable auth throttling when a concurrent
      // connection has already fixed the SQLite journal mode. The degraded
      // state is an availability concern, not a bypass: busy_timeout plus
      // BEGIN IMMEDIATE still serializes the tiny rate-limit writes.
    }
    authRouteRateLimitDatabase.exec(
      `PRAGMA synchronous = ${pragmas.synchronous}`,
    );
    authRouteRateLimitDatabase.exec(`
      CREATE TABLE IF NOT EXISTS auth_route_rate_limits (
        bucket_key TEXT PRIMARY KEY,
        failures_json TEXT NOT NULL,
        locked_until_ms INTEGER,
        updated_at_ms INTEGER NOT NULL
      )
    `);
  }
  return authRouteRateLimitDatabase;
}

function runAuthRouteRateLimitTransaction<T>(callback: () => T): T {
  const database = authRouteRateLimitDb();
  database.run("BEGIN IMMEDIATE");
  try {
    const result = callback();
    database.run("COMMIT");
    return result;
  } catch (error) {
    try {
      database.run("ROLLBACK");
    } catch {
      // Keep the original failure as the primary error.
    }
    throw error;
  }
}

function readBucketState(key: string): AuthRouteRateLimitBucket | null {
  // Failure timestamps stay in one JSON blob per scope because buckets are tiny
  // by policy (single-digit limits today) and transactionally rewriting one row
  // avoids an extra marker table on auth hot paths.
  const row = authRouteRateLimitDb()
    .query<RateLimitSqlRow, [string]>(
      `SELECT failures_json AS failuresJson, locked_until_ms AS lockedUntilMs
       FROM auth_route_rate_limits
       WHERE bucket_key = ?`,
    )
    .get(key);
  if (!row) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.failuresJson);
  } catch (error) {
    throw new Error(
      `Failed to load auth route rate-limit bucket ${key}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    failuresMs: Array.isArray(parsed)
      ? parsed.filter((entry) => typeof entry === "number")
      : [],
    lockedUntilMs:
      typeof row.lockedUntilMs === "number" ? row.lockedUntilMs : null,
  };
}

function deleteBucketState(key: string): void {
  authRouteRateLimitDb()
    .query(`DELETE FROM auth_route_rate_limits WHERE bucket_key = ?`)
    .run(key);
}

function writeBucketState(
  key: string,
  state: AuthRouteRateLimitBucket,
  updatedAtMs: number,
): void {
  authRouteRateLimitDb()
    .query(
      `INSERT INTO auth_route_rate_limits (bucket_key, failures_json, locked_until_ms, updated_at_ms)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET
         failures_json = excluded.failures_json,
         locked_until_ms = excluded.locked_until_ms,
         updated_at_ms = excluded.updated_at_ms`,
    )
    .run(
      key,
      JSON.stringify(state.failuresMs),
      state.lockedUntilMs,
      updatedAtMs,
    );
}

export function pruneExpiredAuthRouteRateLimitBuckets(
  nowMs = Date.now(),
): void {
  // Each peer/subject scope is stored in its own bucket row, so pruning one
  // expired row cannot remove another scope's active failures. Locked rows stay
  // until both their age and lockout windows have elapsed.
  const cutoffMs = nowMs - AUTH_ROUTE_RATE_LIMIT_MAX_BUCKET_AGE_MS;
  authRouteRateLimitDb()
    .query(
      `DELETE FROM auth_route_rate_limits
       WHERE updated_at_ms <= ?
         AND (locked_until_ms IS NULL OR locked_until_ms <= ?)`,
    )
    .run(cutoffMs, nowMs);
}

function maybePruneExpiredAuthRouteRateLimitBuckets(nowMs: number): void {
  if (
    lastAuthRouteRateLimitPruneAtMs !== 0 &&
    nowMs - lastAuthRouteRateLimitPruneAtMs <
      AUTH_ROUTE_RATE_LIMIT_PRUNE_INTERVAL_MS
  ) {
    return;
  }
  pruneExpiredAuthRouteRateLimitBuckets(nowMs);
  lastAuthRouteRateLimitPruneAtMs = nowMs;
}

function authRouteRateLimitBucketKey(
  context: AuthRouteRateLimitContext,
  scope: "peer" | "subject",
): string {
  // Keep auth paths partitioned: setup, login, recovery, step-up, and ticket
  // issuance have different normal traffic profiles, so a lockout on one path
  // should not consume attempts on another. Pruning is row-scoped and bounded by
  // the shared max bucket age below.
  const rawKey = `${context.pathname}:${scope}:${
    scope === "peer" ? context.peerKey : (context.subjectKey ?? "")
  }`;
  // Store fixed-size opaque bucket ids instead of raw peer/session/username
  // strings. This is not a password-equivalent secret, so a server-side pepper
  // would add key-rotation complexity without strengthening the throttling
  // decision; the hash keeps rows low-cardinality, log-safe, and free of
  // session ids or operator identifiers when support bundles include local
  // SQLite excerpts.
  return createHash("sha256").update(rawKey).digest("hex");
}

function normalizeBucketState(
  key: string,
  nowMs: number,
  windowMs: number,
): AuthRouteRateLimitBucket {
  const current = readBucketState(key);
  if (!current) {
    return {
      failuresMs: [],
      lockedUntilMs: null,
    };
  }

  const cutoffMs = nowMs - windowMs;
  const failuresMs = current.failuresMs.filter(
    (failedAtMs) => failedAtMs > cutoffMs,
  );
  const lockedUntilMs =
    typeof current.lockedUntilMs === "number" && current.lockedUntilMs > nowMs
      ? current.lockedUntilMs
      : null;

  if (failuresMs.length === 0 && lockedUntilMs === null) {
    deleteBucketState(key);
    return {
      failuresMs,
      lockedUntilMs,
    };
  }

  const normalized = {
    failuresMs,
    lockedUntilMs,
  };
  writeBucketState(key, normalized, nowMs);
  return normalized;
}

function persistBucketState(
  key: string,
  state: AuthRouteRateLimitBucket,
  nowMs: number,
): void {
  if (state.failuresMs.length === 0 && state.lockedUntilMs === null) {
    deleteBucketState(key);
    return;
  }
  writeBucketState(key, state, nowMs);
}

function readRetryAfterSeconds(lockedUntilMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000));
}

function rateLimitScopes(
  context: AuthRouteRateLimitContext,
  config: AuthRouteRateLimitConfig,
): Array<{
  key: string;
  maxFailures: number;
}> {
  const scopes = [
    {
      key: authRouteRateLimitBucketKey(context, "peer"),
      maxFailures: config.peerFailureLimit,
    },
  ];
  if (context.subjectKey) {
    scopes.push({
      key: authRouteRateLimitBucketKey(context, "subject"),
      maxFailures: config.subjectFailureLimit,
    });
  }
  return scopes;
}

function readAuthRouteRateLimitStatusInternal(
  context: AuthRouteRateLimitContext,
): AuthRouteRateLimitStatus | null {
  const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
  const nowMs = context.nowMs ?? Date.now();
  maybePruneExpiredAuthRouteRateLimitBuckets(nowMs);
  let longestLockedUntilMs: number | null = null;

  for (const scope of rateLimitScopes(context, config)) {
    const state = normalizeBucketState(scope.key, nowMs, config.windowMs);
    if (
      typeof state.lockedUntilMs === "number" &&
      (longestLockedUntilMs === null ||
        state.lockedUntilMs > longestLockedUntilMs)
    ) {
      longestLockedUntilMs = state.lockedUntilMs;
    }
  }

  if (longestLockedUntilMs === null) {
    return null;
  }

  return {
    retryAfterSeconds: readRetryAfterSeconds(longestLockedUntilMs, nowMs),
  };
}

export function readAuthRouteRateLimitStatus(
  context: AuthRouteRateLimitContext,
): AuthRouteRateLimitStatus | null {
  return runAuthRouteRateLimitTransaction(() =>
    readAuthRouteRateLimitStatusInternal(context),
  );
}

export function noteAuthRouteFailure(
  context: AuthRouteRateLimitContext,
): AuthRouteRateLimitStatus | null {
  return runAuthRouteRateLimitTransaction(() => {
    const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
    const nowMs = context.nowMs ?? Date.now();

    for (const scope of rateLimitScopes(context, config)) {
      const state = normalizeBucketState(scope.key, nowMs, config.windowMs);
      if (typeof state.lockedUntilMs === "number") {
        // A locked bucket is already at its maximum penalty. Do not extend or
        // cross-charge another scope (for example a subject behind a locked
        // shared peer IP) until the lockout window expires.
        continue;
      }

      state.failuresMs.push(nowMs);
      if (state.failuresMs.length >= scope.maxFailures) {
        state.failuresMs.length = 0;
        state.lockedUntilMs = nowMs + config.lockoutMs;
      }
      persistBucketState(scope.key, state, nowMs);
    }

    return readAuthRouteRateLimitStatusInternal({
      ...context,
      nowMs,
    });
  });
}

export function noteAuthRouteSuccess(context: AuthRouteRateLimitContext): void {
  // Success clears only the authenticated subject bucket. Peer/IP buckets are
  // intentionally left in place until their rolling window expires so one good
  // login from a shared address does not erase peer brute-force protection.
  runAuthRouteRateLimitTransaction(() => {
    const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
    const nowMs = context.nowMs ?? Date.now();
    maybePruneExpiredAuthRouteRateLimitBuckets(nowMs);

    if (!context.subjectKey) {
      return;
    }

    const subjectKey = authRouteRateLimitBucketKey(context, "subject");
    normalizeBucketState(subjectKey, nowMs, config.windowMs);
    deleteBucketState(subjectKey);
  });
}

export function noteAuthRouteAttemptSuccess(
  context: AuthRouteRateLimitContext,
): void {
  noteAuthRouteSuccess(context);
}

export function closeAuthRouteRateLimitDatabase(): void {
  if (authRouteRateLimitDatabase) {
    authRouteRateLimitDatabase.close(false);
    authRouteRateLimitDatabase = null;
  }
}

export function resetAuthRouteRateLimitState(): void {
  closeAuthRouteRateLimitDatabase();
  lastAuthRouteRateLimitPruneAtMs = 0;
  const database = authRouteRateLimitDb();
  database.exec("DELETE FROM auth_route_rate_limits");
}

export function countAuthRouteRateLimitBucketsForTest(): number {
  // Test helper intentionally calls authRouteRateLimitDb(): initializing the
  // table is the safe state for assertions after reset/close sequences.
  return (
    authRouteRateLimitDb()
      .query<{ count: number }, []>(
        "SELECT COUNT(*) AS count FROM auth_route_rate_limits",
      )
      .get()?.count ?? 0
  );
}
