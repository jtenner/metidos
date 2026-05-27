/**
 * @file src/bun/rpc-websocket-auth.ts
 * @description Module for rpc websocket auth.
 *
 * Upgrades are accepted when a valid session cookie (`metidos_session`) is present.
 * Public TLS deployments can require a short-lived websocket ticket cookie as
 * origin/session-bound handshake hardening.
 */

import {
  AuthServiceError,
  readSessionCookie,
  readWebSocketTicketCookie,
} from "./auth/service";
import type { AuthSessionRecord } from "./db";

export type RpcWebSocketSocketData = {
  isAdmin: boolean;
  sessionId: string | null;
  stepUpValidUntil: string | null;
  userId: number | null;
  username: string | null;
};

export type RpcWebSocketPreAuth = {
  sessionId: string;
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
      preAuth: RpcWebSocketPreAuth;
    }
  | {
      failure: RpcWebSocketAuthFailure;
      ok: false;
    };

export type RpcWebSocketSessionRevalidationResult =
  | {
      ok: true;
      socketData: RpcWebSocketSocketData;
    }
  | {
      failure: {
        clearSessionCookie: boolean;
        error: unknown;
      };
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
 * Performs websocket-auth upgrade authorization.
 *
 * The request must include a valid session cookie. If a websocket ticket cookie
 * is required or present, it is validated against that session.
 * @param options - Configuration options used by this operation.
 */
export function authorizeRpcWebSocketUpgrade(options: {
  cookieHeader: string | null;
  nowMs: number;
  requireTicket?: boolean;
  validateTicket: (input: ValidateTicketInput) => void;
}): RpcWebSocketAuthResult {
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

  if (options.requireTicket && !ticketId) {
    return {
      failure: {
        body: "WebSocket ticket required",
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
    preAuth: {
      sessionId,
    },
  };
}

export function revalidateRpcWebSocketSession(options: {
  nowMs: number;
  requireAdmin?: boolean;
  resolveSession: (input: {
    nowMs: number;
    sessionId: string;
    touch: boolean;
  }) => AuthSessionRecord | null;
  sessionId: string | null;
}): RpcWebSocketSessionRevalidationResult {
  try {
    if (!options.sessionId) {
      throw new AuthServiceError(
        "session_required",
        "A valid authenticated session is required.",
        401,
      );
    }

    const session = options.resolveSession({
      nowMs: options.nowMs,
      sessionId: options.sessionId,
      touch: true,
    });
    if (!session) {
      throw new AuthServiceError(
        "session_required",
        "A valid authenticated session is required.",
        401,
      );
    }
    if (options.requireAdmin === true && !session.isAdmin) {
      throw new AuthServiceError(
        "admin_required",
        "Local operator privileges are required for this action.",
        403,
      );
    }

    return {
      ok: true,
      socketData: buildRpcSocketDataFromSession(session),
    };
  } catch (error) {
    return {
      failure: {
        clearSessionCookie:
          error instanceof AuthServiceError &&
          error.code === "session_required",
        error,
      },
      ok: false,
    };
  }
}
