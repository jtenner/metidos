/**
 * @file src/bun/plugin/fetch.ts
 * @description Permissioned Plugin System v1 network fetch execution.
 */

import { Buffer } from "node:buffer";
import {
  assertPrivateNetworkOutboundHttpUrl,
  assertSafeOutboundHttpUrl,
  createPrivateNetworkOutboundHttpFetch,
  createSafeOutboundHttpFetch,
  isHttpRedirectStatus,
  type ResolveHostname,
  resolveSafeRedirectUrl,
  type SafeOutboundFetch,
} from "../outbound-url-security";
import type { RpcPluginManifestNetworkSummary } from "../rpc-schema/plugin";
import {
  evaluatePluginCapability,
  type PluginCapabilityDecision,
} from "./capability-gate";
import { PluginPermissionError } from "./context";

export { PluginPermissionError };

export const DEFAULT_PLUGIN_FETCH_TIMEOUT_MS = 30_000;
// The plugin bridge returns one JSON-serializable response object, so binary
// bodies are base64-encoded and can expand to roughly 34 MiB at this 25 MiB raw
// cap before JSON/string overhead. This is an accepted desktop-app ceiling for a
// single plugin fetch response; larger transfers should use a future streaming
// or temp-file API instead of raising this materialized payload limit.
export const MAX_PLUGIN_FETCH_RESPONSE_BODY_BYTES = 25 * 1024 * 1024;
export const MAX_PLUGIN_FETCH_TEXT_RESPONSE_BODY_BYTES = 1024 * 1024;
const BASE64_BYTES_PAYLOAD_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const REDIRECT_LIMIT = 5;
const REDIRECT_SENSITIVE_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
]);
const BLOCKED_PLUGIN_FETCH_REQUEST_HEADERS = new Set([
  "connection",
  "content-length",
  "cookie",
  "cookie2",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export type PluginFetchRequestOptions = {
  body?: string | Uint8Array | ArrayBuffer | PluginFetchBytesPayload | null;
  headers?: Record<string, unknown>;
  method?: string;
};

export type PluginFetchBytesPayload = {
  __metidosBytesBase64: string;
};

export type PluginFetchResponsePayload = {
  body?: string;
  bodyBase64?: string;
  headers: Record<string, string>;
  redirected: boolean;
  status: number;
  statusText: string;
  url: string;
};

export type PluginFetchErrorCode =
  | "allowlist_denied"
  | "blocked_request_header"
  | "invalid_network_policy"
  | "invalid_request_options"
  | "network_fetch_failed"
  | "permission_denied"
  | "redirect_limit_exceeded"
  | "response_body_too_large"
  | "timeout";

export class PluginFetchError extends Error {
  readonly code: PluginFetchErrorCode;

  constructor(input: {
    cause?: unknown;
    code: PluginFetchErrorCode;
    message: string;
  }) {
    super(
      input.message,
      input.cause === undefined ? undefined : { cause: input.cause },
    );
    this.name = "PluginFetchError";
    this.code = input.code;
  }
}

export type PluginFetchContext = {
  network?: RpcPluginManifestNetworkSummary | null | undefined;
  permissions: readonly string[];
  unsafeAllowPrivateNetwork?: boolean | undefined;
};

function throwPluginFetchCapabilityError(
  decision: Exclude<PluginCapabilityDecision, { allowed: true }>,
): never {
  if (
    decision.code === "plugin_permission_error" ||
    decision.code === "plugin_unsafe_permission_required"
  ) {
    throw new PluginPermissionError({
      code: decision.code,
      message: decision.message,
      ...(decision.permission === undefined
        ? {}
        : { permission: decision.permission }),
    });
  }

  throw new PluginFetchError({
    code:
      decision.code === "invalid_network_policy"
        ? "invalid_network_policy"
        : "allowlist_denied",
    message: decision.message,
  });
}

async function assertPluginFetchUrlAllowed(
  context: PluginFetchContext,
  requestUrl: string | URL,
): Promise<URL> {
  const decision = await evaluatePluginCapability({
    context: {
      permissions: context.permissions,
      ...(context.network === undefined ? {} : { network: context.network }),
    },
    request: { kind: "network", operation: "fetch", url: requestUrl },
  });
  if (decision.allowed) {
    return decision.url ?? new URL(requestUrl);
  }
  throwPluginFetchCapabilityError(decision);
}

function normalizeRequestHeaders(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PluginFetchError({
      code: "invalid_request_options",
      message: "Plugin fetch headers must be an object.",
    });
  }

  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => {
      const headerName = key.trim();
      const normalizedHeaderName = headerName.toLowerCase();
      if (BLOCKED_PLUGIN_FETCH_REQUEST_HEADERS.has(normalizedHeaderName)) {
        throw new PluginFetchError({
          code: "blocked_request_header",
          message: `Plugin fetch cannot set blocked request header "${headerName}".`,
        });
      }
      return [headerName, String(value)];
    }),
  );
}

