/**
 * @file src/bun/auth-service.test.ts
 * @description Test file for auth service.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SESSION_LIFETIME_DAYS,
  generateTotpCode,
  hashPrimaryFactor,
} from "./auth";
import { deleteAuthSecretKey } from "./auth-secrets";
import type { AuthServiceError } from "./auth-service";
import {
  buildClearedSessionCookieHeader,
  buildClearedWebSocketTicketCookieHeader,
  buildSessionCookieHeader,
  buildWebSocketTicketCookieHeader,
  createPendingUser,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_STEP_UP_LIFETIME_MS,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  loginWithRecoveryCode,
  logout,
  prepareTotpEnrollment,
  readSessionCookie,
  readWebSocketTicketCookie,
  requireFreshStepUp,
  resolveSession,
  setupAuth,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./auth-service";
import {
  createUser,
  getAuthSettings,
  listAuthRecoveryCodes,
  listSecurityAuditEvents,
  migrateDatabase,
  upsertAuthSettings,
} from "./db";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();
const TEST_USERNAME = "alice";
const TEST_ADMIN_PIN = "48295173";
const TEST_PENDING_USER_PIN = "91582746";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-auth-service-"));
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
    invalidPrimaryFactor: "00000000",
    name: "PIN logins",
    primaryFactor: TEST_ADMIN_PIN,
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
      accountName: TEST_USERNAME,
    });

    expect(enrollment.totpSecret.length).toBeGreaterThan(0);
    expect(enrollment.totpUri).toContain("otpauth://totp/");
  });

  it("sets up auth and creates a live session", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });
    const totpCode = await generateTotpCode(enrollment.totpSecret, nowMs);

    const result = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode,
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
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
      isAdmin: true,
      knownUsernames: [TEST_USERNAME],
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
      username: TEST_USERNAME,
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
      isAdmin: false,
      knownUsernames: [],
      lockedUntil: null,
      primaryFactorType: null,
      sessionExpiresAt: null,
      username: null,
    });
  });

  for (const scenario of LOCKOUT_SCENARIOS) {
    it(`locks auth for ten minutes after three failed ${scenario.name}`, async () => {
      const database = createTestDatabase();
      const appDataDir = createTempDirectory();
      const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
      const enrollment = prepareTotpEnrollment({
        accountName: TEST_USERNAME,
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
        username: TEST_USERNAME,
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
          username: TEST_USERNAME,
        }),
      ).rejects.toThrow("The provided credentials are invalid.");

      await expect(
        login(database, {
          appDataDir,
          nowMs: setupTimeMs + 2_000,
          primaryFactor: scenario.invalidPrimaryFactor,
          totpCode: firstAttemptCode,
          username: TEST_USERNAME,
        }),
      ).rejects.toThrow("The provided credentials are invalid.");

      await expect(
        login(database, {
          appDataDir,
          nowMs: setupTimeMs + 3_000,
          primaryFactor: scenario.invalidPrimaryFactor,
          totpCode: firstAttemptCode,
          username: TEST_USERNAME,
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
          username: TEST_USERNAME,
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
        username: TEST_USERNAME,
      });
      expect(loginResult.session.id.length).toBeGreaterThan(10);
      const failureEvents = listSecurityAuditEvents(database).filter(
        (event) =>
          event.eventType === "auth_invalid_credentials" ||
          event.eventType === "auth_lockout_started",
      );
      expect(
        failureEvents.filter(
          (event) => event.eventType === "auth_invalid_credentials",
        ),
      ).toHaveLength(2);
      expect(
        failureEvents.filter(
          (event) => event.eventType === "auth_lockout_started",
        ),
      ).toHaveLength(1);
      expect(failureEvents[0]?.payloadJson).toContain('"method":"totp"');
    });
  }

  it("locks auth after three concurrent invalid primary-factor attempts", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    const attemptTimeMs = setupTimeMs + 1_000;
    const attemptCode = await generateTotpCode(
      enrollment.totpSecret,
      attemptTimeMs,
    );
    const results = await Promise.allSettled([
      login(database, {
        appDataDir,
        nowMs: attemptTimeMs,
        primaryFactor: "00000000",
        totpCode: attemptCode,
        username: TEST_USERNAME,
      }),
      login(database, {
        appDataDir,
        nowMs: attemptTimeMs,
        primaryFactor: "00000000",
        totpCode: attemptCode,
        username: TEST_USERNAME,
      }),
      login(database, {
        appDataDir,
        nowMs: attemptTimeMs,
        primaryFactor: "00000000",
        totpCode: attemptCode,
        username: TEST_USERNAME,
      }),
    ]);

    expect(
      results.filter(
        (entry) =>
          entry.status === "rejected" && entry.reason?.code === "auth_locked",
      ),
    ).toHaveLength(1);
    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(0);
    expect(getAuthSettings(database)?.lockedUntil).toBe(
      new Date(attemptTimeMs + 10 * 60 * 1000).toISOString(),
    );
    expect(
      listSecurityAuditEvents(database).filter(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toHaveLength(1);
  });

  it("surfaces a clear auth-secret lifecycle error when the key file is lost", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    expect(deleteAuthSecretKey({ appDataDir })).toBeTrue();

    await expect(
      login(database, {
        appDataDir,
        nowMs: nowMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 1_000),
        username: TEST_USERNAME,
      }),
    ).rejects.toMatchObject({
      code: "auth_secret_unavailable",
    } satisfies Partial<AuthServiceError>);
  });

  it("does not lock out for invalid TOTP when the primary factor is correct", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });
    const setupCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs,
    );

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: setupCode,
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    const validTotp = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs + 1_000,
    );
    const invalidTotp =
      validTotp === "000000" || validTotp === "111111" ? "222222" : "111111";

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: invalidTotp,
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: invalidTotp,
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 3_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: invalidTotp,
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(0);
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toBeFalse();

    const successCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs + 4_000,
    );
    const loginResult = await login(database, {
      appDataDir,
      nowMs: setupTimeMs + 4_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: successCode,
      username: TEST_USERNAME,
    });
    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("does not lock out for invalid recovery code when the primary factor is correct", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });
    const setupCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs,
    );

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: setupCode,
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-1",
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-2",
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 3_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-3",
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(0);
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toBeFalse();
  });

  it("allows an admin-created pending user to finish auth setup", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const adminEnrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(adminEnrollment.totpSecret, setupTimeMs),
      totpSecret: adminEnrollment.totpSecret,
      username: TEST_USERNAME,
    });

    await createPendingUser(database, {
      actorUserId: 1,
      actorUsername: TEST_USERNAME,
      pin: TEST_PENDING_USER_PIN,
      username: "bob",
    });
    const invitedEnrollment = prepareTotpEnrollment({
      accountName: "bob",
    });

    const invitedResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs + 1_000,
      primaryFactor: TEST_PENDING_USER_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(
        invitedEnrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
      totpSecret: invitedEnrollment.totpSecret,
      username: "bob",
    });

    expect(invitedResult.session.username).toBe("bob");
    expect(invitedResult.session.isAdmin).toBeFalse();
    expect(getAuthSettings(database, invitedResult.session.userId)).toEqual(
      expect.objectContaining({
        primaryFactorType: "pin",
        userId: invitedResult.session.userId,
      }),
    );
  });

  it("rejects new setup usernames that cannot own private workspace homes", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "alice/unsafe",
    });

    await expect(
      setupAuth(database, {
        appDataDir,
        nowMs,
        primaryFactor: TEST_ADMIN_PIN,
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
        totpSecret: enrollment.totpSecret,
        username: "alice/unsafe",
      }),
    ).rejects.toMatchObject({
      code: "invalid_username",
    } satisfies Partial<AuthServiceError>);
  });

  it("still lets a legacy pending username finish first-run setup", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const legacyUsername = "legacy/user";
    const legacyUser = createUser(database, {
      isAdmin: false,
      username: legacyUsername,
    });
    upsertAuthSettings(database, {
      primaryFactorHash: await hashPrimaryFactor("pin", TEST_PENDING_USER_PIN),
      primaryFactorType: "pin",
      sessionLifetimeDays: DEFAULT_SESSION_LIFETIME_DAYS,
      totpSecretCiphertext: "",
      userId: legacyUser.id,
    });
    const enrollment = prepareTotpEnrollment({
      accountName: legacyUsername,
    });

    const result = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_PENDING_USER_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: legacyUsername,
    });

    expect(
      getAuthStatus(database, result.session.id, {
        nowMs,
      }),
    ).toEqual({
      authenticated: true,
      configured: true,
      devBypass: false,
      isAdmin: false,
      knownUsernames: [legacyUsername],
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
      username: legacyUsername,
    });
  });

  it("rejects self-service setup for unknown usernames after the primary user exists", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const adminEnrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(adminEnrollment.totpSecret, setupTimeMs),
      totpSecret: adminEnrollment.totpSecret,
      username: TEST_USERNAME,
    });

    const invitedEnrollment = prepareTotpEnrollment({
      accountName: "charlie",
    });

    await expect(
      setupAuth(database, {
        appDataDir,
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_PENDING_USER_PIN,
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(
          invitedEnrollment.totpSecret,
          setupTimeMs + 1_000,
        ),
        totpSecret: invitedEnrollment.totpSecret,
        username: "charlie",
      }),
    ).rejects.toMatchObject({
      code: "admin_required",
    } satisfies Partial<AuthServiceError>);
  });

  it("rejects pending-user creation for usernames that cannot own private workspace homes", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const adminEnrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(adminEnrollment.totpSecret, setupTimeMs),
      totpSecret: adminEnrollment.totpSecret,
      username: TEST_USERNAME,
    });

    await expect(
      createPendingUser(database, {
        actorUserId: 1,
        actorUsername: TEST_USERNAME,
        pin: TEST_PENDING_USER_PIN,
        username: "bob/unsafe",
      }),
    ).rejects.toMatchObject({
      code: "invalid_username",
    } satisfies Partial<AuthServiceError>);
  });

  it("redirects a pending invited user into TOTP setup on first login", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const adminEnrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const adminSetup = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(adminEnrollment.totpSecret, setupTimeMs),
      totpSecret: adminEnrollment.totpSecret,
      username: TEST_USERNAME,
    });

    await createPendingUser(database, {
      actorUserId: adminSetup.session.userId,
      actorUsername: adminSetup.session.username,
      pin: TEST_PENDING_USER_PIN,
      username: "bob",
    });

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_PENDING_USER_PIN,
        totpCode: "",
        username: "bob",
      }),
    ).rejects.toMatchObject({
      code: "totp_setup_required",
      details: {
        username: "bob",
      },
    } satisfies Partial<AuthServiceError>);
  });

  it("issues and consumes websocket tickets for valid sessions", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
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
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });
    const recoveryCode = setupResult.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error("Expected an initial recovery code.");
    }

    const result = await loginWithRecoveryCode(database, {
      nowMs: nowMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
      recoveryCode,
      username: TEST_USERNAME,
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
    expect(
      listSecurityAuditEvents(database).find(
        (event) => event.eventType === "recovery_code_login",
      )?.payloadJson,
    ).toContain('"method":"recovery_code"');

    await expect(
      loginWithRecoveryCode(database, {
        nowMs: nowMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode,
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    expect(
      listSecurityAuditEvents(database).find(
        (event) => event.eventType === "auth_invalid_credentials",
      )?.payloadJson,
    ).toContain('"method":"recovery_code"');
  });

  it("records setup, TOTP login, step-up, and logout audit events", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });
    logout(database, setupResult.session.id);

    const loginResult = await login(database, {
      appDataDir,
      nowMs: nowMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 1_000),
      username: TEST_USERNAME,
    });
    await stepUpSession(database, {
      appDataDir,
      nowMs: nowMs + 2_000,
      primaryFactor: TEST_ADMIN_PIN,
      sessionId: loginResult.session.id,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 2_000),
    });
    logout(database, loginResult.session.id);

    const auditEvents = listSecurityAuditEvents(database);
    expect(
      auditEvents.some((event) => event.eventType === "auth_configured"),
    ).toBeTrue();
    expect(
      auditEvents.some((event) => event.eventType === "auth_login"),
    ).toBeTrue();
    expect(
      auditEvents.some((event) => event.eventType === "auth_step_up"),
    ).toBeTrue();
    expect(
      auditEvents.filter((event) => event.eventType === "auth_logout"),
    ).toHaveLength(2);
    expect(
      auditEvents.find((event) => event.eventType === "auth_login")
        ?.payloadJson,
    ).toContain('"method":"totp"');
    expect(
      auditEvents.find((event) => event.eventType === "auth_step_up")
        ?.summaryText,
    ).toBe("Completed step-up authentication for privileged local actions.");
  });

  it("expires idle sessions after the configured inactivity window", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
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
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
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
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    expect(() =>
      requireFreshStepUp(database, {
        actionDescription: "delete a project",
        nowMs: nowMs + 1_000,
        sessionId: setupResult.session.id,
      }),
    ).toThrow(
      "A fresh step-up authentication is required to delete a project.",
    );

    const stepUpResult = await stepUpSession(database, {
      appDataDir,
      nowMs: nowMs + 2_000,
      primaryFactor: TEST_ADMIN_PIN,
      sessionId: setupResult.session.id,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 2_000),
    });
    expect(stepUpResult.stepUpValidUntil).toBe(
      new Date(nowMs + 2_000 + DEFAULT_STEP_UP_LIFETIME_MS).toISOString(),
    );

    expect(
      requireFreshStepUp(database, {
        actionDescription: "delete a project",
        nowMs: nowMs + 3_000,
        sessionId: setupResult.session.id,
      }).id,
    ).toBe(setupResult.session.id);

    expect(() =>
      requireFreshStepUp(database, {
        actionDescription: "delete a project",
        nowMs: nowMs + DEFAULT_STEP_UP_LIFETIME_MS + 3_000,
        sessionId: setupResult.session.id,
      }),
    ).toThrow(
      "A fresh step-up authentication is required to delete a project.",
    );
  });

  it("serializes and clears session and websocket ticket cookies", () => {
    const sessionCookie = buildSessionCookieHeader("session-1", {
      maxAgeSeconds: 60,
      secure: false,
    });
    const ticketCookie = buildWebSocketTicketCookieHeader("ticket-1", {
      secure: false,
    });

    expect(readSessionCookie(sessionCookie)).toBe("session-1");
    expect(
      readWebSocketTicketCookie(
        "metidos_session=session-1; metidos_ws_ticket=ticket-1",
      ),
    ).toBe("ticket-1");
    expect(ticketCookie).toContain("Path=/rpc");
    expect(buildClearedSessionCookieHeader(false)).toContain("Max-Age=0");
    expect(buildClearedWebSocketTicketCookieHeader(false)).toContain(
      "Max-Age=0",
    );
  });

  it("removes sessions on logout", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
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
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_logout",
      ),
    ).toBeTrue();
  });
});
