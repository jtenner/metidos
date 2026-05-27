/**
 * @file src/bun/auth/rate-limit.test.ts
 * @description Tests for HTTP auth-route rate limiting.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  type AuthRouteRateLimitContext,
  countAuthRouteRateLimitBucketsForTest,
  noteAuthRouteAttemptSuccess,
  noteAuthRouteFailure,
  noteAuthRouteSuccess,
  readAuthRouteRateLimitStatus,
  resetAuthRouteRateLimitState,
} from "./rate-limit";

const LOGIN_CONTEXT: Omit<AuthRouteRateLimitContext, "nowMs"> = {
  pathname: "/auth/login",
  peerKey: "ip:127.0.0.1",
  subjectKey: "username:alice",
};

afterEach(() => {
  resetAuthRouteRateLimitState();
});

describe("auth route rate limits", () => {
  it("locks a subject after repeated failures", () => {
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

  it("locks by subject even when peers rotate", () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(
        noteAuthRouteFailure({
          nowMs: 1_000 + attempt,
          pathname: "/auth/login",
          peerKey: `ip:192.0.2.${attempt}`,
          subjectKey: "username:alice",
        }),
      ).toBeNull();
    }

    const limited = noteAuthRouteFailure({
      nowMs: 2_000,
      pathname: "/auth/login",
      peerKey: "ip:192.0.2.99",
      subjectKey: "username:alice",
    });
    expect(limited?.retryAfterSeconds).toBe(600);
    expect(
      readAuthRouteRateLimitStatus({
        nowMs: 2_001,
        pathname: "/auth/login",
        peerKey: "ip:192.0.2.100",
        subjectKey: "username:alice",
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

  it("clears the subject bucket after a successful auth", () => {
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

  it("does not count successful websocket ticket issuance as an auth failure", async () => {
    const context: AuthRouteRateLimitContext = {
      nowMs: 1_000,
      pathname: "/auth/ws-ticket",
      peerKey: "ip:127.0.0.1",
      subjectKey: "session:abc",
    };

    noteAuthRouteAttemptSuccess(context);

    expect(
      readAuthRouteRateLimitStatus({
        ...context,
        nowMs: 1_001,
      }),
    ).toBeNull();
  });

  it("keeps the peer bucket after a successful auth", () => {
    for (let attempt = 0; attempt < 11; attempt += 1) {
      noteAuthRouteFailure({
        nowMs: 1_000 + attempt,
        pathname: "/auth/login",
        peerKey: LOGIN_CONTEXT.peerKey,
        subjectKey: `username:user-${attempt}`,
      });
    }

    noteAuthRouteSuccess({
      ...LOGIN_CONTEXT,
      nowMs: 2_000,
    });

    const limited = noteAuthRouteFailure({
      nowMs: 2_001,
      pathname: "/auth/login",
      peerKey: LOGIN_CONTEXT.peerKey,
      subjectKey: "username:fresh-after-success",
    });
    expect(limited?.retryAfterSeconds).toBe(600);
  });

  it("periodically prunes stale buckets without reading each stale key", () => {
    for (let peerIndex = 0; peerIndex < 3; peerIndex += 1) {
      noteAuthRouteFailure({
        nowMs: 1_000 + peerIndex,
        pathname: "/auth/login",
        peerKey: `ip:192.0.2.${peerIndex}`,
        subjectKey: `username:stale-${peerIndex}`,
      });
    }
    expect(countAuthRouteRateLimitBucketsForTest()).toBe(6);

    expect(
      readAuthRouteRateLimitStatus({
        nowMs: 1_201_000,
        pathname: "/auth/login",
        peerKey: "ip:198.51.100.1",
        subjectKey: "username:fresh",
      }),
    ).toBeNull();

    expect(countAuthRouteRateLimitBucketsForTest()).toBe(0);
  });
});
