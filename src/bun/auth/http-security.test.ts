/**
 * @file src/bun/auth/http-security.test.ts
 * @description Tests for auth-route browser-origin and CSRF request validation.
 */

import { afterEach, describe, expect, it } from "bun:test";

import {
  AUTH_CSRF_HEADER_NAME,
  enforceAuthCsrfToken,
  enforceAuthMutationRequestSecurity,
  enforceAuthReadRequestSecurity,
  RequestValidationError,
} from "./http-security";

const AUTH_CSRF_COOKIE_NAME = "metidos_csrf";
const AUTH_CSRF_HOST_COOKIE_NAME = "__Host-metidos_csrf";
const originalAllowedForwardedOrigins =
  process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;
const originalPublicOrigin = process.env.METIDOS_PUBLIC_ORIGIN;
const originalTrustProxy = process.env.METIDOS_TRUST_PROXY;

afterEach(() => {
  if (typeof originalAllowedForwardedOrigins === "string") {
    process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS =
      originalAllowedForwardedOrigins;
  } else {
    delete process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;
  }
  if (typeof originalPublicOrigin === "string") {
    process.env.METIDOS_PUBLIC_ORIGIN = originalPublicOrigin;
  } else {
    delete process.env.METIDOS_PUBLIC_ORIGIN;
  }
  if (typeof originalTrustProxy === "string") {
    process.env.METIDOS_TRUST_PROXY = originalTrustProxy;
  } else {
    delete process.env.METIDOS_TRUST_PROXY;
  }
});

function buildRequest(
  url: string,
  options?: {
    body?: string;
    headers?: HeadersInit;
    method?: string;
  },
): Request {
  return new Request(url, {
    ...(typeof options?.body === "string" ? { body: options.body } : {}),
    ...(options?.headers ? { headers: options.headers } : {}),
    method: options?.method ?? "GET",
  });
}

describe("auth HTTP security helpers", () => {
  it("allows auth read requests without browser origin headers", () => {
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status"),
      ),
    ).not.toThrow();
  });

  it("allows same-origin auth read requests", () => {
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "http://127.0.0.1:7599",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("allows configured browser origins for auth read requests", () => {
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://metidos.example.com",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        }),
        {
          allowedOrigins: new Set(["https://metidos.example.com"]),
        },
      ),
    ).not.toThrow();
  });

  it("rejects browser origins missing from the configured auth allowlist", () => {
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://other.example.com",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        }),
        {
          allowedOrigins: new Set(["https://metidos.example.com"]),
        },
      ),
    ).toThrow(RequestValidationError);
  });

  it("rejects cross-site auth read requests", () => {
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://evil.example",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
          },
        }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("ignores spoofed forwarded auth route origins by default", () => {
    delete process.env.METIDOS_TRUST_PROXY;

    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://metidos.example.com",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "metidos.example.com",
            "x-forwarded-proto": "https",
          },
        }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("allows pre-resolved trusted forwarded auth route origins", () => {
    delete process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;
    delete process.env.METIDOS_PUBLIC_ORIGIN;
    process.env.METIDOS_TRUST_PROXY = "true";

    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://metidos.example.com",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "metidos.example.com",
            "x-forwarded-proto": "https",
          },
        }),
        { expectedOrigin: "https://metidos.example.com" },
      ),
    ).not.toThrow();
  });

  it("rejects spoofed forwarded auth route origins outside the allowlist", () => {
    process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS =
      "https://metidos.example.com";
    delete process.env.METIDOS_PUBLIC_ORIGIN;
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://evil.example",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
          },
        }),
        { expectedOrigin: "https://metidos.example.com" },
      ),
    ).toThrow(RequestValidationError);
  });

  it("rejects mismatched trusted forwarded auth route origins", () => {
    delete process.env.METIDOS_ALLOWED_FORWARDED_ORIGINS;
    delete process.env.METIDOS_PUBLIC_ORIGIN;
    process.env.METIDOS_TRUST_PROXY = "true";
    expect(() =>
      enforceAuthReadRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/status", {
          headers: {
            origin: "https://metidos.example.com",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-forwarded-host": "other.example.com",
            "x-forwarded-proto": "https",
          },
        }),
        { expectedOrigin: "https://other.example.com" },
      ),
    ).toThrow(RequestValidationError);
  });

  it("rejects auth mutations without origin or fetch metadata", () => {
    expect(() =>
      enforceAuthMutationRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/login", {
          body: JSON.stringify({ username: "alice" }),
          headers: {
            cookie: `${AUTH_CSRF_COOKIE_NAME}=csrf-token`,
            "content-type": "application/json",
            [AUTH_CSRF_HEADER_NAME]: "csrf-token",
          },
          method: "POST",
        }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("requires a matching CSRF cookie and header for auth mutations", () => {
    expect(() =>
      enforceAuthMutationRequestSecurity(
        buildRequest("http://127.0.0.1:7599/auth/login", {
          body: JSON.stringify({ username: "alice" }),
          headers: {
            cookie: `${AUTH_CSRF_COOKIE_NAME}=cookie-token`,
            "content-type": "application/json",
            origin: "http://127.0.0.1:7599",
            [AUTH_CSRF_HEADER_NAME]: "header-token",
          },
          method: "POST",
        }),
      ),
    ).toThrow(RequestValidationError);
  });

  it("accepts matching CSRF cookie and header values", () => {
    expect(() =>
      enforceAuthCsrfToken(
        buildRequest("http://127.0.0.1:7599/auth/login", {
          headers: {
            cookie: `${AUTH_CSRF_COOKIE_NAME}=csrf-token`,
            [AUTH_CSRF_HEADER_NAME]: "csrf-token",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("prefers host-prefixed CSRF cookies when both names are present", () => {
    expect(() =>
      enforceAuthCsrfToken(
        buildRequest("https://metidos.example.com/auth/login", {
          headers: {
            cookie: `${AUTH_CSRF_COOKIE_NAME}=legacy-token; ${AUTH_CSRF_HOST_COOKIE_NAME}=csrf-token`,
            [AUTH_CSRF_HEADER_NAME]: "csrf-token",
          },
        }),
      ),
    ).not.toThrow();
  });

  it("rejects duplicate CSRF cookies even when one value matches the header", () => {
    expect(() =>
      enforceAuthCsrfToken(
        buildRequest("http://127.0.0.1:7599/auth/login", {
          headers: {
            cookie: `${AUTH_CSRF_COOKIE_NAME}=csrf-token; theme=dark; ${AUTH_CSRF_COOKIE_NAME}=attacker-token`,
            [AUTH_CSRF_HEADER_NAME]: "csrf-token",
          },
        }),
      ),
    ).toThrow(RequestValidationError);
  });
});