function decodeBase64Bytes(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !BASE64_BYTES_PAYLOAD_PATTERN.test(value)) {
    throw new PluginFetchError({
      code: "invalid_request_options",
      message: "Plugin fetch byte body must be valid base64.",
    });
  }
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch (error) {
    throw new PluginFetchError({
      cause: error,
      code: "invalid_request_options",
      message: "Plugin fetch byte body must be valid base64.",
    });
  }
}

function isPluginFetchBytesPayload(
  value: unknown,
): value is PluginFetchBytesPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).__metidosBytesBase64 === "string"
  );
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function normalizeRequestBody(input: unknown): string | ArrayBuffer {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof Uint8Array) {
    return bytesToArrayBuffer(input);
  }
  if (input instanceof ArrayBuffer) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return bytesToArrayBuffer(
      new Uint8Array(input.buffer, input.byteOffset, input.byteLength),
    );
  }
  if (isPluginFetchBytesPayload(input)) {
    return bytesToArrayBuffer(decodeBase64Bytes(input.__metidosBytesBase64));
  }
  throw new PluginFetchError({
    code: "invalid_request_options",
    message:
      "Plugin fetch body must be a string, Uint8Array, ArrayBuffer, or metidos byte payload.",
  });
}

function normalizeRequestOptions(
  input: unknown,
): RequestInit & { method?: string } {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new PluginFetchError({
      code: "invalid_request_options",
      message: "Plugin fetch options must be an object when provided.",
    });
  }

  const record = input as Record<string, unknown>;
  const output: RequestInit & { method?: string } = { redirect: "manual" };
  if (record.method !== undefined) {
    if (typeof record.method !== "string" || record.method.length === 0) {
      throw new PluginFetchError({
        code: "invalid_request_options",
        message: "Plugin fetch method must be a non-empty string.",
      });
    }
    output.method = record.method;
  }
  if (record.headers !== undefined) {
    output.headers = normalizeRequestHeaders(record.headers);
  }
  if (record.body !== undefined && record.body !== null) {
    output.body = normalizeRequestBody(record.body);
  }
  return output;
}

function stripRedirectSensitiveHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!REDIRECT_SENSITIVE_REQUEST_HEADERS.has(key.toLowerCase())) {
      output[key] = value;
    }
  }
  return output;
}

function diagnosticPluginFetchUrl(url: string | URL): string {
  const parsedUrl = url instanceof URL ? new URL(url) : new URL(url);
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.toString();
}

function pluginFetchTimeoutError(
  url: string | URL,
  timeoutMs: number,
): PluginFetchError {
  return new PluginFetchError({
    code: "timeout",
    message: `Plugin fetch timed out after ${timeoutMs}ms for ${diagnosticPluginFetchUrl(url)}.`,
  });
}

