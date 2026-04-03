import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateTotpCode } from "./auth";
import type { AuthServiceError } from "./auth-service";
import {
  buildClearedSessionCookieHeader,
  buildSessionCookieHeader,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  logout,
  prepareTotpEnrollment,
  readSessionCookie,
  resolveSession,
  setupAuth,
  validateAndConsumeWebSocketTicket,
} from "./auth-service";
import { getAuthSettings, migrateDatabase } from "./db";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "jolt-auth-service-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const database of openDatabases) {
    database.close(false);
  }
  openDatabases.clear();

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("auth service", () => {
  it("prepares TOTP enrollment material", () => {
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });

    expect(enrollment.totpSecret.length).toBeGreaterThan(0);
    expect(enrollment.totpUri).toContain("otpauth://totp/");
  });

  it("sets up auth and creates a live session", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });
    const totpCode = await generateTotpCode(enrollment.totpSecret, nowMs);

    const result = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode,
      totpSecret: enrollment.totpSecret,
    });

    expect(result.recoveryCodes).toHaveLength(10);
    expect(result.session.id.length).toBeGreaterThan(10);
    expect(getAuthSettings(database)?.totpSecretCiphertext).not.toBe(
      enrollment.totpSecret,
    );
    expect(
      getAuthStatus(database, result.session.id, {
        nowMs,
      }),
    ).toEqual({
      authenticated: true,
      configured: true,
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
    });
  });

  it("locks auth for ten minutes after three failed login attempts", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });
    const setupCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs,
    );

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode: setupCode,
      totpSecret: enrollment.totpSecret,
    });

    const firstAttemptCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs + 1_000,
    );
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 1_000,
        primaryFactor: "000000",
        totpCode: firstAttemptCode,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 2_000,
        primaryFactor: "000000",
        totpCode: firstAttemptCode,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 3_000,
        primaryFactor: "000000",
        totpCode: firstAttemptCode,
      }),
    ).rejects.toMatchObject<AuthServiceError>({
      code: "auth_locked",
    });

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 4_000,
        primaryFactor: "123456",
        totpCode: firstAttemptCode,
      }),
    ).rejects.toMatchObject<AuthServiceError>({
      code: "auth_locked",
    });

    const successCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs + 10 * 60 * 1000 + 4_000,
    );
    const loginResult = await login(database, {
      appDataDir,
      nowMs: setupTimeMs + 10 * 60 * 1000 + 4_000,
      primaryFactor: "123456",
      totpCode: successCode,
    });
    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("issues and consumes websocket tickets for valid sessions", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
    });

    const ticket = issueWebSocketTicket(database, {
      nowMs: nowMs + 500,
      sessionId: setupResult.session.id,
    });

    validateAndConsumeWebSocketTicket(database, {
      nowMs: nowMs + 1_000,
      sessionId: setupResult.session.id,
      ticketId: ticket.ticket,
    });
    expect(() =>
      validateAndConsumeWebSocketTicket(database, {
        nowMs: nowMs + 1_500,
        sessionId: setupResult.session.id,
        ticketId: ticket.ticket,
      }),
    ).toThrow("The websocket ticket is invalid or expired.");
  });

  it("serializes and clears session cookies", () => {
    const cookie = buildSessionCookieHeader("session-1", {
      maxAgeSeconds: 60,
      secure: false,
    });

    expect(readSessionCookie(cookie)).toBe("session-1");
    expect(buildClearedSessionCookieHeader(false)).toContain("Max-Age=0");
  });

  it("removes sessions on logout", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
    });

    expect(
      resolveSession(database, {
        nowMs,
        sessionId: setupResult.session.id,
      }),
    ).not.toBeNull();

    logout(database, setupResult.session.id);
    expect(
      resolveSession(database, {
        nowMs,
        sessionId: setupResult.session.id,
      }),
    ).toBeNull();
  });
});
