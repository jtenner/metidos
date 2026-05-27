import { describe, expect, it } from "bun:test";

import { AuthServiceError } from "../auth/service";
import type { RpcRequestContext } from "../rpc-schema";
import {
  isRecentStepUpContext,
  requireRecentStepUpContext,
} from "./auth-context";

function context(stepUpValidUntil?: string | null): RpcRequestContext {
  return {
    auth: {
      isAdmin: true,
      sessionId: "session-1",
      ...(stepUpValidUntil !== undefined ? { stepUpValidUntil } : {}),
      userId: 1,
      username: "admin",
    },
    priority: "default",
    signal: new AbortController().signal,
    timeoutMs: null,
  };
}

describe("auth context step-up helpers", () => {
  const nowMs = Date.parse("2026-05-12T00:00:00.000Z");

  it("accepts sessions with an unexpired step-up timestamp", () => {
    const requestContext = context("2026-05-12T00:05:00.000Z");

    expect(isRecentStepUpContext(requestContext, nowMs)).toBeTrue();
    expect(() =>
      requireRecentStepUpContext(requestContext, nowMs),
    ).not.toThrow();
  });

  it("rejects missing, malformed, and expired step-up timestamps", () => {
    for (const invalidContext of [
      context(null),
      context(undefined),
      context("not-a-date"),
      context("2026-05-11T23:59:59.999Z"),
    ]) {
      expect(isRecentStepUpContext(invalidContext, nowMs)).toBeFalse();
      expect(() => requireRecentStepUpContext(invalidContext, nowMs)).toThrow(
        AuthServiceError,
      );
      try {
        requireRecentStepUpContext(invalidContext, nowMs);
      } catch (error) {
        expect(error).toBeInstanceOf(AuthServiceError);
        expect((error as AuthServiceError).code).toBe("step_up_required");
      }
    }
  });
});
