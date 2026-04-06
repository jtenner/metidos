/**
 * @file src/bun/rpc-websocket-auth.test.ts
 * @description Test file for rpc websocket auth.
 */

import { describe, expect, it, mock } from "bun:test";

import { AuthServiceError } from "./auth-service";
import { authorizeRpcWebSocketUpgrade } from "./rpc-websocket-auth";

describe("rpc websocket auth helper", () => {
  it("allows dev bypass without requiring a session cookie or ticket", () => {
    const validateTicket = mock(() => {});

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: true,
        cookieHeader: null,
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      socketData: {
        authBypass: true,
        sessionId: null,
      },
    });
    expect(validateTicket).not.toHaveBeenCalled();
  });

  it("rejects websocket upgrades that do not provide a session cookie", () => {
    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: null,
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket: () => {},
      }),
    ).toEqual({
      failure: {
        body: "Authenticated session required",
        kind: "response",
        status: 401,
      },
      ok: false,
    });
  });

  it("allows websocket upgrades with only the session cookie", () => {
    const validateTicket = mock(() => {});

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      socketData: {
        authBypass: false,
        sessionId: "session-123",
      },
    });
    expect(validateTicket).not.toHaveBeenCalled();
  });

  it("validates the websocket ticket against the current session", () => {
    const validateTicket = mock(() => {});

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123; jolt_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      socketData: {
        authBypass: false,
        sessionId: "session-123",
      },
    });
    expect(validateTicket).toHaveBeenCalledWith({
      nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
      sessionId: "session-123",
      ticketId: "ticket-456",
    });
  });

  it("ignores stale websocket ticket cookies when the session is still valid", () => {
    const error = new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123; jolt_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket: () => {
          throw error;
        },
      }),
    ).toEqual({
      ok: true,
      socketData: {
        authBypass: false,
        sessionId: "session-123",
      },
    });
  });

  it("marks session-required failures so the caller can clear the cookie", () => {
    const error = new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123; jolt_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket: () => {
          throw error;
        },
      }),
    ).toEqual({
      failure: {
        clearSessionCookie: true,
        clearWebSocketTicketCookie: true,
        error,
        kind: "auth_error",
      },
      ok: false,
    });
  });

  it("preserves non-session websocket auth failures without forcing a session cookie clear", () => {
    const error = new AuthServiceError(
      "auth_already_configured",
      "unexpected auth state",
      409,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123; jolt_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket: () => {
          throw error;
        },
      }),
    ).toEqual({
      failure: {
        clearSessionCookie: false,
        clearWebSocketTicketCookie: true,
        error,
        kind: "auth_error",
      },
      ok: false,
    });
  });
});
