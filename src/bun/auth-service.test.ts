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
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_STEP_UP_LIFETIME_MS,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  loginWithRecoveryCode,
  logout,
  prepareTotpEnrollment,
  readSessionCookie,
  requireFreshStepUp,
  resolveSession,
  setupAuth,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./auth-service";
import {
  getAuthSettings,
  listAuthRecoveryCodes,
  listSecurityAuditEvents,
  migrateDatabase,
} from "./db";

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

const LOCKOUT_SCENARIOS = [
  {
    invalidPrimaryFactor: "000000",
    name: "PIN logins",
    primaryFactor: "123456",
    primaryFactorType: "pin",
  },
  {
    invalidPrimaryFactor: "incorrect horse battery staple",
    name: "password logins",
    primaryFactor: "correct horse battery staple",
    primaryFactorType: "password",
  },
] as const;

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
      devBypass: false,
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
    });
  });

  it("reports dev bypass while preserving the real auth configuration state", async () => {
    const database = createTestDatabase();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");

    expect(
      getAuthStatus(database, null, {
        devBypass: true,
        nowMs,
      }),
    ).toEqual({
      authenticated: true,
      configured: false,
      devBypass: true,
      lockedUntil: null,
      primaryFactorType: null,
      sessionExpiresAt: null,
    });
  });

  for (const scenario of LOCKOUT_SCENARIOS) {
    it(`locks auth for ten minutes after three failed ${scenario.name}`, async () => {
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
        primaryFactor: scenario.primaryFactor,
        primaryFactorType: scenario.primaryFactorType,
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
          primaryFactor: scenario.invalidPrimaryFactor,
          totpCode: firstAttemptCode,
        }),
      ).rejects.toThrow("The provided credentials are invalid.");

      await expect(
        login(database, {
          appDataDir,
          nowMs: setupTimeMs + 2_000,
          primaryFactor: scenario.invalidPrimaryFactor,
          totpCode: firstAttemptCode,
        }),
      ).rejects.toThrow("The provided credentials are invalid.");

      await expect(
        login(database, {
          appDataDir,
          nowMs: setupTimeMs + 3_000,
          primaryFactor: scenario.invalidPrimaryFactor,
          totpCode: firstAttemptCode,
        }),
      ).rejects.toMatchObject({
        code: "auth_locked",
      } satisfies Partial<AuthServiceError>);

      await expect(
        login(database, {
          appDataDir,
          nowMs: setupTimeMs + 4_000,
          primaryFactor: scenario.primaryFactor,
          totpCode: firstAttemptCode,
        }),
      ).rejects.toMatchObject({
        code: "auth_locked",
      } satisfies Partial<AuthServiceError>);

      const successCode = await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 10 * 60 * 1000 + 4_000,
      );
      const loginResult = await login(database, {
        appDataDir,
        nowMs: setupTimeMs + 10 * 60 * 1000 + 4_000,
        primaryFactor: scenario.primaryFactor,
        totpCode: successCode,
      });
      expect(loginResult.session.id.length).toBeGreaterThan(10);
    });
  }

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

  it("authenticates with a recovery code, consumes it, and records an audit event", async () => {
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
    const recoveryCode = setupResult.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error("Expected an initial recovery code.");
    }

    const result = await loginWithRecoveryCode(database, {
      nowMs: nowMs + 1_000,
      primaryFactor: "123456",
      recoveryCode,
    });

    expect(result.session.id.length).toBeGreaterThan(10);
    expect(
      listAuthRecoveryCodes(database).some((record) => record.usedAt !== null),
    ).toBeTrue();
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "recovery_code_login",
      ),
    ).toBeTrue();

    await expect(
      loginWithRecoveryCode(database, {
        nowMs: nowMs + 2_000,
        primaryFactor: "123456",
        recoveryCode,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
  });

  it("expires idle sessions after the configured inactivity window", async () => {
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
        nowMs: nowMs + DEFAULT_SESSION_IDLE_TIMEOUT_MS - 1,
        sessionId: setupResult.session.id,
        touch: true,
      })?.id,
    ).toBe(setupResult.session.id);

    expect(
      resolveSession(database, {
        nowMs: nowMs + DEFAULT_SESSION_IDLE_TIMEOUT_MS + 1,
        sessionId: setupResult.session.id,
      })?.id,
    ).toBe(setupResult.session.id);

    expect(
      resolveSession(database, {
        nowMs: nowMs + DEFAULT_SESSION_IDLE_TIMEOUT_MS * 2 + 1,
        sessionId: setupResult.session.id,
      }),
    ).toBeNull();
  });

  it("rejects websocket tickets when the underlying session has gone idle", async () => {
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

    expect(() =>
      issueWebSocketTicket(database, {
        nowMs: nowMs + DEFAULT_SESSION_IDLE_TIMEOUT_MS + 1,
        sessionId: setupResult.session.id,
      }),
    ).toThrow("A valid authenticated session is required.");
  });

  it("requires a fresh step-up window for high-risk actions", async () => {
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

    expect(() =>
      requireFreshStepUp(database, {
        actionDescription: "run project tasks",
        nowMs: nowMs + 1_000,
        sessionId: setupResult.session.id,
      }),
    ).toThrow(
      "A fresh step-up authentication is required to run project tasks.",
    );

    const stepUpResult = await stepUpSession(database, {
      appDataDir,
      nowMs: nowMs + 2_000,
      primaryFactor: "123456",
      sessionId: setupResult.session.id,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 2_000),
    });
    expect(stepUpResult.stepUpValidUntil).toBe(
      new Date(nowMs + 2_000 + DEFAULT_STEP_UP_LIFETIME_MS).toISOString(),
    );

    expect(
      requireFreshStepUp(database, {
        actionDescription: "run project tasks",
        nowMs: nowMs + 3_000,
        sessionId: setupResult.session.id,
      }).id,
    ).toBe(setupResult.session.id);

    expect(() =>
      requireFreshStepUp(database, {
        actionDescription: "run project tasks",
        nowMs: nowMs + DEFAULT_STEP_UP_LIFETIME_MS + 3_000,
        sessionId: setupResult.session.id,
      }),
    ).toThrow(
      "A fresh step-up authentication is required to run project tasks.",
    );
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
