/**
 * @file src/bun/auth/routes.test.ts
 * @description Route-level regression tests for auth HTTP security handling.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";
import { generateTotpCode } from "./";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
let appDataDir: string | null = null;
let peerIndex = 0;
let authenticatedSessionCookie: string | null = null;
let configuredTotpSecret: string | null = null;
let initialRecoveryCode: string | null = null;
let handleAuthRequestForTest: typeof import("../index").handleAuthRequestForTest;

function buildAuthServer(
  peer = `127.0.0.${++peerIndex}`,
): Parameters<typeof handleAuthRequestForTest>[1] {
  return {
    requestIP: () => ({
      address: peer,
      family: "IPv4",
      port: 40000 + peerIndex,
    }),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function issueCsrfToken(): Promise<string> {
  const response = await handleAuthRequestForTest(
    new Request("http://127.0.0.1:7599/auth/csrf", {
      headers: {
        origin: "http://127.0.0.1:7599",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    }),
    buildAuthServer(),
  );
  expect(response).not.toBeNull();
  expect(response?.status).toBe(200);
  const body = await readJson(response!);
  expect(typeof body.csrfToken).toBe("string");
  return body.csrfToken as string;
}

function buildCsrfHeaders(
  csrfToken: string,
  extraCookies: string[] = [],
): HeadersInit {
  return {
    "content-type": "application/json",
    cookie: [`metidos_csrf=${csrfToken}`, ...extraCookies].join("; "),
    origin: "http://127.0.0.1:7599",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "x-metidos-csrf-token": csrfToken,
  };
}

function readSetCookieHeaders(response: Response | null | undefined): string[] {
  const headers = response?.headers as
    | (Headers & { getSetCookie?: () => string[] })
    | undefined;
  return (
    headers?.getSetCookie?.() ?? [response?.headers.get("set-cookie") ?? ""]
  );
}

function extractCookiePair(setCookie: string | string[], name: string): string {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const value of values) {
    const match = value.match(new RegExp(`(?:^|,\\s*)(${name}=[^;,]*)`));
    if (match?.[1]) {
      return match[1];
    }
  }
  expect(values.join(", ")).toContain(`${name}=`);
  throw new Error(`Missing ${name} cookie`);
}

beforeAll(async () => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  appDataDir = mkdtempSync(join(tmpdir(), "metidos-auth-routes-"));
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
  ({ handleAuthRequestForTest } = await import("../index"));
});

afterAll(() => {
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (appDataDir) {
    rmSync(appDataDir, { force: true, recursive: true });
  }
});

describe("auth route HTTP security", () => {
  it("rejects mutation requests with missing CSRF tokens", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/login", {
        body: JSON.stringify({ username: "alice" }),
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:7599",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "csrf_token_invalid" },
      ok: false,
    });
  });

  it("rejects mutation requests with mismatched CSRF tokens", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/login", {
        body: JSON.stringify({ username: "alice" }),
        headers: {
          "content-type": "application/json",
          cookie: "metidos_csrf=cookie-token",
          origin: "http://127.0.0.1:7599",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-metidos-csrf-token": "header-token",
        },
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "csrf_token_invalid" },
      ok: false,
    });
  });

  it("issues unauthenticated CSRF tokens with a matching cookie", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/csrf", {
        headers: {
          origin: "http://127.0.0.1:7599",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = await readJson(response!);
    expect(body.ok).toBe(true);
    expect(typeof body.csrfToken).toBe("string");
    expect((body.csrfToken as string).length).toBeGreaterThan(20);

    const csrfCookie = response?.headers.get("set-cookie") ?? "";
    expect(csrfCookie).toContain(`metidos_csrf=${body.csrfToken}`);
    expect(csrfCookie).toContain("Path=/auth");
    expect(csrfCookie).toContain("HttpOnly");
    expect(csrfCookie).toContain("SameSite=Strict");
    expect(csrfCookie).not.toContain("Secure");
  });

  it("allows CSRF-free status reads without leaking global users", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/status", {
        headers: {
          origin: "http://127.0.0.1:7599",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = await readJson(response!);
    expect(body.ok).toBe(true);
    expect(body.status).toMatchObject({ authenticated: false });
    expect(JSON.stringify(body)).not.toContain("users");
  });

  it("rejects disallowed origins even with same-origin Fetch Metadata", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/status", {
        headers: {
          origin: "https://evil.example",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "origin_not_allowed" },
      ok: false,
    });
  });

  it("rejects hostile Fetch Metadata on CSRF-free status reads", async () => {
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/status", {
        headers: {
          origin: "https://evil.example",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "cross-site",
        },
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "origin_not_allowed" },
      ok: false,
    });
  });

  it("rate-limits unauthenticated CSRF token issuance by peer", async () => {
    const server = buildAuthServer("198.51.100.44");

    let lastResponse: Response | null = null;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      lastResponse = await handleAuthRequestForTest(
        new Request("http://127.0.0.1:7599/auth/csrf", {
          headers: {
            origin: "http://127.0.0.1:7599",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        }),
        server,
      );
    }

    expect(lastResponse).not.toBeNull();
    expect(lastResponse?.status).toBe(429);
    expect(lastResponse?.headers.get("retry-after")).toBeTruthy();
    await expect(lastResponse?.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
      ok: false,
    });
  });

  it("starts auth setup without issuing session cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/setup/start", {
        body: JSON.stringify({ issuer: "Metidos Test", username: "operator" }),
        headers: buildCsrfHeaders(csrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = await readJson(response!);
    expect(body.ok).toBe(true);
    expect(body.enrollment).toMatchObject({
      totpSecret: expect.any(String),
      totpUri: expect.stringContaining("otpauth://totp/"),
    });
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("metidos_session=");
  });

  it("returns deterministic setup validation errors without session cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/setup", {
        body: JSON.stringify({ primaryFactorType: "pin" }),
        headers: buildCsrfHeaders(csrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "invalid_request" },
      ok: false,
    });
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("metidos_session=");
  });

  it("completes auth setup and sets a safe session cookie", async () => {
    const startCsrfToken = await issueCsrfToken();
    const startResponse = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/setup/start", {
        body: JSON.stringify({ username: "operator" }),
        headers: buildCsrfHeaders(startCsrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );
    expect(startResponse).not.toBeNull();
    expect(startResponse?.status).toBe(200);
    const startBody = await readJson(startResponse!);
    const enrollment = startBody.enrollment as {
      totpSecret: string;
    };

    const setupCsrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/setup", {
        body: JSON.stringify({
          primaryFactor: "482913",
          primaryFactorType: "pin",
          totpCode: await generateTotpCode(enrollment.totpSecret),
          totpSecret: enrollment.totpSecret,
          username: "operator",
        }),
        headers: buildCsrfHeaders(setupCsrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = await readJson(response!);
    expect(body.ok).toBe(true);
    expect(body.recoveryCodes).toEqual(expect.any(Array));
    const recoveryCodes = body.recoveryCodes as string[];
    expect(recoveryCodes.length).toBeGreaterThan(0);
    configuredTotpSecret = enrollment.totpSecret;
    initialRecoveryCode = recoveryCodes[0] ?? null;
    expect(body.status).toMatchObject({ authenticated: true });
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("metidos_session=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure");
    authenticatedSessionCookie = extractCookiePair(
      setCookie,
      "metidos_session",
    );
  });

  it("rejects invalid login credentials without issuing session cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/login", {
        body: JSON.stringify({
          primaryFactor: "000000",
          totpCode: "000000",
        }),
        headers: buildCsrfHeaders(csrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "invalid_credentials" },
      ok: false,
    });
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("metidos_session=");
  });

  it("logs in with TOTP and replaces a stale browser session cookie", async () => {
    const totpSecret = configuredTotpSecret;
    expect(totpSecret).toBeTruthy();
    if (!totpSecret) {
      throw new Error("Expected setup test to provide a TOTP secret");
    }

    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/login", {
        body: JSON.stringify({
          primaryFactor: "482913",
          totpCode: await generateTotpCode(totpSecret),
        }),
        headers: buildCsrfHeaders(csrfToken, ["metidos_session=stale-session"]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected login route to return a response");
    }
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({
      ok: true,
      status: { authenticated: true },
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("metidos_session=");
    expect(setCookie).not.toContain("metidos_session=stale-session");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("rejects invalid recovery login codes without issuing session cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/recovery-login", {
        body: JSON.stringify({
          primaryFactor: "482913",
          recoveryCode: "NOT-A-VALID-RECOVERY-CODE",
        }),
        headers: buildCsrfHeaders(csrfToken),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "invalid_credentials" },
      ok: false,
    });
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).not.toContain("metidos_session=");
  });

  it("logs in with a recovery code and replaces a stale browser session cookie", async () => {
    const recoveryCode = initialRecoveryCode;
    expect(recoveryCode).toBeTruthy();
    if (!recoveryCode) {
      throw new Error("Expected setup test to provide a recovery code");
    }

    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/recovery-login", {
        body: JSON.stringify({
          primaryFactor: "482913",
          recoveryCode,
        }),
        headers: buildCsrfHeaders(csrfToken, [
          "metidos_session=expired-session",
        ]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected recovery login route to return a response");
    }
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({
      ok: true,
      status: { authenticated: true },
    });
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("metidos_session=");
    expect(setCookie).not.toContain("metidos_session=expired-session");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
  });

  it("issues websocket tickets only for the current authenticated session", async () => {
    const sessionCookie = authenticatedSessionCookie;
    expect(sessionCookie).toBeTruthy();
    if (!sessionCookie) {
      throw new Error(
        "Expected setup test to provide an authenticated session cookie",
      );
    }

    const ticketCsrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/ws-ticket", {
        body: JSON.stringify({}),
        headers: buildCsrfHeaders(ticketCsrfToken, [sessionCookie]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(200);
    const body = await readJson(response!);
    expect(body).toMatchObject({
      ok: true,
      ticket: { expiresAt: expect.any(String) },
    });
    expect(JSON.stringify(body)).not.toContain("ticket-1");
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("metidos_ws_ticket=");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure");
  });

  it("rejects unauthenticated websocket ticket requests with deterministic JSON and cleared cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/ws-ticket", {
        body: JSON.stringify({}),
        headers: buildCsrfHeaders(csrfToken, ["metidos_ws_ticket=stale"]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "session_required" },
      ok: false,
    });
    const setCookies = readSetCookieHeaders(response);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_session=")),
    ).toBe(true);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_ws_ticket=")),
    ).toBe(true);
    expect(
      setCookies.filter((cookie) => cookie.includes("Max-Age=0")),
    ).toHaveLength(4);
  });

  it("rejects stale websocket ticket sessions with deterministic JSON and cleared cookies", async () => {
    const csrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/ws-ticket", {
        body: JSON.stringify({}),
        headers: buildCsrfHeaders(csrfToken, [
          "metidos_session=stale-session",
          "metidos_ws_ticket=stale-ticket",
        ]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "session_required" },
      ok: false,
    });
    const setCookies = readSetCookieHeaders(response);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_session=")),
    ).toBe(true);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_ws_ticket=")),
    ).toBe(true);
    expect(
      setCookies.filter((cookie) => cookie.includes("Max-Age=0")),
    ).toHaveLength(4);
  });

  it("logs out by clearing session, websocket-ticket cookies, and browser storage", async () => {
    const sessionCookie = authenticatedSessionCookie;
    expect(sessionCookie).toBeTruthy();
    if (!sessionCookie) {
      throw new Error(
        "Expected setup test to provide an authenticated session cookie",
      );
    }

    const ticketCsrfToken = await issueCsrfToken();
    const ticketResponse = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/ws-ticket", {
        body: JSON.stringify({}),
        headers: buildCsrfHeaders(ticketCsrfToken, [sessionCookie]),
        method: "POST",
      }),
      buildAuthServer(),
    );
    expect(ticketResponse).not.toBeNull();
    expect(ticketResponse?.status).toBe(200);
    const ticketSetCookie = ticketResponse?.headers.get("set-cookie") ?? "";
    expect(ticketSetCookie).toContain("metidos_ws_ticket=");
    const webSocketTicketCookie = extractCookiePair(
      ticketSetCookie,
      "metidos_ws_ticket",
    );

    const logoutCsrfToken = await issueCsrfToken();
    const response = await handleAuthRequestForTest(
      new Request("http://127.0.0.1:7599/auth/logout", {
        body: JSON.stringify({}),
        headers: buildCsrfHeaders(logoutCsrfToken, [
          sessionCookie,
          webSocketTicketCookie,
        ]),
        method: "POST",
      }),
      buildAuthServer(),
    );

    expect(response).not.toBeNull();
    if (!response) {
      throw new Error("Expected logout route to return a response");
    }
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(body).toMatchObject({
      ok: true,
      status: { authenticated: false },
    });
    const setCookies = readSetCookieHeaders(response);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_session=")),
    ).toBe(true);
    expect(
      setCookies.some((cookie) => cookie.startsWith("__Host-metidos_session=")),
    ).toBe(true);
    expect(
      setCookies.some((cookie) => cookie.startsWith("metidos_ws_ticket=")),
    ).toBe(true);
    expect(
      setCookies.some((cookie) =>
        cookie.startsWith("__Host-metidos_ws_ticket="),
      ),
    ).toBe(true);
    expect(
      setCookies.filter((cookie) => cookie.includes("Max-Age=0")),
    ).toHaveLength(4);
    expect(response?.headers.get("clear-site-data")).toBe(
      '"cache", "cookies", "storage"',
    );
  });
});
