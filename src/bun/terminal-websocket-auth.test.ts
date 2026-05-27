/**
 * @file src/bun/terminal-websocket-auth.test.ts
 * @description Tests for terminal websocket upgrade authorization invariants.
 */

import { describe, expect, it, mock } from "bun:test";

import { AuthServiceError } from "./auth/service";
import type { AuthSessionRecord } from "./db";
import { authorizeTerminalWebSocketUpgrade } from "./terminal-websocket-auth";

function session(
  overrides: Partial<AuthSessionRecord> = {},
): AuthSessionRecord {
  return {
    expiresAt: "2026-05-02T00:00:00.000Z",
    id: "session-1",
    isAdmin: true,
    issuedAt: "2026-05-01T00:00:00.000Z",
    lastUsedAt: "2026-05-01T00:00:00.000Z",
    stepUpValidUntil: null,
    userId: 42,
    username: "admin",
    ...overrides,
  };
}

describe("terminal websocket auth helper", () => {
  const nowMs = Date.parse("2026-05-01T00:00:00.000Z");

  it("rejects missing websocket tickets before resolving a terminal session", () => {
    const validateTicket = mock(() => {});
    const resolveSession = mock(() => session());
    const getTerminal = mock(() => ({}));

    expect(
      authorizeTerminalWebSocketUpgrade({
        cookieHeader: "metidos_session=session-1",
        getTerminal,
        nowMs,
        resolveSession,
        terminalId: "terminal-1",
        validateTicket,
      }),
    ).toEqual({
      failure: {
        body: "WebSocket ticket required",
        kind: "response",
        status: 401,
      },
      ok: false,
    });
    expect(validateTicket).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(getTerminal).not.toHaveBeenCalled();
  });

  it("rejects invalid websocket tickets before resolving a terminal session", () => {
    const error = new AuthServiceError(
      "invalid_websocket_ticket",
      "The websocket ticket is invalid or expired.",
      401,
    );
    const resolveSession = mock(() => session());
    const getTerminal = mock(() => ({}));

    expect(
      authorizeTerminalWebSocketUpgrade({
        cookieHeader: "metidos_session=session-1; metidos_ws_ticket=ticket-1",
        getTerminal,
        nowMs,
        resolveSession,
        terminalId: "terminal-1",
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
    expect(resolveSession).not.toHaveBeenCalled();
    expect(getTerminal).not.toHaveBeenCalled();
  });

  it("rejects non-privileged authenticated sessions even with a valid websocket ticket", () => {
    const validateTicket = mock(() => {});
    const resolveSession = mock(() =>
      session({ isAdmin: false, userId: 7, username: "member" }),
    );
    const getTerminal = mock(() => ({}));

    expect(
      authorizeTerminalWebSocketUpgrade({
        cookieHeader: "metidos_session=session-1; metidos_ws_ticket=ticket-1",
        getTerminal,
        nowMs,
        resolveSession,
        terminalId: "terminal-1",
        validateTicket,
      }),
    ).toEqual({
      failure: {
        body: "Local operator privileges are required for terminals.",
        kind: "response",
        status: 403,
      },
      ok: false,
    });
    expect(validateTicket).toHaveBeenCalledWith({
      nowMs,
      sessionId: "session-1",
      ticketId: "ticket-1",
    });
    expect(getTerminal).not.toHaveBeenCalled();
  });

  it("checks terminal existence only after validating ticket and local-operator session", () => {
    const validateTicket = mock(() => {});
    const resolveSession = mock(() => session({ userId: 42 }));
    const getTerminal = mock(() => ({ terminalId: "terminal-1" }));

    expect(
      authorizeTerminalWebSocketUpgrade({
        cookieHeader: "metidos_session=session-1; metidos_ws_ticket=ticket-1",
        getTerminal,
        nowMs,
        resolveSession,
        terminalId: "terminal-1",
        validateTicket,
      }),
    ).toEqual({
      ok: true,
      socketData: {
        isAdmin: true,
        sessionId: "session-1",
        stepUpValidUntil: null,
        terminalId: "terminal-1",
        userId: 42,
        username: "admin",
      },
    });
    expect(validateTicket).toHaveBeenCalled();
    expect(resolveSession).toHaveBeenCalledWith({
      nowMs,
      sessionId: "session-1",
      touch: true,
    });
    expect(getTerminal).toHaveBeenCalledWith("terminal-1");
  });
});
