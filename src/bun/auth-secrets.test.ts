/**
 * @file src/bun/auth-secrets.test.ts
 * @description Test file for auth secrets.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AuthSecretAccessError,
  decryptAuthSecret,
  deleteAuthSecretKey,
  encryptAuthSecret,
  getAuthSecretKeyPath,
} from "./auth-secrets";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-auth-secret-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

describe("auth secret encryption", () => {
  it("round-trips encrypted secrets", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      appDataDir,
    });

    expect(ciphertext).not.toContain("totp-secret-1");
    expect(
      await decryptAuthSecret(ciphertext, {
        appDataDir,
      }),
    ).toBe("totp-secret-1");
  });

  it("reuses the same stored key across operations", async () => {
    const appDataDir = createTempDirectory();
    const firstCiphertext = await encryptAuthSecret("first", {
      appDataDir,
    });
    const secondCiphertext = await encryptAuthSecret("second", {
      appDataDir,
    });

    expect(
      await decryptAuthSecret(firstCiphertext, {
        appDataDir,
      }),
    ).toBe("first");
    expect(
      await decryptAuthSecret(secondCiphertext, {
        appDataDir,
      }),
    ).toBe("second");
  });

  it("fails loudly instead of silently rotating the key when auth-secret.key is missing", async () => {
    const appDataDir = createTempDirectory();
    const ciphertext = await encryptAuthSecret("totp-secret-1", {
      appDataDir,
    });

    expect(deleteAuthSecretKey({ appDataDir })).toBeTrue();

    await expect(
      decryptAuthSecret(ciphertext, {
        appDataDir,
      }),
    ).rejects.toMatchObject({
      keyPath: getAuthSecretKeyPath({
        appDataDir,
      }),
      name: "AuthSecretAccessError",
    } satisfies Partial<AuthSecretAccessError>);

    const replacementCiphertext = await encryptAuthSecret("totp-secret-2", {
      appDataDir,
    });
    await expect(
      decryptAuthSecret(ciphertext, {
        appDataDir,
      }),
    ).rejects.toThrow(
      "Restore the original key file or complete a full auth reset before re-enrolling TOTP secrets.",
    );
    expect(
      await decryptAuthSecret(replacementCiphertext, {
        appDataDir,
      }),
    ).toBe("totp-secret-2");
  });
});
