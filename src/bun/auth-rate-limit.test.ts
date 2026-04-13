/**
 * @file src/bun/auth-rate-limit.test.ts
 * @description Tests for HTTP auth-route rate limiting.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  type AuthRouteRateLimitContext,
  noteAuthRouteFailure,
  noteAuthRouteSuccess,
  readAuthRouteRateLimitStatus,
  resetAuthRouteRateLimitState,
} from "./auth-rate-limit";

const LOGIN_CONTEXT: Omit<AuthRouteRateLimitContext, "nowMs"> = {
  pathname: "/auth/login",
  peerKey: "ip:127.0.0.1",
  subjectKey: "username:alice",
};

afterEach(() => {
  resetAuthRouteRateLimitState();
});

describe("auth route rate limits", () => {
  it("locks a peer+subject after repeated failures", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        noteAuthRouteFailure({
          ...LOGIN_CONTEXT,
          nowMs: 1_000 + attempt,
        }),
      ).toBeNull();
    }

    const limited = noteAuthRouteFailure({
      ...LOGIN_CONTEXT,
      nowMs: 2_000,
    });
    expect(limited?.retryAfterSeconds).toBe(600);
    expect(
      readAuthRouteRateLimitStatus({
        ...LOGIN_CONTEXT,
        nowMs: 2_001,
      }),
    ).toMatchObject({
      retryAfterSeconds: 600,
    });
  });

  it("locks by peer even when usernames rotate", () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      expect(
        noteAuthRouteFailure({
          nowMs: 1_000 + attempt,
          pathname: "/auth/login",
          peerKey: "ip:127.0.0.1",
          subjectKey: `username:user-${attempt}`,
        }),
      ).toBeNull();
    }

    const limited = noteAuthRouteFailure({
      nowMs: 2_000,
      pathname: "/auth/login",
      peerKey: "ip:127.0.0.1",
      subjectKey: "username:fresh-user",
    });
    expect(limited?.retryAfterSeconds).toBe(600);
    expect(
      readAuthRouteRateLimitStatus({
        nowMs: 2_001,
        pathname: "/auth/login",
        peerKey: "ip:127.0.0.1",
        subjectKey: "username:anyone",
      }),
    ).toMatchObject({
      retryAfterSeconds: 600,
    });
  });

  it("clears the peer+subject bucket after a successful auth", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      noteAuthRouteFailure({
        ...LOGIN_CONTEXT,
        nowMs: 1_000 + attempt,
      });
    }

    noteAuthRouteSuccess({
      ...LOGIN_CONTEXT,
      nowMs: 2_000,
    });

    expect(
      readAuthRouteRateLimitStatus({
        ...LOGIN_CONTEXT,
        nowMs: 2_001,
      }),
    ).toBeNull();
  });
});
