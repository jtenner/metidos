/**
 * @file src/bun/auth/service.test.ts
 * @description Test file for auth service.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAuthSession,
  deleteAuthSession,
  getAuthSettings,
  getAuthWebSocketTicket,
  listAuthRecoveryCodes,
  listSecurityAuditEvents,
  listUsers,
  migrateDatabase,
} from "../db";
import { generateTotpCode } from "./";
import { deleteAuthSecretKey } from "./secrets";
import type { AuthServiceError } from "./service";
import {
  buildAuthCsrfCookieHeader,
  buildClearedSessionCookieHeader,
  buildClearedWebSocketTicketCookieHeader,
  buildLogoutClearSiteDataHeader,
  buildSessionCookieHeader,
  buildWebSocketTicketCookieHeader,
  createPendingUser,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  findMatchingUnusedRecoveryCodeHash,
  getAuthSessionTouchCacheSize,
  getAuthStatus,
  issueWebSocketTicket,
  login,
  loginWithRecoveryCode,
  logout,
  prepareTotpEnrollment,
  readAuthCsrfCookie,
  readSessionCookie,
  readWebSocketTicketCookie,
  resolveSession,
  setupAuth,
  stepUpSession,
  validateAndConsumeWebSocketTicket,
} from "./service";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();
const TEST_USERNAME = "alice";
const TEST_ADMIN_PIN = "482951";
const TEST_PENDING_USER_PIN = "915827";

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
    invalidPrimaryFactor: "000000",
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
  it("checks every recovery code hash before returning an unused match", async () => {
    const checkedHashes: string[] = [];
    const match = await findMatchingUnusedRecoveryCodeHash(
      [
        {
          codeHash: "hash-a",
          usedAt: null,
        },
        {
          codeHash: "hash-b",
          usedAt: null,
        },
        {
          codeHash: "hash-c",
          usedAt: "2026-04-03T00:00:00.000Z",
        },
      ],
      "RECOVERY-CODE",
      async (_code, hash) => {
        checkedHashes.push(hash);
        return hash === "hash-a";
      },
    );

    expect(match).toBe("hash-a");
    expect(checkedHashes).toEqual(["hash-a", "hash-b", "hash-c"]);
  });

  it("prepares TOTP enrollment material", () => {
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    expect(enrollment.totpSecret.length).toBeGreaterThan(0);
    expect(enrollment.totpUri).toContain("otpauth://totp/");
    expect(enrollment.totpUri).toContain("algorithm=SHA256");
  });

  it("uses a default local-operator TOTP label when no username is provided", () => {
    const enrollment = prepareTotpEnrollment({});

    expect(enrollment.totpUri).toContain("Metidos");
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
      username: "metidos",
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
      isAdmin: true,
      knownUsernames: ["metidos"],
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
      username: "metidos",
    });
  });

  it("supports first-run setup and later login without a username", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({});
    const setupCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs,
    );

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: setupCode,
      totpSecret: enrollment.totpSecret,
    });

    expect(setupResult.session.id.length).toBeGreaterThan(10);
    expect(listUsers(database)).toMatchObject([
      {
        isAdmin: true,
        username: "metidos",
      },
    ]);

    const loginResult = await login(database, {
      appDataDir,
      nowMs: setupTimeMs + 60_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 60_000,
      ),
    });

    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("rolls back first-run setup when secret encryption fails", async () => {
    const database = createTestDatabase();
    const appDataPath = join(createTempDirectory(), "not-a-directory");
    writeFileSync(appDataPath, "not a directory");
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    await expect(
      setupAuth(database, {
        appDataDir: appDataPath,
        nowMs,
        primaryFactor: TEST_ADMIN_PIN,
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
        totpSecret: enrollment.totpSecret,
      }),
    ).rejects.toThrow();

    expect(listUsers(database)).toEqual([]);
  });

  it("allows only one concurrent first-run setup to become the local operator", async () => {
    // Regression coverage for the first-user setup race: concurrent setup
    // calls share one SQLite connection, but only the serialized transaction
    // that wins the initial local-operator slot may commit an admin user.
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const aliceEnrollment = prepareTotpEnrollment({
      accountName: "alice",
    });
    const bobEnrollment = prepareTotpEnrollment({
      accountName: "bob",
    });

    const results = await Promise.allSettled([
      setupAuth(database, {
        appDataDir,
        nowMs,
        primaryFactor: TEST_ADMIN_PIN,
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(aliceEnrollment.totpSecret, nowMs),
        totpSecret: aliceEnrollment.totpSecret,
        username: "alice",
      }),
      setupAuth(database, {
        appDataDir,
        nowMs,
        primaryFactor: "394817",
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(bobEnrollment.totpSecret, nowMs),
        totpSecret: bobEnrollment.totpSecret,
        username: "bob",
      }),
    ]);

    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(listUsers(database).filter((user) => user.isAdmin)).toHaveLength(1);
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
        primaryFactor: "000000",
        totpCode: attemptCode,
      }),
      login(database, {
        appDataDir,
        nowMs: attemptTimeMs,
        primaryFactor: "000000",
        totpCode: attemptCode,
      }),
      login(database, {
        appDataDir,
        nowMs: attemptTimeMs,
        primaryFactor: "000000",
        totpCode: attemptCode,
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
    });

    expect(deleteAuthSecretKey({ appDataDir })).toBeTrue();

    await expect(
      login(database, {
        appDataDir,
        nowMs: nowMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 1_000),
      }),
    ).rejects.toMatchObject({
      code: "auth_secret_unavailable",
    } satisfies Partial<AuthServiceError>);
  });

  it("locks out for repeated invalid TOTP when the primary factor is correct", async () => {
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
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: invalidTotp,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 3_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: invalidTotp,
      }),
    ).rejects.toMatchObject({
      code: "auth_locked",
    } satisfies Partial<AuthServiceError>);

    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(0);
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toBeTrue();

    const successCode = await generateTotpCode(
      enrollment.totpSecret,
      setupTimeMs + 4_000,
    );
    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 4_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: successCode,
      }),
    ).rejects.toMatchObject({
      code: "auth_locked",
    } satisfies Partial<AuthServiceError>);
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
    });

    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-1",
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-2",
      }),
    ).rejects.toThrow("The provided credentials are invalid.");
    await expect(
      loginWithRecoveryCode(database, {
        nowMs: setupTimeMs + 3_000,
        primaryFactor: TEST_ADMIN_PIN,
        recoveryCode: "INVALID-CODE-3",
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(0);
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toBeFalse();
  });

  it("rejects additional legacy provisioning after the local operator is configured", async () => {
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
    });

    await expect(
      createPendingUser(database, {
        actorUserId: 1,
        actorUsername: TEST_USERNAME,
        pin: TEST_PENDING_USER_PIN,
        username: "bob",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<AuthServiceError>);
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

  it("rejects new setup usernames above the bounded username length", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const longUsername = "a".repeat(65);
    const enrollment = prepareTotpEnrollment({
      accountName: longUsername,
    });

    await expect(
      setupAuth(database, {
        appDataDir,
        nowMs,
        primaryFactor: TEST_ADMIN_PIN,
        primaryFactorType: "pin",
        totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
        totpSecret: enrollment.totpSecret,
        username: longUsername,
      }),
    ).rejects.toMatchObject({
      code: "invalid_username",
    } satisfies Partial<AuthServiceError>);
  });

  it("uses the singleton local-operator username after first-run setup", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({});

    const result = await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_PENDING_USER_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
    });

    expect(
      getAuthStatus(database, result.session.id, {
        nowMs,
      }),
    ).toEqual({
      authenticated: true,
      configured: true,
      isAdmin: true,
      knownUsernames: ["metidos"],
      lockedUntil: null,
      primaryFactorType: "pin",
      sessionExpiresAt: result.session.expiresAt,
      username: "metidos",
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
      code: "username_taken",
    } satisfies Partial<AuthServiceError>);
  });

  it("rejects additional legacy provisioning after single-operator setup", async () => {
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
    });

    await expect(
      createPendingUser(database, {
        actorUserId: 1,
        actorUsername: TEST_USERNAME,
        pin: TEST_PENDING_USER_PIN,
        username: "bob/unsafe",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    } satisfies Partial<AuthServiceError>);
  });

  it("rejects login attempts that name a different username after setup", async () => {
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
    });

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 1_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: await generateTotpCode(
          adminEnrollment.totpSecret,
          setupTimeMs + 1_000,
        ),
        username: "bob",
      }),
    ).rejects.toMatchObject({
      code: "invalid_credentials",
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
    });
    const recoveryCode = setupResult.recoveryCodes[0];
    if (!recoveryCode) {
      throw new Error("Expected an initial recovery code.");
    }

    const result = await loginWithRecoveryCode(database, {
      nowMs: nowMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
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
    });
    logout(database, setupResult.session.id);

    const loginResult = await login(database, {
      appDataDir,
      nowMs: nowMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 1_000),
    });
    await stepUpSession(database, {
      appDataDir,
      nowMs: nowMs + 35_000,
      primaryFactor: TEST_ADMIN_PIN,
      sessionId: loginResult.session.id,
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs + 35_000),
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
    ).toBe("Completed optional step-up authentication.");
  });

  it("caches resolved sessions briefly and falls back to SQLite after the TTL", async () => {
    const database = createTestDatabase();
    const session = createAuthSession(database, {
      expiresAt: "2026-04-10T00:00:00.000Z",
      id: "cached-session",
      issuedAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: "2026-04-03T00:00:00.000Z",
    });

    expect(
      resolveSession(database, {
        nowMs: Date.parse("2026-04-03T00:00:00.000Z"),
        sessionId: session.id,
      })?.id,
    ).toBe(session.id);

    deleteAuthSession(database, session.id);
    expect(
      resolveSession(database, {
        nowMs: Date.parse("2026-04-03T00:00:01.000Z"),
        sessionId: session.id,
      })?.id,
    ).toBe(session.id);
    expect(
      resolveSession(database, {
        nowMs: Date.parse("2026-04-03T00:00:06.000Z"),
        sessionId: session.id,
      }),
    ).toBeNull();
  });

  it("bounds the auth session touch cache under high session churn", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const nowMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({});

    await setupAuth(database, {
      appDataDir,
      nowMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, nowMs),
      totpSecret: enrollment.totpSecret,
    });

    for (let index = 0; index < 1_030; index += 1) {
      const session = createAuthSession(database, {
        expiresAt: "2026-04-10T00:00:00.000Z",
        id: `cache-session-${index}`,
        issuedAt: "2026-04-03T00:00:00.000Z",
        lastUsedAt: "2026-04-03T00:00:00.000Z",
      });
      expect(
        resolveSession(database, {
          nowMs: Date.parse("2026-04-03T00:02:00.000Z") + index,
          sessionId: session.id,
          touch: true,
        }),
      ).not.toBeNull();
    }

    expect(getAuthSessionTouchCacheSize()).toBeLessThanOrEqual(1_024);
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
    });

    expect(() =>
      issueWebSocketTicket(database, {
        nowMs: nowMs + DEFAULT_SESSION_IDLE_TIMEOUT_MS + 1,
        sessionId: setupResult.session.id,
      }),
    ).toThrow("A valid authenticated session is required.");
  });

  it("serializes auth CSRF cookies as http-only path-scoped cookies", () => {
    const cookie = buildAuthCsrfCookieHeader("csrf-token", false);
    const secureCookie = buildAuthCsrfCookieHeader("csrf-token", true);

    expect(cookie).toContain("metidos_csrf=csrf-token");
    expect(cookie).toContain("Path=/auth");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure");
    expect(secureCookie).toContain("__Host-metidos_csrf=csrf-token");
    expect(secureCookie).toContain("Path=/");
    expect(secureCookie).toContain("Secure");
  });

  it("rejects oversized auth CSRF cookie tokens", () => {
    expect(readAuthCsrfCookie(`metidos_csrf=${"x".repeat(256)}`)).toBe(
      "x".repeat(256),
    );
    expect(readAuthCsrfCookie(`metidos_csrf=${"x".repeat(257)}`)).toBeNull();
  });

  it("rejects cookie values that would inject additional attributes", () => {
    expect(() =>
      buildSessionCookieHeader("session-1; Path=/", {
        maxAgeSeconds: 60,
        secure: false,
      }),
    ).toThrow("Session id contains characters");
    expect(() =>
      buildAuthCsrfCookieHeader("csrf\r\nSet-Cookie: x=y", false),
    ).toThrow("CSRF token contains characters");
    expect(() =>
      buildWebSocketTicketCookieHeader("ticket 1", {
        secure: false,
      }),
    ).toThrow("WebSocket ticket id contains characters");
  });

  it("serializes and clears session and websocket ticket cookies", () => {
    const sessionCookie = buildSessionCookieHeader("session-1", {
      maxAgeSeconds: 60,
      secure: false,
    });
    const ticketCookie = buildWebSocketTicketCookieHeader("ticket-1", {
      secure: false,
    });
    const secureSessionCookie = buildSessionCookieHeader("session-2", {
      maxAgeSeconds: 60,
      secure: true,
    });
    const secureTicketCookie = buildWebSocketTicketCookieHeader("ticket-2", {
      secure: true,
    });

    expect(readSessionCookie(sessionCookie)).toBe("session-1");
    expect(readSessionCookie(secureSessionCookie)).toBe("session-2");
    expect(secureSessionCookie).toContain("__Host-metidos_session=session-2");
    expect(secureSessionCookie).toContain("Secure");
    expect(secureTicketCookie).toContain("__Host-metidos_ws_ticket=ticket-2");
    expect(secureTicketCookie).toContain("Secure");
    expect(
      readWebSocketTicketCookie(
        "metidos_session=session-1; metidos_ws_ticket=ticket-1",
      ),
    ).toBe("ticket-1");
    expect(
      readSessionCookie("metidos_session=session-1; metidos_session=session-2"),
    ).toBeNull();
    expect(
      readWebSocketTicketCookie(
        "__Host-metidos_ws_ticket=ticket-2; metidos_ws_ticket=ticket-1",
      ),
    ).toBe("ticket-2");
    expect(
      readWebSocketTicketCookie(
        "metidos_ws_ticket=stale-rpc-path; metidos_ws_ticket=ticket-1",
      ),
    ).toBeNull();
    expect(ticketCookie).toContain("Path=/;");
    expect(buildClearedSessionCookieHeader(false)).toContain("Max-Age=0");
    expect(buildClearedSessionCookieHeader(true)).toContain(
      "__Host-metidos_session=",
    );
    expect(buildClearedWebSocketTicketCookieHeader(false)).toContain(
      "Max-Age=0",
    );
    expect(buildClearedWebSocketTicketCookieHeader(true)).toContain(
      "__Host-metidos_ws_ticket=",
    );
    expect(buildLogoutClearSiteDataHeader()).toBe(
      '"cache", "cookies", "storage"',
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
    });

    expect(
      resolveSession(database, {
        nowMs,
        sessionId: setupResult.session.id,
      }),
    ).not.toBeNull();

    const ticket = issueWebSocketTicket(database, {
      nowMs: nowMs + 500,
      sessionId: setupResult.session.id,
    });
    expect(getAuthWebSocketTicket(database, ticket.ticket)).not.toBeNull();

    logout(database, setupResult.session.id);
    expect(
      resolveSession(database, {
        nowMs,
        sessionId: setupResult.session.id,
      }),
    ).toBeNull();
    expect(getAuthWebSocketTicket(database, ticket.ticket)).toBeNull();
    expect(
      listSecurityAuditEvents(database).some(
        (event) => event.eventType === "auth_logout",
      ),
    ).toBeTrue();
  });
});
