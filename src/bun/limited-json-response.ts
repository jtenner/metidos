/**
 * @file src/bun/limited-json-response.ts
 * @description Bounded JSON response reader for outbound HTTP integrations.
 */

const DEFAULT_MAX_JSON_RESPONSE_BYTES = 5 * 1024 * 1024;

export type LimitedBodyErrorCode = "body_too_large";

export class LimitedBodyError extends Error {
  readonly code: LimitedBodyErrorCode;

  constructor(message: string, code: LimitedBodyErrorCode) {
    super(message);
    this.name = "LimitedBodyError";
    this.code = code;
  }
}

export type LimitedJsonResponseOptions = {
  label?: string;
  maxBytes?: number;
};

export function parseContentLengthHeader(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function maxJsonResponseBytes(options?: LimitedJsonResponseOptions): number {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_JSON_RESPONSE_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(
      "JSON response size limit must be a positive safe integer.",
    );
  }
  return maxBytes;
}

function responseLabel(options?: LimitedJsonResponseOptions): string {
  return options?.label?.trim() || "JSON response";
}

export async function readLimitedTextBody(
  body: ReadableStream<Uint8Array> | null,
  options?: LimitedJsonResponseOptions,
): Promise<string> {
  const maxBytes = maxJsonResponseBytes(options);
  const label = responseLabel(options);
  if (!body) {
    return "";
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (totalBytes + value.byteLength > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cleanup is best-effort after deciding the body is too large; keep
          // the caller-facing size-limit error as the primary failure.
        }
        throw new LimitedBodyError(`${label} is too large.`, "body_too_large");
      }
      totalBytes += value.byteLength;
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Releasing a stream reader during failure cleanup may throw if the
      // underlying stream is already closed; there is no useful recovery path.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Read and parse a JSON response while enforcing a decoded byte limit.
 *
 * The preflight Content-Length check catches obviously oversized responses, and
 * the streaming byte counter catches chunked or decompressed bodies that exceed
 * the same limit before JSON parsing allocates unbounded memory.
 */
export async function readLimitedTextResponse(
  response: Response,
  options?: LimitedJsonResponseOptions,
): Promise<string> {
  const maxBytes = maxJsonResponseBytes(options);
  const label = responseLabel(options);
  const contentLength = parseContentLengthHeader(
    response.headers.get("content-length"),
  );
  if (contentLength !== null && contentLength > maxBytes) {
    throw new LimitedBodyError(`${label} is too large.`, "body_too_large");
  }

  return readLimitedTextBody(response.body, options);
}

export async function readLimitedJsonResponse(
  response: Response,
  options?: LimitedJsonResponseOptions,
): Promise<unknown> {
  return JSON.parse(
    await readLimitedTextResponse(response, options),
  ) as unknown;
}
