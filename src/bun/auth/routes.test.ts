/**
 * @file src/bun/auth/routes.test.ts
 * @description Route-level regression tests for auth HTTP security handling.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAppDatabase, resetResolvedAppDataDirectory } from "../db";

const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
let appDataDir: string | null = null;
let peerIndex = 0;
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
});
