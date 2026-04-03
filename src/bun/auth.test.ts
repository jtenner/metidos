import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";

import {
  buildTotpUri,
  createAuthSetupMaterial,
  DEFAULT_SESSION_LIFETIME_DAYS,
  generateRecoveryCodes,
  generateSessionId,
  generateTotpCode,
  generateWebSocketTicketId,
  hashPrimaryFactor,
  hashRecoveryCode,
  MIN_PIN_LENGTH,
  validatePrimaryFactor,
  verifyPrimaryFactor,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./auth";
import {
  consumeAuthWebSocketTicket,
  createAuthSession,
  createAuthWebSocketTicket,
  getAuthSession,
  getAuthSettings,
  listAuthRecoveryCodes,
  markAuthRecoveryCodeUsed,
  migrateDatabase,
  replaceAuthRecoveryCodeHashes,
  setAuthFailureState,
  touchAuthSession,
  upsertAuthSettings,
} from "./db";

const openDatabases = new Set<Database>();

function createTestDatabase(): Database {
  const database = new Database(":memory:");
  migrateDatabase(database);
  openDatabases.add(database);
  return database;
}

afterEach(() => {
  for (const database of openDatabases) {
    database.close(false);
  }
  openDatabases.clear();
});

describe("auth helpers", () => {
  it("hashes and verifies primary factors", async () => {
    const hash = await hashPrimaryFactor("pin", "123456");
    expect(await verifyPrimaryFactor("123456", hash)).toBeTrue();
    expect(await verifyPrimaryFactor("999999", hash)).toBeFalse();
  });

  it("enforces the configured PIN policy", () => {
    expect(() => validatePrimaryFactor("pin", "12345")).toThrow(
      `PINs must be at least ${MIN_PIN_LENGTH} digits.`,
    );
    expect(() => validatePrimaryFactor("pin", "12ab56")).toThrow(
      "PINs must contain digits only.",
    );
  });

  it("builds a valid otpauth URI", () => {
    expect(
      buildTotpUri({
        accountName: "alice@example.test",
        issuer: "Jolt Test",
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ).toBe(
      "otpauth://totp/Jolt%20Test%3Aalice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Jolt%20Test&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("matches a standard RFC 6238 test vector", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const code = await generateTotpCode(secret, 59_000, {
      digits: 8,
      periodSeconds: 30,
    });

    expect(code).toBe("94287082");
    expect(
      await verifyTotpCode(secret, "94287082", {
        atMs: 59_000,
        digits: 8,
        periodSeconds: 30,
        window: 0,
      }),
    ).toBeTrue();
  });

  it("generates setup material with recovery codes", () => {
    const setupMaterial = createAuthSetupMaterial({
      accountName: "alice@example.test",
    });

    expect(setupMaterial.recoveryCodes).toHaveLength(10);
    expect(setupMaterial.totpSecret.length).toBeGreaterThan(0);
    expect(setupMaterial.totpUri.startsWith("otpauth://totp/")).toBeTrue();
  });

  it("hashes and verifies recovery codes", async () => {
    const [code] = generateRecoveryCodes(1);
    const hash = await hashRecoveryCode(code);

    expect(await verifyRecoveryCode(code, hash)).toBeTrue();
    expect(await verifyRecoveryCode("WRONG-CODE", hash)).toBeFalse();
  });

  it("generates opaque session and websocket ids", () => {
    expect(generateSessionId()).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateWebSocketTicketId()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("auth persistence", () => {
  it("stores auth settings and lockout state", () => {
    const database = createTestDatabase();
    const settings = upsertAuthSettings(database, {
      primaryFactorHash: "hash-1",
      primaryFactorType: "password",
      sessionLifetimeDays: DEFAULT_SESSION_LIFETIME_DAYS,
      totpSecretCiphertext: "ciphertext-1",
    });

    expect(settings.primaryFactorType).toBe("password");
    expect(getAuthSettings(database)?.sessionLifetimeDays).toBe(
      DEFAULT_SESSION_LIFETIME_DAYS,
    );

    setAuthFailureState(database, 3, "2026-04-03T12:00:00.000Z");
    expect(getAuthSettings(database)?.failedPrimaryFactorAttempts).toBe(3);
    expect(getAuthSettings(database)?.lockedUntil).toBe(
      "2026-04-03T12:00:00.000Z",
    );
  });

  it("replaces and consumes recovery code hashes", () => {
    const database = createTestDatabase();
    replaceAuthRecoveryCodeHashes(database, ["hash-a", "hash-b"]);

    expect(listAuthRecoveryCodes(database)).toHaveLength(2);
    expect(
      markAuthRecoveryCodeUsed(database, "hash-a", "2026-04-03T12:00:00.000Z"),
    ).toBeTrue();
    expect(
      markAuthRecoveryCodeUsed(database, "hash-a", "2026-04-03T12:01:00.000Z"),
    ).toBeFalse();
  });

  it("stores sessions and websocket tickets", () => {
    const database = createTestDatabase();
    const session = createAuthSession(database, {
      expiresAt: "2026-04-10T00:00:00.000Z",
      id: "session-1",
      issuedAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: "2026-04-03T00:00:00.000Z",
      stepUpValidUntil: null,
    });

    expect(session.id).toBe("session-1");

    touchAuthSession(
      database,
      session.id,
      "2026-04-03T01:00:00.000Z",
      "2026-04-10T01:00:00.000Z",
    );
    expect(getAuthSession(database, session.id)?.lastUsedAt).toBe(
      "2026-04-03T01:00:00.000Z",
    );

    const ticket = createAuthWebSocketTicket(database, {
      expiresAt: "2026-04-03T00:05:00.000Z",
      id: "ticket-1",
      issuedAt: "2026-04-03T00:00:00.000Z",
      sessionId: session.id,
    });

    expect(ticket.sessionId).toBe(session.id);
    expect(
      consumeAuthWebSocketTicket(
        database,
        ticket.id,
        "2026-04-03T00:01:00.000Z",
      )?.consumedAt,
    ).toBe("2026-04-03T00:01:00.000Z");
    expect(
      consumeAuthWebSocketTicket(
        database,
        ticket.id,
        "2026-04-03T00:02:00.000Z",
      ),
    ).toBeNull();
  });
});