async function readResponseBodyBytes(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsedContentLength = Number(contentLength);
    if (
      Number.isFinite(parsedContentLength) &&
      parsedContentLength > maxBytes
    ) {
      throw new PluginFetchError({
        code: "response_body_too_large",
        message: `Plugin fetch response exceeded body limit of ${maxBytes} bytes.`,
      });
    }
  }

  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  // Plugin fetch currently returns a single JSON-serializable payload to the
  // QuickJS/Python sidecar bridge (`body` or `bodyBase64`), so responses remain
  // fully materialized after this bounded read. Move this path to temp-file or
  // chunked-stream delivery only with a matching sidecar API contract change.
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw new PluginFetchError({
        code: "timeout",
        message: "Plugin fetch timed out while reading the response body.",
      });
    }
    const { done, value } = await reader.read();
    if (done) {
      const output = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return output;
    }

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PluginFetchError({
        code: "response_body_too_large",
        message: `Plugin fetch response exceeded body limit of ${maxBytes} bytes.`,
      });
    }
    chunks.push(value);
  }
}

function mapSafeOutboundError(error: unknown): PluginFetchError {
  if (error instanceof PluginFetchError) {
    return error;
  }
  return new PluginFetchError({
    cause: error,
    code: "network_fetch_failed",
    message: error instanceof Error ? error.message : String(error),
  });
}

function resolvePluginFetchRedirectUrl(
  currentUrl: URL,
  locationHeader: string | null,
): URL {
  if (!locationHeader?.trim()) {
    throw new PluginFetchError({
      code: "network_fetch_failed",
      message: "Plugin fetch redirect location is missing.",
    });
  }
  try {
    return new URL(locationHeader, currentUrl);
  } catch (error) {
    throw new PluginFetchError({
      cause: error,
      code: "network_fetch_failed",
      message: "Plugin fetch redirect location is invalid.",
    });
  }
}

function isTextualResponseContentType(contentType: string | null): boolean {
  const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/javascript" ||
    normalized === "application/x-javascript" ||
    normalized === "application/xml" ||
    normalized === "application/x-www-form-urlencoded" ||
    normalized.endsWith("+json") ||
    normalized.endsWith("+xml")
  );
}

function utf8BodyForTextualResponse(
  bodyBytes: Uint8Array,
  response: Response,
): string | null {
  if (bodyBytes.byteLength > MAX_PLUGIN_FETCH_TEXT_RESPONSE_BODY_BYTES) {
    return null;
  }
  if (!isTextualResponseContentType(response.headers.get("content-type"))) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bodyBytes);
  } catch {
    return null;
  }
}

