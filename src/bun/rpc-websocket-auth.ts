/**
 * @file src/bun/rpc-websocket-auth.ts
 * @description Module for rpc websocket auth.
 *
 * Upgrades are accepted when a valid session cookie (`jolt_session`) is present.
 * A short-lived websocket ticket cookie is an optional authentication hardening path.
 */

import {
  AuthServiceError,
  readSessionCookie,
  readWebSocketTicketCookie,
} from "./auth-service";

export type RpcWebSocketSocketData = {
  authBypass: boolean;
  sessionId: string | null;
};

type ValidateTicketInput = {
  nowMs: number;
  sessionId: string;
  ticketId: string;
};

type RpcWebSocketAuthFailure =
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

export type RpcWebSocketAuthResult =
  | {
      ok: true;
      socketData: RpcWebSocketSocketData;
    }
  | {
      failure: RpcWebSocketAuthFailure;
      ok: false;
    };

/**
 * Performs websocket-auth upgrade authorization.
 *
 * In normal mode, the request must include a valid session cookie. If a websocket
 * ticket cookie is also present, it is validated opportunistically.
 * @param options - Configuration options used by this operation.
 */
export function authorizeRpcWebSocketUpgrade(options: {
  authBypass: boolean;
  cookieHeader: string | null;
  nowMs: number;
  validateTicket: (input: ValidateTicketInput) => void;
}): RpcWebSocketAuthResult {
  if (options.authBypass) {
    return {
      ok: true,
      socketData: {
        authBypass: true,
        sessionId: null,
      },
    };
  }

  const sessionId = readSessionCookie(options.cookieHeader);
  const ticketId = readWebSocketTicketCookie(options.cookieHeader);
  if (!sessionId) {
    return {
      failure: {
        body: "Authenticated session required",
        kind: "response",
        status: 401,
      },
      ok: false,
    };
  }

  if (ticketId) {
    try {
      options.validateTicket({
        nowMs: options.nowMs,
        sessionId,
        ticketId,
      });
    } catch (error) {
      if (
        error instanceof AuthServiceError &&
        error.code === "invalid_websocket_ticket"
      ) {
        return {
          ok: true,
          socketData: {
            authBypass: false,
            sessionId,
          },
        };
      }

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

  return {
    ok: true,
    socketData: {
      authBypass: false,
      sessionId,
    },
  };
}
