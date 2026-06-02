/**
 * @file src/bun/safe-outbound-fetch.ts
 * @description Shared helpers for bounded outbound fetch calls.
 */

export class SafeOutboundFetchTimeoutError extends Error {
  constructor(
    message: string,
    readonly timeoutMs: number,
  ) {
    super(message);
    this.name = "SafeOutboundFetchTimeoutError";
  }
}

export type SafeOutboundFetchFunction = (
  url: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type SafeOutboundFetchWithTimeoutInput = {
  fetch?: SafeOutboundFetchFunction;
  init?: RequestInit;
  timeoutMessage?: string;
  timeoutMs: number;
  url: string | URL;
};

function normalizeOutboundFetchTimeoutMs(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs)) {
    return 1;
  }
  return Math.max(1, Math.trunc(timeoutMs));
}

/**
 * Run an outbound fetch with a bounded request setup/response-header timeout.
 */
export async function safeOutboundFetchWithTimeout(
  input: SafeOutboundFetchWithTimeoutInput,
): Promise<Response> {
  const timeoutMs = normalizeOutboundFetchTimeoutMs(input.timeoutMs);
  const fetchImpl: SafeOutboundFetchFunction = input.fetch ?? fetch;
  const timeoutController = new AbortController();
  const originalSignal = input.init?.signal ?? null;
  const signal = originalSignal
    ? AbortSignal.any([originalSignal, timeoutController.signal])
    : timeoutController.signal;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    const timeoutReason = new SafeOutboundFetchTimeoutError(
      input.timeoutMessage ?? `Outbound fetch timed out after ${timeoutMs} ms.`,
      timeoutMs,
    );
    timeoutController.abort(timeoutReason);
  }, timeoutMs);
  // This helper is used by background share/proxy paths; the watchdog must not
  // keep the Bun process alive after all foreground work has finished. Browser
  // timers do not expose unref(), so keep this optional for test/runtime parity.
  timeout.unref?.();

  try {
    return await fetchImpl(input.url, {
      ...input.init,
      signal,
    });
  } catch (error) {
    if (timedOut) {
      // Fetch implementations do not consistently reject with signal.reason, so
      // map watchdog-triggered failures back to the helper's public typed error
      // while preserving caller-driven abort reasons via the non-timeout branch.
      throw new SafeOutboundFetchTimeoutError(
        input.timeoutMessage ??
          `Outbound fetch timed out after ${timeoutMs} ms.`,
        timeoutMs,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
