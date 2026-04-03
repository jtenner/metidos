import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateTotpCode, verifyRecoveryCode } from "./auth";
import {
  regenerateRecoveryCodesFromCli,
  resetPrimaryFactorFromCli,
} from "./auth-reset";
import {
  login,
  prepareTotpEnrollment,
  resolveSession,
  setupAuth,
} from "./auth-service";
import { getAuthSettings, listAuthRecoveryCodes, migrateDatabase } from "./db";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "jolt-auth-reset-"));
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
      accountName: "local-user",
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
    });

    const resetResult = await resetPrimaryFactorFromCli(database, {
      appDataDir,
      newPrimaryFactor: "correct horse battery staple",
      newPrimaryFactorType: "password",
      nowMs: setupTimeMs + 1_000,
      primaryFactor: "123456",
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
    });

    expect(resetResult.primaryFactorType).toBe("password");
    expect(resetResult.revokedSessionCount).toBe(1);
    expect(getAuthSettings(database)?.primaryFactorType).toBe("password");
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
        primaryFactor: "123456",
        totpCode: await generateTotpCode(
          enrollment.totpSecret,
          setupTimeMs + 2_000,
        ),
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
    });
    expect(loginResult.session.id.length).toBeGreaterThan(10);
  });

  it("regenerates a new recovery-code set after fresh auth", async () => {
    const database = createTestDatabase();
    const appDataDir = createTempDirectory();
    const setupTimeMs = Date.parse("2026-04-03T00:00:00.000Z");
    const enrollment = prepareTotpEnrollment({
      accountName: "local-user",
    });

    const setupResult = await setupAuth(database, {
      appDataDir,
      nowMs: setupTimeMs,
      primaryFactor: "123456",
      primaryFactorType: "pin",
      totpCode: await generateTotpCode(enrollment.totpSecret, setupTimeMs),
      totpSecret: enrollment.totpSecret,
    });
    const originalRecoveryCode = setupResult.recoveryCodes[0];
    if (!originalRecoveryCode) {
      throw new Error("Expected an initial recovery code.");
    }

    const regeneratedCodes = await regenerateRecoveryCodesFromCli(database, {
      appDataDir,
      nowMs: setupTimeMs + 1_000,
      primaryFactor: "123456",
      totpCode: await generateTotpCode(
        enrollment.totpSecret,
        setupTimeMs + 1_000,
      ),
    });

    expect(regeneratedCodes).toHaveLength(10);
    const firstRegeneratedCode = regeneratedCodes[0];
    if (!firstRegeneratedCode) {
      throw new Error("Expected a regenerated recovery code.");
    }

    const storedRecords = listAuthRecoveryCodes(database);
    expect(storedRecords).toHaveLength(10);

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
