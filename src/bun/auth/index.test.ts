/**
 * @file src/bun/auth/index.test.ts
 * @description Test file for auth.
 */

import { Database } from "bun:sqlite";
import { afterEach, describe, expect, it } from "bun:test";
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
} from "../db";
import {
  buildTotpUri,
  createAuthSetupMaterial,
  DEFAULT_SESSION_LIFETIME_DAYS,
  DEFAULT_TOTP_ALGORITHM,
  generateRecoveryCodes,
  generateSessionId,
  generateTotpCode,
  generateWebSocketTicketId,
  hashPrimaryFactor,
  hashRecoveryCode,
  MAX_PRIMARY_FACTOR_BYTES,
  MIN_PASSWORD_LENGTH,
  MIN_PIN_LENGTH,
  parseStoredTotpSecret,
  validatePrimaryFactor,
  verifyPrimaryFactor,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./index";

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
    const hash = await hashPrimaryFactor("pin", "482951");
    expect(await verifyPrimaryFactor("482951", hash)).toBeTrue();
    expect(await verifyPrimaryFactor("999999", hash)).toBeFalse();
  });

  it("enforces the configured PIN policy", () => {
    expect(() => validatePrimaryFactor("pin", "12345")).toThrow(
      `PINs must be at least ${MIN_PIN_LENGTH} digits.`,
    );
    expect(() => validatePrimaryFactor("pin", "12ab56")).toThrow(
      "PINs must contain digits only.",
    );
    expect(() => validatePrimaryFactor("pin", "123456")).toThrow(
      "PINs cannot be obvious repeated or sequential digit patterns.",
    );
    expect(() => validatePrimaryFactor("pin", "111111")).toThrow(
      "PINs cannot be obvious repeated or sequential digit patterns.",
    );
    expect(() => validatePrimaryFactor("pin", "199901")).toThrow(
      "PINs cannot look like common date patterns.",
    );
    expect(() => validatePrimaryFactor("pin", "240412")).toThrow(
      "PINs cannot look like common date patterns.",
    );
  });

  it("enforces the configured passphrase policy", () => {
    expect(() => validatePrimaryFactor("password", "")).toThrow(
      "Password or passphrase is required.",
    );
    expect(() => validatePrimaryFactor("password", "short pass")).toThrow(
      `Passwords or passphrases must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  });

  it("caps primary-factor input length before hashing", () => {
    const tooLong = "a".repeat(MAX_PRIMARY_FACTOR_BYTES + 1);
    expect(() => validatePrimaryFactor("password", tooLong)).toThrow(
      `Primary factors must be at most ${MAX_PRIMARY_FACTOR_BYTES} bytes.`,
    );
    expect(() => validatePrimaryFactor("pin", "1".repeat(1025))).toThrow(
      `Primary factors must be at most ${MAX_PRIMARY_FACTOR_BYTES} bytes.`,
    );
  });

  it("builds a valid otpauth URI", () => {
    expect(
      buildTotpUri({
        accountName: "alice@example.test",
        issuer: "Metidos Test",
        secret: "JBSWY3DPEHPK3PXP",
      }),
    ).toBe(
      "otpauth://totp/Metidos%20Test%3Aalice%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Metidos%20Test&algorithm=SHA256&digits=6&period=30",
    );
  });

  it("matches a standard RFC 6238 test vector", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    const code = await generateTotpCode(secret, 59_000, {
      algorithm: "SHA-1",
      digits: 8,
      periodSeconds: 30,
    });

    expect(code).toBe("94287082");
    expect(
      await verifyTotpCode(secret, "94287082", {
        algorithm: "SHA-1",
        atMs: 59_000,
        digits: 8,
        periodSeconds: 30,
        window: 0,
      }),
    ).toBeTrue();
  });

  it("generates SHA-256 TOTP codes by default", async () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA";
    const code = await generateTotpCode(secret, 59_000, {
      digits: 8,
      periodSeconds: 30,
    });

    expect(DEFAULT_TOTP_ALGORITHM).toBe("SHA-256");
    expect(code).toBe("46119246");
  });

  it("parses stored TOTP secrets with legacy SHA-1 compatibility", () => {
    expect(parseStoredTotpSecret("JBSWY3DPEHPK3PXP")).toEqual({
      algorithm: "SHA-1",
      secret: "JBSWY3DPEHPK3PXP",
    });
    expect(parseStoredTotpSecret("SHA-256:JBSWY3DPEHPK3PXP")).toEqual({
      algorithm: "SHA-256",
      secret: "JBSWY3DPEHPK3PXP",
    });
  });

  it("rejects malformed stored TOTP secret metadata", () => {
    expect(() => parseStoredTotpSecret("")).toThrow(
      "Stored TOTP secret is missing.",
    );
    expect(() => parseStoredTotpSecret("SHA-384:JBSWY3DPEHPK3PXP")).toThrow(
      "Stored TOTP secret algorithm is unsupported.",
    );
    expect(() => parseStoredTotpSecret("SHA-256:")).toThrow(
      "Stored TOTP secret is missing.",
    );
  });

  it("accepts one adjacent TOTP time step but rejects larger drift", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const issuedAtMs = 1_710_000_000_000;
    const code = await generateTotpCode(secret, issuedAtMs);

    expect(
      await verifyTotpCode(secret, code, {
        atMs: issuedAtMs + 30_000,
      }),
    ).toBeTrue();
    expect(
      await verifyTotpCode(secret, code, {
        atMs: issuedAtMs + 61_000,
      }),
    ).toBeFalse();
  });

  it("generates setup material with recovery codes", () => {
    const setupMaterial = createAuthSetupMaterial({
      accountName: "alice@example.test",
    });

    expect(setupMaterial.recoveryCodes).toHaveLength(10);
    for (const code of setupMaterial.recoveryCodes) {
      expect(code).toMatch(
        /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/,
      );
    }
    expect(new Set(setupMaterial.recoveryCodes).size).toBe(
      setupMaterial.recoveryCodes.length,
    );
    expect(setupMaterial.totpSecret.length).toBeGreaterThan(0);
    expect(setupMaterial.totpUri.startsWith("otpauth://totp/")).toBeTrue();
  });

  it("hashes and verifies recovery codes", async () => {
    const code = generateRecoveryCodes(1).at(0);
    if (!code) {
      throw new Error("Expected a recovery code.");
    }
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

    const sessionTwo = createAuthSession(database, {
      expiresAt: "2026-04-10T00:00:00.000Z",
      id: "session-2",
      issuedAt: "2026-04-03T00:00:00.000Z",
      lastUsedAt: "2026-04-03T00:00:00.000Z",
    });
    const secondTicket = createAuthWebSocketTicket(database, {
      expiresAt: "2026-04-03T00:05:00.000Z",
      id: "ticket-2",
      issuedAt: "2026-04-03T00:00:00.000Z",
      sessionId: session.id,
    });
    expect(
      consumeAuthWebSocketTicket(
        database,
        secondTicket.id,
        "2026-04-03T00:01:00.000Z",
        {
          expiresAfter: "2026-04-03T00:01:00.000Z",
          sessionId: sessionTwo.id,
        },
      ),
    ).toBeNull();
    expect(
      consumeAuthWebSocketTicket(
        database,
        secondTicket.id,
        "2026-04-03T00:01:00.000Z",
        {
          expiresAfter: "2026-04-03T00:01:00.000Z",
          sessionId: session.id,
        },
      )?.consumedAt,
    ).toBe("2026-04-03T00:01:00.000Z");
  });
});
