/**
 * @file src/bun/rpc-websocket-abuse-control.ts
 * @description Per-connection pre-parse abuse control for RPC websocket messages.
 */

export type RpcWebSocketPreParseBudgetResult =
  | {
      allowed: true;
      remainingTokens: number;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      remainingTokens: number;
    };

export type RpcWebSocketPreParseBudgetOptions = {
  /** Maximum tokens a connection can accumulate. */
  burstTokens: number;
  /** Tokens restored per second. */
  refillTokensPerSecond: number;
  /** Bytes represented by one extra token of message cost. */
  bytesPerToken: number;
};

type RpcWebSocketPreParseBudgetBucket = {
  tokens: number;
  updatedAtMs: number;
};

const DEFAULT_OPTIONS: RpcWebSocketPreParseBudgetOptions = {
  // The browser client can legitimately multiplex polling, request bursts, and
  // cancel frames over one socket. Image turns can also be tens of megabytes
  // after base64 expansion, so keep the byte budget aligned with RPC payload
  // limits while still charging large malformed messages proportionally.
  burstTokens: 320,
  refillTokensPerSecond: 80,
  bytesPerToken: 256 * 1024,
};

function normalizeOptions(
  options: Partial<RpcWebSocketPreParseBudgetOptions>,
): RpcWebSocketPreParseBudgetOptions {
  return {
    burstTokens: Math.max(
      1,
      Math.floor(options.burstTokens ?? DEFAULT_OPTIONS.burstTokens),
    ),
    refillTokensPerSecond: Math.max(
      1,
      Math.floor(
        options.refillTokensPerSecond ?? DEFAULT_OPTIONS.refillTokensPerSecond,
      ),
    ),
    bytesPerToken: Math.max(
      1,
      Math.floor(options.bytesPerToken ?? DEFAULT_OPTIONS.bytesPerToken),
    ),
  };
}

function messageCostTokens(
  messageByteLength: number,
  bytesPerToken: number,
): number {
  const safeByteLength = Number.isFinite(messageByteLength)
    ? Math.max(0, messageByteLength)
    : Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.ceil(safeByteLength / bytesPerToken));
}

export function createRpcWebSocketPreParseBudget(
  options: Partial<RpcWebSocketPreParseBudgetOptions> = {},
): (
  connection: object,
  messageByteLength: number,
  nowMs?: number,
) => RpcWebSocketPreParseBudgetResult {
  const normalizedOptions = normalizeOptions(options);
  // ServerWebSocket object identity is the intended connection boundary here:
  // each accepted socket receives a fresh object from Bun, and WeakMap storage
  // lets closed sockets drop their abuse-control state without manual cleanup.
  // Reconnects intentionally receive a fresh parsing budget; accepted RPC
  // sockets still require an authenticated session plus a fresh single-use
  // websocket ticket, and ticket issuance is auth-route rate limited. Do not
  // key this pre-parse budget by session/user unless websocket tickets stop
  // being the reconnect throttle; keeping it per-socket avoids retaining
  // session-keyed parser state after logout or user deletion. Keep any
  // cross-reconnect throttling at the websocket-ticket/auth-route layer or the
  // RPC pending-request caps, where session revocation and cleanup are already
  // centralized.
  const buckets = new WeakMap<object, RpcWebSocketPreParseBudgetBucket>();

  return (connection, messageByteLength, nowMs = Date.now()) => {
    const existing = buckets.get(connection);
    const elapsedSeconds = existing
      ? Math.max(0, (nowMs - existing.updatedAtMs) / 1000)
      : 0;
    const tokens = Math.min(
      normalizedOptions.burstTokens,
      (existing?.tokens ?? normalizedOptions.burstTokens) +
        elapsedSeconds * normalizedOptions.refillTokensPerSecond,
    );
    const cost = messageCostTokens(
      messageByteLength,
      normalizedOptions.bytesPerToken,
    );

    if (tokens < cost) {
      buckets.set(connection, {
        tokens,
        updatedAtMs: nowMs,
      });
      return {
        allowed: false,
        remainingTokens: tokens,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((cost - tokens) / normalizedOptions.refillTokensPerSecond),
        ),
      };
    }

    const remainingTokens = tokens - cost;
    buckets.set(connection, {
      tokens: remainingTokens,
      updatedAtMs: nowMs,
    });
    return {
      allowed: true,
      remainingTokens,
    };
  };
}

export const consumeRpcWebSocketPreParseBudget =
  createRpcWebSocketPreParseBudget();
