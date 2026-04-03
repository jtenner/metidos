import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encryptAuthSecret, getAuthSecretKeyPath } from "./auth-secrets";
import { getAppDatabasePath, migrateDatabase } from "./db";
import {
  DEV_AUTH_BYPASS_ENV,
  DEV_RESET_ENV,
  issueDevWebSocketTicket,
  resetLocalAppState,
  resolveDevFlowMode,
} from "./dev-flows";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "jolt-dev-flows-"));
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

describe("dev flow helpers", () => {
  it("rejects dev-only auth flags outside dev mode", () => {
    expect(() =>
      resolveDevFlowMode({
        env: {
          [DEV_AUTH_BYPASS_ENV]: "1",
        },
        isDevServer: false,
      }),
    ).toThrow(`${DEV_AUTH_BYPASS_ENV}=1 requires --dev or JOLT_DEV=1.`);

    expect(() =>
      resolveDevFlowMode({
        env: {
          [DEV_RESET_ENV]: "1",
        },
        isDevServer: false,
      }),
    ).toThrow(`${DEV_RESET_ENV}=1 requires --dev or JOLT_DEV=1.`);
  });

  it("resolves explicit dev bypass and reset flags in dev mode", () => {
    expect(
      resolveDevFlowMode({
        env: {
          [DEV_AUTH_BYPASS_ENV]: "1",
          [DEV_RESET_ENV]: "1",
        },
        isDevServer: true,
      }),
    ).toEqual({
      authBypass: true,
      resetOnStartup: true,
    });
  });

  it("removes the sqlite database, journals, and auth key during a dev reset", async () => {
    const appDataDir = createTempDirectory();
    const databasePath = getAppDatabasePath({
      appDataDir,
    });
    const database = new Database(databasePath);
    migrateDatabase(database);
    database.close(false);

    writeFileSync(`${databasePath}-shm`, "");
    writeFileSync(`${databasePath}-wal`, "");
    await encryptAuthSecret("totp-secret", {
      appDataDir,
    });
    const authSecretPath = getAuthSecretKeyPath({
      appDataDir,
    });

    const deletedPaths = resetLocalAppState({
      appDataDir,
    });

    expect(deletedPaths).toEqual(
      expect.arrayContaining([
        authSecretPath,
        databasePath,
        `${databasePath}-shm`,
        `${databasePath}-wal`,
      ]),
    );
    expect(existsSync(databasePath)).toBeFalse();
    expect(existsSync(`${databasePath}-shm`)).toBeFalse();
    expect(existsSync(`${databasePath}-wal`)).toBeFalse();
    expect(existsSync(authSecretPath)).toBeFalse();
  });

  it("issues synthetic websocket tickets for auth-bypassed dev sessions", () => {
    const ticket = issueDevWebSocketTicket(
      Date.parse("2026-04-03T00:00:00.000Z"),
    );

    expect(ticket.ticket.startsWith("dev-")).toBeTrue();
    expect(ticket.expiresAt).toBe("2026-04-03T00:01:00.000Z");
  });
});
