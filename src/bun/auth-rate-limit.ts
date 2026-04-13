/**
 * @file src/bun/auth-rate-limit.ts
 * @description In-memory auth-route rate limiting for local HTTP auth endpoints.
 */

export type RateLimitedAuthPath =
  | "/auth/login"
  | "/auth/recovery-login"
  | "/auth/setup"
  | "/auth/step-up";

export type AuthRouteRateLimitContext = {
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
  "/auth/step-up": {
    lockoutMs: 10 * 60 * 1000,
    peerFailureLimit: 12,
    subjectFailureLimit: 6,
    windowMs: 10 * 60 * 1000,
  },
};

const authRouteRateLimitBuckets = new Map<string, AuthRouteRateLimitBucket>();

function authRouteRateLimitBucketKey(
  context: AuthRouteRateLimitContext,
  scope: "peer" | "subject",
): string {
  return `${context.pathname}:${scope}:${
    scope === "peer"
      ? context.peerKey
      : `${context.peerKey}:${context.subjectKey ?? ""}`
  }`;
}

function normalizeBucketState(
  key: string,
  nowMs: number,
  windowMs: number,
): AuthRouteRateLimitBucket {
  const current = authRouteRateLimitBuckets.get(key);
  if (!current) {
    return {
      failuresMs: [],
      lockedUntilMs: null,
    };
  }

  const failuresMs = current.failuresMs.filter(
    (failedAtMs) => failedAtMs > nowMs - windowMs,
  );
  const lockedUntilMs =
    typeof current.lockedUntilMs === "number" && current.lockedUntilMs > nowMs
      ? current.lockedUntilMs
      : null;

  if (failuresMs.length === 0 && lockedUntilMs === null) {
    authRouteRateLimitBuckets.delete(key);
    return {
      failuresMs,
      lockedUntilMs,
    };
  }

  const normalized = {
    failuresMs,
    lockedUntilMs,
  };
  authRouteRateLimitBuckets.set(key, normalized);
  return normalized;
}

function persistBucketState(
  key: string,
  state: AuthRouteRateLimitBucket,
): void {
  if (state.failuresMs.length === 0 && state.lockedUntilMs === null) {
    authRouteRateLimitBuckets.delete(key);
    return;
  }
  authRouteRateLimitBuckets.set(key, state);
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

export function readAuthRouteRateLimitStatus(
  context: AuthRouteRateLimitContext,
): AuthRouteRateLimitStatus | null {
  const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
  const nowMs = context.nowMs ?? Date.now();
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

export function noteAuthRouteFailure(
  context: AuthRouteRateLimitContext,
): AuthRouteRateLimitStatus | null {
  const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
  const nowMs = context.nowMs ?? Date.now();

  for (const scope of rateLimitScopes(context, config)) {
    const state = normalizeBucketState(scope.key, nowMs, config.windowMs);
    if (typeof state.lockedUntilMs === "number") {
      continue;
    }

    const failuresMs = [...state.failuresMs, nowMs];
    const nextState: AuthRouteRateLimitBucket =
      failuresMs.length >= scope.maxFailures
        ? {
            failuresMs: [],
            lockedUntilMs: nowMs + config.lockoutMs,
          }
        : {
            failuresMs,
            lockedUntilMs: null,
          };
    persistBucketState(scope.key, nextState);
  }

  return readAuthRouteRateLimitStatus({
    ...context,
    nowMs,
  });
}

export function noteAuthRouteSuccess(context: AuthRouteRateLimitContext): void {
  if (!context.subjectKey) {
    return;
  }
  const config = AUTH_ROUTE_RATE_LIMITS[context.pathname];
  const nowMs = context.nowMs ?? Date.now();
  const subjectKey = authRouteRateLimitBucketKey(context, "subject");
  normalizeBucketState(subjectKey, nowMs, config.windowMs);
  authRouteRateLimitBuckets.delete(subjectKey);
}

export function resetAuthRouteRateLimitState(): void {
  authRouteRateLimitBuckets.clear();
}