export async function executePluginFetch(input: {
  context: PluginFetchContext;
  fetch?: SafeOutboundFetch;
  maxResponseBodyBytes?: number;
  options?: unknown;
  resolveHostname?: ResolveHostname;
  timeoutMs?: number;
  unsafeAllowPrivateNetwork?: boolean | undefined;
  url: string;
}): Promise<PluginFetchResponsePayload> {
  const requestOptions = normalizeRequestOptions(input.options);
  const maxResponseBodyBytes =
    input.maxResponseBodyBytes ?? MAX_PLUGIN_FETCH_RESPONSE_BODY_BYTES;
  const timeoutMs = input.timeoutMs ?? DEFAULT_PLUGIN_FETCH_TIMEOUT_MS;
  const safeUrlOptions = {
    label: "Plugin fetch URL",
    ...(input.resolveHostname
      ? { resolveHostname: input.resolveHostname }
      : {}),
  };
  const unsafeAllowPrivateNetwork =
    input.unsafeAllowPrivateNetwork ?? input.context.unsafeAllowPrivateNetwork;
  let requestUrl = await assertPluginFetchUrlAllowed(input.context, input.url);
  if (unsafeAllowPrivateNetwork) {
    requestUrl = await assertPrivateNetworkOutboundHttpUrl(
      requestUrl.toString(),
      safeUrlOptions,
    ).catch((error) => {
      throw mapSafeOutboundError(error);
    });
  } else {
    requestUrl = await assertSafeOutboundHttpUrl(
      requestUrl.toString(),
      safeUrlOptions,
    ).catch((error) => {
      throw mapSafeOutboundError(error);
    });
  }
  const fetchUrl =
    input.fetch ??
    (unsafeAllowPrivateNetwork
      ? createPrivateNetworkOutboundHttpFetch(safeUrlOptions)
      : createSafeOutboundHttpFetch(safeUrlOptions));
  const abortController = new AbortController();
  let timeoutReached = false;
  const timeoutHandle = setTimeout(() => {
    timeoutReached = true;
    abortController.abort();
  }, timeoutMs);
  let redirected = false;

  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const outboundHeaders =
        redirectCount === 0
          ? requestOptions.headers
          : stripRedirectSensitiveHeaders(
              requestOptions.headers as Record<string, string> | undefined,
            );
      let response: Response;
      try {
        response = await fetchUrl(requestUrl, {
          ...(requestOptions.body === undefined
            ? {}
            : { body: requestOptions.body }),
          ...(outboundHeaders === undefined
            ? {}
            : { headers: outboundHeaders }),
          ...(requestOptions.method === undefined
            ? {}
            : { method: requestOptions.method }),
          redirect: "manual",
          signal: abortController.signal,
        });
      } catch (error) {
        if (timeoutReached) {
          throw pluginFetchTimeoutError(input.url, timeoutMs);
        }
        throw new PluginFetchError({
          cause: error,
          code: "network_fetch_failed",
          message: `Plugin fetch failed for ${diagnosticPluginFetchUrl(requestUrl)}: ${error instanceof Error ? error.message : String(error)}`,
        });
      }

      const nextUrl = isHttpRedirectStatus(response.status)
        ? unsafeAllowPrivateNetwork
          ? resolvePluginFetchRedirectUrl(
              requestUrl,
              response.headers.get("location"),
            )
          : await resolveSafeRedirectUrl(
              requestUrl,
              response.headers.get("location"),
              safeUrlOptions,
            ).catch((error) => {
              throw mapSafeOutboundError(error);
            })
        : null;
      if (!nextUrl) {
        let bodyBytes: Uint8Array;
        try {
          bodyBytes = await readResponseBodyBytes(
            response,
            maxResponseBodyBytes,
            abortController.signal,
          );
        } catch (error) {
          if (error instanceof PluginFetchError) {
            throw error;
          }
          if (timeoutReached) {
            throw pluginFetchTimeoutError(input.url, timeoutMs);
          }
          throw error;
        }
        const body = utf8BodyForTextualResponse(bodyBytes, response);
        return {
          ...(body === null
            ? { bodyBase64: Buffer.from(bodyBytes).toString("base64") }
            : { body }),
          headers: Object.fromEntries(response.headers.entries()),
          redirected,
          status: response.status,
          statusText: response.statusText,
          url: response.url || requestUrl.toString(),
        };
      }

      await response.body?.cancel().catch(() => undefined);
      if (redirectCount >= REDIRECT_LIMIT) {
        throw new PluginFetchError({
          code: "redirect_limit_exceeded",
          message: `Plugin fetch exceeded redirect limit of ${REDIRECT_LIMIT} for ${diagnosticPluginFetchUrl(requestUrl)}.`,
        });
      }
      redirected = true;
      requestUrl = await assertPluginFetchUrlAllowed(input.context, nextUrl);
      if (unsafeAllowPrivateNetwork) {
        requestUrl = await assertPrivateNetworkOutboundHttpUrl(
          requestUrl.toString(),
          safeUrlOptions,
        ).catch((error) => {
          throw mapSafeOutboundError(error);
        });
      } else {
        requestUrl = await assertSafeOutboundHttpUrl(
          requestUrl.toString(),
          safeUrlOptions,
        ).catch((error) => {
          throw mapSafeOutboundError(error);
        });
      }
    }
  } finally {
    clearTimeout(timeoutHandle);
  }
}
