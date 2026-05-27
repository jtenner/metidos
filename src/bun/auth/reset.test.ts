/**
 * @file src/bun/auth/reset.test.ts
 * @description Test file for auth reset.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getAuthSettings,
  listAuthRecoveryCodes,
  listSecurityAuditEvents,
  migrateDatabase,
} from "../db";
import { generateTotpCode, verifyRecoveryCode } from "./";
import {
  regenerateRecoveryCodesFromCli,
  resetPrimaryFactorFromCli,
  resetPrimaryFactorFromSession,
} from "./reset";
import {
  login,
  prepareTotpEnrollment,
  resolveSession,
  setupAuth,
} from "./service";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();
const TEST_USERNAME = "metidos";
const TEST_ADMIN_PIN = "482951";

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-auth-reset-"));
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

describe("auth reset CLI helpers", () => {
  it("resets the primary factor and revokes existing sessions", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    const resetResult = await resetPrimaryFactorFromCli(database, {
      appDataDir,
      newPrimaryFactor: "correct horse battery staple",
      newPrimaryFactorType: "password",
      nowMs: setupTimeMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
      username: TEST_USERNAME,
    });

    expect(resetResult.primaryFactorType).toBe("password");
    expect(resetResult.revokedSessionCount).toBe(1);
    expect(getAuthSettings(database)?.primaryFactorType).toBe("password");
    expect(
      listSecurityAuditEvents(database).find(
        (event) => event.eventType === "primary_factor_reset",
      )?.payloadJson,
    ).toContain('"primaryFactorType":"password"');
    expect(
      resolveSession(database, {
        nowMs: setupTimeMs + 1_000,
        sessionId: setupResult.session.id,
      }),
    ).toBeNull();

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: await generateTotpCode(
          enrollment.totpSecret,
          setupTimeMs + 2_000,
        ),
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    const loginResult = await login(database, {
      appDataDir,
      nowMs: setupTimeMs + 3_000,
      primaryFactor: "correct horse battery staple",
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 3_000,
      ),
      username: TEST_USERNAME,
    });
    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("resets the PIN from an authenticated session after TOTP", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    const resetResult = await resetPrimaryFactorFromSession(database, {
      appDataDir,
      newPrimaryFactor: "931857",
      newPrimaryFactorType: "pin",
      nowMs: setupTimeMs + 1_000,
      sessionId: setupResult.session.id,
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
    });

    expect(resetResult.primaryFactorType).toBe("pin");
    expect(resetResult.revokedSessionCount).toBe(1);
    expect(getAuthSettings(database)?.primaryFactorType).toBe("pin");
    expect(
      listSecurityAuditEvents(database).find(
        (event) => event.eventType === "primary_factor_reset",
      )?.summaryText,
    ).toBe("Primary factor was reset from the authenticated settings flow.");
    expect(
      resolveSession(database, {
        nowMs: setupTimeMs + 1_000,
        sessionId: setupResult.session.id,
      }),
    ).toBeNull();

    await expect(
      login(database, {
        appDataDir,
        nowMs: setupTimeMs + 2_000,
        primaryFactor: TEST_ADMIN_PIN,
        totpCode: await generateTotpCode(
          enrollment.totpSecret,
          setupTimeMs + 2_000,
        ),
        username: TEST_USERNAME,
      }),
    ).rejects.toThrow("The provided credentials are invalid.");

    const loginResult = await login(database, {
      appDataDir,
      nowMs: setupTimeMs + 3_000,
      primaryFactor: "931857",
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 3_000,
      ),
      username: TEST_USERNAME,
    });
    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("locks the account after repeated invalid session reset TOTP codes", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });

    for (const attempt of [1, 2]) {
      await expect(
        resetPrimaryFactorFromSession(database, {
          appDataDir,
          newPrimaryFactor: "931857",
          newPrimaryFactorType: "pin",
          nowMs: setupTimeMs + attempt * 1_000,
          sessionId: setupResult.session.id,
          totpCode: "not-a-code",
        }),
      ).rejects.toThrow("The provided credentials are invalid.");
    }

    await expect(
      resetPrimaryFactorFromSession(database, {
        appDataDir,
        newPrimaryFactor: "931857",
        newPrimaryFactorType: "pin",
        nowMs: setupTimeMs + 3_000,
        sessionId: setupResult.session.id,
        totpCode: "not-a-code",
      }),
    ).rejects.toThrow("Too many failed authentication attempts");

    expect(getAuthSettings(database)?.lockedUntil).toBe(
      "2026-04-03T00:10:03.000Z",
    );
    expect(
      listSecurityAuditEvents(database).filter(
        (event) => event.eventType === "auth_lockout_started",
      ),
    ).toHaveLength(1);
  });

  it("regenerates a new recovery-code set after fresh auth", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: TEST_USERNAME,
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: TEST_ADMIN_PIN,
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
      username: TEST_USERNAME,
    });
    const originalRecoveryCode = setupResult.recoveryCodes[0];
    if (!originalRecoveryCode) {
      throw new Error("Expected an initial recovery code.");
    }

    const regeneratedCodes = await regenerateRecoveryCodesFromCli(database, {
      appDataDir,
      nowMs: setupTimeMs + 1_000,
      primaryFactor: TEST_ADMIN_PIN,
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
      username: TEST_USERNAME,
    });

    expect(regeneratedCodes).toHaveLength(10);
    const firstRegeneratedCode = regeneratedCodes[0];
    if (!firstRegeneratedCode) {
      throw new Error("Expected a regenerated recovery code.");
    }

    const storedRecords = listAuthRecoveryCodes(database);
    expect(storedRecords).toHaveLength(10);
    expect(
      listSecurityAuditEvents(database).find(
        (event) => event.eventType === "recovery_codes_regenerated",
      )?.payloadJson,
    ).toContain('"recoveryCodeCount":10');

    const originalMatches = await Promise.all(
      storedRecords.map((record) =>
        verifyRecoveryCode(originalRecoveryCode, record.codeHash),
      ),
    );
    expect(originalMatches.some(Boolean)).toBeFalse();

    const regeneratedMatches = await Promise.all(
      storedRecords.map((record) =>
        verifyRecoveryCode(firstRegeneratedCode, record.codeHash),
      ),
    );
    expect(regeneratedMatches.some(Boolean)).toBeTrue();
  });
});
