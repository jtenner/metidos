/**
 * @file src/bun/auth/secret-migration.test.ts
 * @description Tests for startup auth secret migration helpers.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { migrateDatabase, upsertAuthSettings } from "../db";
import {
  AUTH_TOTP_SECRET_PURPOSE,
  buildLocalOperatorAuthSecretAdditionalData,
  decryptAuthSecret,
  encryptAuthSecret,
} from "./secrets";
import { migrateTotpAuthSecretsOnStartup } from "./secret-migration";

const openDatabases = new Set<Database>();
const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-auth-secret-migration-"));
  tempDirectories.add(path);
  return path;
}

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

function readStoredTotpCiphertext(database: Database): string {
  const row = database
    .query<{ totpSecretCiphertext: string }, []>(
      `
        SELECT totp_secret_ciphertext AS totpSecretCiphertext
        FROM auth_settings
        WHERE id = 1
      `,
    )
    .get();
  if (!row) {
    throw new Error("Expected auth settings row to exist.");
  }
  return row.totpSecretCiphertext;
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

describe("TOTP auth secret startup migration", () => {
  const totpAdditionalData = buildLocalOperatorAuthSecretAdditionalData(
    AUTH_TOTP_SECRET_PURPOSE,
  );

  it("rewraps legacy TOTP ciphertexts with purpose-bound additional data", async () => {
    const appDataDir = createTempDirectory();
    const database = createTestDatabase();
    const legacyCiphertext = await encryptAuthSecret("legacy-totp-secret", {
      appDataDir,
    });
    expect(legacyCiphertext.startsWith("v1.")).toBeTrue();
    upsertAuthSettings(database, {
      primaryFactorHash: "hash",
      primaryFactorType: "password",
      sessionLifetimeDays: 30,
      totpSecretCiphertext: legacyCiphertext,
    });

    const result = await migrateTotpAuthSecretsOnStartup(database, {
      appDataDir,
    });

    expect(result).toEqual({ migrated: 1, scanned: 1 });
    const migratedCiphertext = readStoredTotpCiphertext(database);
    expect(migratedCiphertext.startsWith("v2.")).toBeTrue();
    expect(migratedCiphertext).not.toBe(legacyCiphertext);
    expect(
      await decryptAuthSecret(migratedCiphertext, {
        additionalData: totpAdditionalData,
        appDataDir,
      }),
    ).toBe("legacy-totp-secret");
  });

  it("leaves existing v2 ciphertexts unchanged", async () => {
    const appDataDir = createTempDirectory();
    const database = createTestDatabase();
    const v2Ciphertext = await encryptAuthSecret("current-totp-secret", {
      additionalData: totpAdditionalData,
      appDataDir,
    });
    upsertAuthSettings(database, {
      primaryFactorHash: "hash",
      primaryFactorType: "password",
      sessionLifetimeDays: 30,
      totpSecretCiphertext: v2Ciphertext,
    });

    const result = await migrateTotpAuthSecretsOnStartup(database, {
      appDataDir,
    });

    expect(result).toEqual({ migrated: 0, scanned: 1 });
    expect(readStoredTotpCiphertext(database)).toBe(v2Ciphertext);
  });

  it("fails closed and preserves stored ciphertext when legacy decryption fails", async () => {
    const sourceAppDataDir = createTempDirectory();
    const wrongAppDataDir = createTempDirectory();
    const database = createTestDatabase();
    const legacyCiphertext = await encryptAuthSecret("legacy-totp-secret", {
      appDataDir: sourceAppDataDir,
    });
    upsertAuthSettings(database, {
      primaryFactorHash: "hash",
      primaryFactorType: "password",
      sessionLifetimeDays: 30,
      totpSecretCiphertext: legacyCiphertext,
    });

    await expect(
      migrateTotpAuthSecretsOnStartup(database, {
        appDataDir: wrongAppDataDir,
      }),
    ).rejects.toThrow("Auth secret key file is missing");
    expect(readStoredTotpCiphertext(database)).toBe(legacyCiphertext);
  });
});
