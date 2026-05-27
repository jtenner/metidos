/**
 * @file src/bun/terminal-websocket-auth.ts
 * @description Authorization helper for terminal websocket upgrades.
 *
 * Terminal websocket upgrades bridge directly to a manage-app PTY session.
 * Lower-privilege terminal access must be designed as a separate sandboxed flow
 * and must not reuse this path behind a smaller permission toggle.
 */

import { AuthServiceError } from "./auth/service";
import type { AuthSessionRecord } from "./db";
import {
  authorizeRpcWebSocketUpgrade,
  type RpcWebSocketSocketData,
} from "./rpc-websocket-auth";
import type { TerminalWebSocketData } from "./terminal-manager";

type ValidateTicketInput = {
  nowMs: number;
  sessionId: string;
  ticketId: string;
};

type TerminalWebSocketAuthFailure =
  | {
      body: string;
      kind: "response";
      status: number;
    }
  | {
      clearSessionCookie: boolean;
      clearWebSocketTicketCookie: boolean;
      error: unknown;
      kind: "auth_error";
    };

export type TerminalWebSocketAuthResult =
  | {
      ok: true;
      socketData: TerminalWebSocketData;
    }
  | {
      failure: TerminalWebSocketAuthFailure;
      ok: false;
    };

function buildRpcSocketDataFromSession(
  session: AuthSessionRecord,
): RpcWebSocketSocketData {
  return {
    isAdmin: session.isAdmin,
    sessionId: session.id,
    stepUpValidUntil: session.stepUpValidUntil,
    userId: session.userId,
    username: session.username,
  };
}

/**
 * Authorize an admin terminal websocket upgrade in the required order:
 * session cookie + single-use websocket ticket, live manage-app session, then
 * terminal existence. The terminal lookup callback must only run after the
 * manage-app invariant is established.
 * @param options - Upgrade request dependencies and terminal target.
 */
export function authorizeTerminalWebSocketUpgrade(options: {
  cookieHeader: string | null;
  getTerminal: (terminalId: string) => unknown;
  nowMs: number;
  resolveSession: (input: {
    nowMs: number;
    sessionId: string;
    touch: boolean;
  }) => AuthSessionRecord | null;
  terminalId: string;
  validateTicket: (input: ValidateTicketInput) => void;
}): TerminalWebSocketAuthResult {
  const websocketAuth = authorizeRpcWebSocketUpgrade({
    cookieHeader: options.cookieHeader,
    nowMs: options.nowMs,
    requireTicket: true,
    validateTicket: options.validateTicket,
  });
  if (!websocketAuth.ok) {
    return websocketAuth;
  }

  try {
    const session = options.resolveSession({
      nowMs: options.nowMs,
      sessionId: websocketAuth.preAuth.sessionId,
      touch: true,
    });
    if (!session) {
      throw new AuthServiceError(
        "session_required",
        "A valid authenticated session is required.",
        401,
      );
    }

    const baseData = buildRpcSocketDataFromSession(session);
    if (!baseData.isAdmin) {
      return {
        failure: {
          body: "Local operator privileges are required for terminals.",
          kind: "response",
          status: 403,
        },
        ok: false,
      };
    }

    options.getTerminal(options.terminalId);
    return {
      ok: true,
      socketData: { ...baseData, terminalId: options.terminalId },
    };
  } catch (error) {
    return {
      failure: {
        clearSessionCookie:
          error instanceof AuthServiceError &&
          error.code === "session_required",
        clearWebSocketTicketCookie: true,
        error,
        kind: "auth_error",
      },
      ok: false,
    };
  }
}
