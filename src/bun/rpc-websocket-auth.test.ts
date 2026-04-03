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
        requestUrl: "https://localhost:7599/rpc",
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

  it("rejects websocket upgrades that do not provide both session cookie and ticket", () => {
    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: null,
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requestUrl: "https://localhost:7599/rpc",
        validateTicket: () => {},
      }),
    ).toEqual({
      failure: {
        body: "Authenticated websocket ticket required",
        kind: "response",
        status: 401,
      },
      ok: false,
    });
  });

  it("validates the websocket ticket against the current session", () => {
    const validateTicket = mock(() => {});

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requestUrl: "https://localhost:7599/rpc?ticket=ticket-456",
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

  it("marks session-required failures so the caller can clear the cookie", () => {
    const error = new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requestUrl: "https://localhost:7599/rpc?ticket=ticket-456",
        validateTicket: () => {
          throw error;
        },
      }),
    ).toEqual({
      failure: {
        clearSessionCookie: true,
        error,
        kind: "auth_error",
      },
      ok: false,
    });
  });

  it("preserves ticket failures without forcing a cookie clear", () => {
    const error = new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        authBypass: false,
        cookieHeader: "jolt_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requestUrl: "https://localhost:7599/rpc?ticket=ticket-456",
        validateTicket: () => {
          throw error;
        },
      }),
    ).toEqual({
      failure: {
        clearSessionCookie: false,
        error,
        kind: "auth_error",
      },
      ok: false,
    });
  });
});
