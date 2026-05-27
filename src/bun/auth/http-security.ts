/**
 * @file src/bun/auth/http-security.ts
 * @description Auth-route browser-origin and CSRF request validation helpers.
 */

import { resolveTrustedForwardedOrigin } from "../http-forwarded";
import { timingSafeTextDigestEqual } from "../server-security";
import { readAuthCsrfCookie } from "./service";

export const AUTH_CSRF_HEADER_NAME = "x-metidos-csrf-token";

export type AuthOriginSecurityOptions = {
  allowedOrigins?: Iterable<string>;
  /**
   * Request origin expected by the server. Callers that can inspect the
   * immediate TCP peer should resolve trusted forwarded origins before calling;
   * this helper falls back to Request.url only when no override is supplied.
   */
  expectedOrigin?: string | null | undefined;
  requireOriginWhenFetchMetadataMissing?: boolean;
};

export class RequestValidationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    options?: {
      code?: string;
      status?: number;
    },
  ) {
    super(message);
    this.name = "RequestValidationError";
    this.code = options?.code ?? "invalid_request";
    this.status = options?.status ?? 400;
  }
}

function normalizeAuthRouteOrigin(origin: string): string | null {
  try {
    // Origins must be bare scheme/host/port triples. Rejecting credentials,
    // paths, search, and hashes here catches misconfigured env allowlists early
    // and keeps comparisons exact instead of accepting URL-like endpoint values.
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function resolveExpectedAuthRouteOrigin(
  request: Request,
  options?: AuthOriginSecurityOptions,
): string | null {
  if (typeof options?.expectedOrigin === "string") {
    return normalizeAuthRouteOrigin(options.expectedOrigin);
  }

  const trustedForwardedOrigin = resolveTrustedForwardedOrigin(request);
  if (trustedForwardedOrigin) {
    return normalizeAuthRouteOrigin(trustedForwardedOrigin);
  }

  // Do not treat an arbitrary Host/X-Forwarded-* header as auth proof. Bun's
  // request URL is only a same-origin comparison target, while mutating auth
  // routes still require Fetch Metadata/Origin checks plus the double-submit
  // CSRF token before cookies can change authentication state.
  return normalizeAuthRouteOrigin(new URL(request.url).origin);
}

function isAuthRouteOriginAllowedByConfig(
  normalizedOrigin: string,
  allowedOrigins: Iterable<string> | undefined,
): boolean {
  if (!allowedOrigins) {
    return false;
  }

  for (const origin of allowedOrigins) {
    if (normalizeAuthRouteOrigin(origin) === normalizedOrigin) {
      return true;
    }
  }
  return false;
}

function requireJsonAuthRequest(request: Request): void {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestValidationError(
      'Auth requests must use "Content-Type: application/json".',
      {
        code: "invalid_content_type",
        status: 415,
      },
    );
  }
}

export function generateAuthCsrfToken(): string {
  // Buffer.from(Uint8Array) is used only as an immediate base64url encoder for
  // a fresh WebCrypto buffer; the bytes are not retained or mutated afterward.
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
}

export function enforceAuthCsrfToken(request: Request): void {
  const cookieToken = readAuthCsrfCookie(request.headers.get("cookie"));
  const headerToken = request.headers.get(AUTH_CSRF_HEADER_NAME)?.trim() ?? "";
  if (
    !cookieToken ||
    !headerToken ||
    !timingSafeTextDigestEqual(cookieToken, headerToken)
  ) {
    throw new RequestValidationError("Auth CSRF token is invalid or missing.", {
      code: "csrf_token_invalid",
      status: 403,
    });
  }
}

export function enforceAuthOriginSecurity(
  request: Request,
  options?: AuthOriginSecurityOptions,
): void {
  // Fetch Metadata is browser defense-in-depth only; non-browser clients can
  // spoof these headers, so mutation routes also require strict Origin checks
  // and a double-submit CSRF token before credentials can be changed.
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite === "cross-site") {
    throw new RequestValidationError(
      "Cross-site auth requests are not allowed.",
      {
        code: "origin_not_allowed",
        status: 403,
      },
    );
  }

  const fetchMode = request.headers.get("sec-fetch-mode")?.trim().toLowerCase();
  if (fetchMode && fetchMode !== "cors" && fetchMode !== "same-origin") {
    throw new RequestValidationError(
      "Auth requests must use a same-origin or CORS fetch mode.",
      {
        code: "origin_not_allowed",
        status: 403,
      },
    );
  }

  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    if (options?.requireOriginWhenFetchMetadataMissing === true && !fetchSite) {
      throw new RequestValidationError(
        "Auth request origin is required when fetch metadata is missing.",
        {
          code: "origin_required",
          status: 403,
        },
      );
    }
    return;
  }

  const normalizedOrigin = normalizeAuthRouteOrigin(originHeader.trim());
  const expectedOrigin = resolveExpectedAuthRouteOrigin(request, options);
  if (
    !normalizedOrigin ||
    ((!expectedOrigin || normalizedOrigin !== expectedOrigin) &&
      !isAuthRouteOriginAllowedByConfig(
        normalizedOrigin,
        options?.allowedOrigins,
      ))
  ) {
    throw new RequestValidationError("Auth request origin not allowed.", {
      code: "origin_not_allowed",
      status: 403,
    });
  }
}

export function enforceAuthMutationRequestSecurity(
  request: Request,
  options?: AuthOriginSecurityOptions,
): void {
  requireJsonAuthRequest(request);
  enforceAuthOriginSecurity(request, {
    ...options,
    requireOriginWhenFetchMetadataMissing: true,
  });
  enforceAuthCsrfToken(request);
}

export function enforceAuthReadRequestSecurity(
  request: Request,
  options?: AuthOriginSecurityOptions,
): void {
  // Read-only auth endpoints intentionally do not require CSRF tokens; mutation
  // routes must call enforceAuthMutationRequestSecurity instead.
  enforceAuthOriginSecurity(request, options);
}
