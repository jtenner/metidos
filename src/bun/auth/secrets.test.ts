/**
 * @file src/bun/auth/secrets.test.ts
 * @description Test file for auth secrets.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resetResolvedAppDataDirectory } from "../db";

import {
  type AuthSecretAccessError,
  decryptAuthSecret,
  decryptLegacyAuthSecretForMigration,
  deleteAuthSecretKey,
  encryptAuthSecret,
  getAuthSecretKeyPath,
} from "./secrets";

const tempDirectories = new Set<string>();
const originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
const originalAppDatabasePath = process.env.METIDOS_APP_DATABASE_PATH;

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-auth-secret-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  resetResolvedAppDataDirectory();
  if (typeof originalAppDataDir === "string") {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  } else {
    delete process.env.METIDOS_APP_DATA_DIR;
  }
  if (typeof originalAppDatabasePath === "string") {
    process.env.METIDOS_APP_DATABASE_PATH = originalAppDatabasePath;
  } else {
    delete process.env.METIDOS_APP_DATABASE_PATH;
  }

  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("auth secret encryption", () => {
  const testAdditionalData = new TextEncoder().encode("purpose:user:1");

  it("round-trips encrypted secrets", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
      appDataDir,
    });

    expect(ciphertext).not.toContain("totp-secret-1");
    expect(
      await decryptAuthSecret(ciphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).toBe("totp-secret-1");
  });

  it("rejects legacy ciphertexts outside explicit migration", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("legacy-secret", {
      appDataDir,
    });

    expect(ciphertext.startsWith("v1.")).toBeTrue();
    await expect(
      decryptAuthSecret(ciphertext, {
        appDataDir,
      }),
    ).rejects.toThrow("must be migrated before decryption");
    expect(
      await decryptLegacyAuthSecretForMigration(ciphertext, {
        appDataDir,
      }),
    ).toBe("legacy-secret");
  });

  it("binds v2 ciphertexts to additional authenticated data", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      additionalData: new TextEncoder().encode("purpose:user:1"),
      appDataDir,
    });

    expect(ciphertext.startsWith("v2.")).toBeTrue();
    expect(
      await decryptAuthSecret(ciphertext, {
        additionalData: new TextEncoder().encode("purpose:user:1"),
        appDataDir,
      }),
    ).toBe("totp-secret-1");
    await expect(
      decryptAuthSecret(ciphertext, {
        additionalData: new TextEncoder().encode("purpose:user:2"),
        appDataDir,
      }),
    ).rejects.toThrow("could not be decrypted");
  });

  it("stores auth-secret.key in app data when the configured database is in memory", async () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.METIDOS_APP_DATABASE_PATH = ":memory:";

    await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
    });

    const keyPath = getAuthSecretKeyPath();
    expect(keyPath).toBe(join(appDataDir, "auth-secret.key"));
    expect(existsSync(keyPath)).toBeTrue();
  });

  it("stores auth-secret.key in app data for SQLite memory URI databases", async () => {
    const appDataDir = createTempDirectory();
    process.env.METIDOS_APP_DATA_DIR = appDataDir;
    process.env.METIDOS_APP_DATABASE_PATH =
      "file:metidos-auth?mode=memory&cache=shared";

    await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
    });

    const keyPath = getAuthSecretKeyPath();
    expect(keyPath).toBe(join(appDataDir, "auth-secret.key"));
    expect(existsSync(keyPath)).toBeTrue();
  });

  it("reuses the same stored key across operations", async () => {
    const appDataDir = createTempDirectory();
    const firstCiphertext = await encryptAuthSecret("first", {
      additionalData: testAdditionalData,
      appDataDir,
    });
    const secondCiphertext = await encryptAuthSecret("second", {
      additionalData: testAdditionalData,
      appDataDir,
    });

    expect(
      await decryptAuthSecret(firstCiphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).toBe("first");
    expect(
      await decryptAuthSecret(secondCiphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).toBe("second");
  });

  it("warns when existing auth secret parent directories are loose", async () => {
    const root = createTempDirectory();
    const looseParent = join(root, "loose-parent");
    const appDataDir = join(looseParent, "app-data");
    mkdirSync(appDataDir, { recursive: true, mode: 0o700 });
    chmodSync(looseParent, 0o755);
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    try {
      await encryptAuthSecret("totp-secret-1", {
        additionalData: testAdditionalData,
        appDataDir,
      });
    } finally {
      console.warn = originalWarn;
    }

    expect(
      warnings.some((warning) => warning.includes(looseParent)),
    ).toBeTrue();
  });

  it("tightens existing key-file permissions before using the key", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
      appDataDir,
    });
    const keyPath = getAuthSecretKeyPath({
      appDataDir,
    });
    chmodSync(keyPath, 0o644);

    expect(
      await decryptAuthSecret(ciphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).toBe("totp-secret-1");
    expect(statSync(keyPath).mode & 0o777).toBe(0o600);
  });

  it("fails loudly instead of silently rotating the key when auth-secret.key is missing", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
      appDataDir,
    });

    expect(deleteAuthSecretKey({ appDataDir })).toBeTrue();

    await expect(
      decryptAuthSecret(ciphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).rejects.toMatchObject({
      keyPath: getAuthSecretKeyPath({
        appDataDir,
      }),
      name: "AuthSecretAccessError",
    } satisfies Partial<AuthSecretAccessError>);

    const replacementCiphertext = await encryptAuthSecret("totp-secret-2", {
      additionalData: testAdditionalData,
      appDataDir,
    });
    await expect(
      decryptAuthSecret(ciphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).rejects.toThrow("could not be decrypted");
    expect(
      await decryptAuthSecret(replacementCiphertext, {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).toBe("totp-secret-2");
  });

  it("reports malformed key files before attempting decryption", async () => {
    const appDataDir = createTempDirectory();
    const keyPath = getAuthSecretKeyPath({
      appDataDir,
    });
    writeFileSync(keyPath, Buffer.from("short-key").toString("base64url"), {
      encoding: "utf8",
      mode: 0o600,
    });

    await expect(
      decryptAuthSecret("v2.invalid.invalid", {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).rejects.toThrow("is malformed");
  });

  it("refuses symlinked auth secret key files", async () => {
    const appDataDir = createTempDirectory();
    const outsideKeyPath = join(createTempDirectory(), "outside.key");
    writeFileSync(
      outsideKeyPath,
      Buffer.from("short-key").toString("base64url"),
      {
        encoding: "utf8",
        mode: 0o600,
      },
    );
    symlinkSync(outsideKeyPath, getAuthSecretKeyPath({ appDataDir }));

    await expect(
      decryptAuthSecret("v2.invalid.invalid", {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).rejects.toThrow("must be a regular owner-only file");
  });

  it("reports ciphertext corruption separately from key access failures", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      additionalData: testAdditionalData,
      appDataDir,
    });
    const parts = ciphertext.split(".");
    expect(parts).toHaveLength(3);
    const [version, ivEncoded, payloadEncoded] = parts as [
      string,
      string,
      string,
    ];
    const tamperedPayloadBytes = Buffer.from(payloadEncoded, "base64url");
    tamperedPayloadBytes[0] = (tamperedPayloadBytes[0] ?? 0) ^ 0xff;
    const tamperedPayload = tamperedPayloadBytes.toString("base64url");

    await expect(
      decryptAuthSecret([version, ivEncoded, tamperedPayload].join("."), {
        additionalData: testAdditionalData,
        appDataDir,
      }),
    ).rejects.toThrow("ciphertext may be corrupted or tampered with");
  });
});
