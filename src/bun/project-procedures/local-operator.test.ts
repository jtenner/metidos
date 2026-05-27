import { describe, expect, it } from "bun:test";

import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";
import {
  getLocalOperatorProfile,
  getLocalOperatorState,
  localOperatorHasCapability,
  requireCalendarOperatorUserId,
  requireLocalOperatorCapability,
  requireLocalOperatorUserId,
} from "./local-operator";

function context(input?: {
  isAdmin?: boolean;
  sessionId?: string | null;
  stepUpValidUntil?: string | null;
  userId?: number | null;
  username?: string | null;
}): RpcRequestContext {
  return {
    auth: {
      isAdmin: input?.isAdmin ?? false,
      sessionId:
        input && "sessionId" in input ? (input.sessionId ?? null) : "session-1",
      ...(input?.stepUpValidUntil !== undefined
        ? { stepUpValidUntil: input.stepUpValidUntil }
        : {}),
      userId: input && "userId" in input ? (input.userId ?? null) : 1,
      username:
        input && "username" in input
          ? (input.username ?? null)
          : "local-operator",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

describe("local operator seam", () => {
  const nowMs = Date.parse("2026-05-12T00:00:00.000Z");

  it("normalizes local operator profile metadata", () => {
    expect(
      getLocalOperatorProfile(
        context({ sessionId: null, username: "  local-operator  " }),
      ),
    ).toEqual({
      sessionId: null,
      userId: 1,
      username: "local-operator",
    });
  });

  it("reports authenticated and manager capabilities for the local operator", () => {
    const state = getLocalOperatorState(
      context({
        isAdmin: true,
        stepUpValidUntil: "2026-05-12T00:05:00.000Z",
      }),
      nowMs,
    );

    expect(state.hasAuthenticatedSession).toBeTrue();
    expect(state.hasRecentStepUp).toBeTrue();
    expect(state.canManageApp).toBeTrue();
    expect(state.canUseUnsafeMode).toBeTrue();
    expect(
      localOperatorHasCapability(context({ isAdmin: true }), "manage_app"),
    ).toBeTrue();
  });

  it("rejects unauthenticated calls for operator id lookups and capabilities", () => {
    const unauthenticated = context({
      isAdmin: false,
      sessionId: null,
      userId: null,
      username: null,
    });

    expect(
      getLocalOperatorState(unauthenticated).hasAuthenticatedSession,
    ).toBeFalse();
    expect(() => requireLocalOperatorUserId(unauthenticated)).toThrow(
      AuthServiceError,
    );
    expect(() =>
      requireLocalOperatorCapability(unauthenticated, "authenticated"),
    ).toThrow(AuthServiceError);
    try {
      requireLocalOperatorCapability(unauthenticated, "authenticated");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthServiceError);
      expect((error as AuthServiceError).code).toBe("session_required");
    }
  });

  it("rejects missing, malformed, and expired step-up timestamps", () => {
    for (const invalidContext of [
      context({ isAdmin: true, stepUpValidUntil: null }),
      context({ isAdmin: true }),
      context({ isAdmin: true, stepUpValidUntil: "not-a-date" }),
      context({ isAdmin: true, stepUpValidUntil: "2026-05-11T23:59:59.999Z" }),
    ]) {
      expect(
        localOperatorHasCapability(invalidContext, "recent_step_up", nowMs),
      ).toBeFalse();
      expect(() =>
        requireLocalOperatorCapability(invalidContext, "recent_step_up", nowMs),
      ).toThrow(AuthServiceError);
    }
  });

  it("keeps unsafe mode behind the local operator capability", () => {
    const regularSession = context({ isAdmin: false });

    expect(
      localOperatorHasCapability(regularSession, "unsafe_mode"),
    ).toBeFalse();
    expect(() =>
      requireLocalOperatorCapability(regularSession, "unsafe_mode"),
    ).toThrow(AuthServiceError);
    try {
      requireLocalOperatorCapability(regularSession, "unsafe_mode");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthServiceError);
      expect((error as AuthServiceError).code).toBe("admin_required");
    }
  });

  it("preserves the calendar-specific session error", () => {
    expect(() =>
      requireCalendarOperatorUserId(
        context({ sessionId: null, userId: null, username: null }),
      ),
    ).toThrow(AuthServiceError);
    try {
      requireCalendarOperatorUserId(
        context({ sessionId: null, userId: null, username: null }),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(AuthServiceError);
      expect((error as AuthServiceError).code).toBe("session_required");
      expect((error as AuthServiceError).message).toBe(
        "A valid authenticated session is required for calendar access.",
      );
    }
  });
});
