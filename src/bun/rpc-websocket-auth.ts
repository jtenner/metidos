import { AuthServiceError, readSessionCookie } from "./auth-service";

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

export function authorizeRpcWebSocketUpgrade(options: {
  authBypass: boolean;
  cookieHeader: string | null;
  nowMs: number;
  requestUrl: string;
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
  const ticketId = new URL(options.requestUrl).searchParams.get("ticket");
  if (!sessionId || !ticketId) {
    return {
      failure: {
        body: "Authenticated websocket ticket required",
        kind: "response",
        status: 401,
      },
      ok: false,
    };
  }

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
        error,
        kind: "auth_error",
      },
      ok: false,
    };
  }

  return {
    ok: true,
    socketData: {
      authBypass: false,
      sessionId,
    },
  };
}
