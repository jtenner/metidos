/**
 * @file src/bun/rpc-websocket-auth.test.ts
 * @description Test file for rpc websocket auth.
 */

import { describe, expect, it, mock } from "bun:test";

import { AuthServiceError } from "./auth/service";
import {
  authorizeRpcWebSocketUpgrade,
  revalidateRpcWebSocketSession,
} from "./rpc-websocket-auth";

describe("rpc websocket auth helper", () => {
  it("rejects websocket upgrades that do not provide a session cookie", () => {
    expect(
      authorizeRpcWebSocketUpgrade({
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
        cookieHeader: "metidos_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      preAuth: {
        sessionId: "session-123",
      },
    });
    expect(validateTicket).not.toHaveBeenCalled();
  });

  it("requires websocket tickets when configured for public TLS handshakes", () => {
    expect(
      authorizeRpcWebSocketUpgrade({
        cookieHeader: "metidos_session=session-123",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requireTicket: true,
        validateTicket: () => {},
      }),
    ).toEqual({
      failure: {
        body: "WebSocket ticket required",
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
        cookieHeader:
          "metidos_session=session-123; metidos_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      preAuth: {
        sessionId: "session-123",
      },
    });
    expect(validateTicket).toHaveBeenCalledWith({
      nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
      sessionId: "session-123",
      ticketId: "ticket-456",
    });
  });

  it("rejects stale websocket ticket cookies when the session is still valid", () => {
    const error = new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        cookieHeader:
          "metidos_session=session-123; metidos_ws_ticket=ticket-456",
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

  it("rejects stale websocket tickets when tickets are required", () => {
    const error = new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        cookieHeader:
          "metidos_session=session-123; metidos_ws_ticket=ticket-456",
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        requireTicket: true,
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

  it("marks session-required failures so the caller can clear the cookie", () => {
    const error = new AuthServiceError(
      "session_required",
      "A valid authenticated session is required.",
      401,
    );

    expect(
      authorizeRpcWebSocketUpgrade({
        cookieHeader:
          "metidos_session=session-123; metidos_ws_ticket=ticket-456",
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
        cookieHeader:
          "metidos_session=session-123; metidos_ws_ticket=ticket-456",
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

  it("revalidates live websocket sessions and refreshes privilege data", () => {
    const resolveSession = mock(() => ({
      expiresAt: "2026-04-04T00:00:00.000Z",
      id: "session-123",
      isAdmin: false,
      issuedAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: "2026-04-03T00:00:00.000Z",
      sessionLifetimeDays: 1,
      stepUpValidUntil: null,
      userId: 7,
      username: "alice",
    }));

    expect(
      revalidateRpcWebSocketSession({
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        resolveSession,
        sessionId: "session-123",
      }),
    ).toEqual({
      ok: true,
      socketData: {
        isAdmin: false,
        sessionId: "session-123",
        stepUpValidUntil: null,
        userId: 7,
        username: "alice",
      },
    });
    expect(resolveSession).toHaveBeenCalledWith({
      nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
      sessionId: "session-123",
      touch: true,
    });
  });

  it("rejects stale websocket sessions during message-time revalidation", () => {
    const result = revalidateRpcWebSocketSession({
      nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
      resolveSession: () => null,
      sessionId: "session-123",
    });

    expect(result.ok).toBeFalse();
    expect(result).toMatchObject({
      failure: {
        clearSessionCookie: true,
        error: {
          code: "session_required",
        },
      },
      ok: false,
    });
  });

  it("requires current local-operator privileges when revalidating terminal websocket sessions", () => {
    const result = revalidateRpcWebSocketSession({
      nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
      requireAdmin: true,
      resolveSession: () => ({
        expiresAt: "2026-04-04T00:00:00.000Z",
        id: "session-123",
        isAdmin: false,
        issuedAt: "2026-04-03T00:00:00.000Z",
        lastUsedAt: "2026-04-03T00:00:00.000Z",
        sessionLifetimeDays: 1,
        stepUpValidUntil: null,
        userId: 7,
        username: "alice",
      }),
      sessionId: "session-123",
    });

    expect(result.ok).toBeFalse();
    expect(result).toMatchObject({
      failure: {
        clearSessionCookie: false,
        error: {
          code: "admin_required",
        },
      },
      ok: false,
    });
  });
});
