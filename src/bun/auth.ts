/**
 * @file src/bun/auth.ts
 * @description Authentication primitives for hashing factors, TOTP, and recovery codes.
 */

import { timingSafeEqual } from "node:crypto";

import type { AuthPrimaryFactorType } from "./db";

const PRIMARY_FACTOR_HASH_OPTIONS = {
  algorithm: "argon2id",
} as const;
const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const DEFAULT_SESSION_LIFETIME_DAYS = 7;
export const DEFAULT_TOTP_DIGITS = 6;
export const DEFAULT_TOTP_PERIOD_SECONDS = 30;
export const DEFAULT_TOTP_WINDOW = 1;
export const DEFAULT_RECOVERY_CODE_COUNT = 10;
export const MIN_PIN_LENGTH = 8;
export const MIN_PASSWORD_LENGTH = 12;

type TotpOptions = {
  digits?: number;
  periodSeconds?: number;
};

type VerifyTotpOptions = TotpOptions & {
  atMs?: number;
  window?: number;
};

type TotpEnrollmentInput = {
  accountName: string;
  issuer?: string;
};

export type AuthSetupMaterial = {
  recoveryCodes: string[];
  totpSecret: string;
  totpUri: string;
};
/**
 * Base32-encodes raw bytes using RFC 4648 alphabet.
 * @param bytes - Input bytes to encode.
 */

function encodeBase32(bytes: Uint8Array): string {
  let output = "";
  let bits = 0;
  let value = 0;

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += RFC4648_BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += RFC4648_BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}
/**
 * Decodes an RFC 4648 base32 value back into bytes.
 * @param secret - RFC 4648 base32-encoded secret to decode.
 */

function decodeBase32(secret: string): Uint8Array {
  const normalized = secret.toUpperCase().replace(/[\s=-]/g, "");
  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    throw new Error("Invalid TOTP secret.");
  }

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of normalized) {
    const alphabetIndex = RFC4648_BASE32_ALPHABET.indexOf(char);
    if (alphabetIndex < 0) {
      throw new Error("Invalid TOTP secret.");
    }
    value = (value << 5) | alphabetIndex;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Uint8Array.from(bytes);
}
/**
 * Compare two strings in constant-time to reduce timing leakage.
 * @param left - Expected value.
 * @param right - Value to compare against.
 */

function timingSafeTextEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
/**
 * Normalize recovery-code formatting for comparison and persistence.
 * @param code - Raw recovery code string.
 */

function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}
/**
 * Return cryptographically random bytes.
 * @param length - Number of random bytes to generate.
 */

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
/**
 * Copy bytes into an ArrayBuffer for WebCrypto APIs.
 * @param bytes - Input bytes.
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
/**
 * Generate a random URL-safe opaque token.
 * @param length - Characteristic entropy in bytes of the generated token.
 */

function generateRandomToken(length = 32): string {
  return Buffer.from(randomBytes(length)).toString("base64url");
}

function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let raw = "";
  for (const byte of bytes) {
    raw += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
}
/**
 * Validate supported TOTP digit lengths.
 * @param digits - Requested number of digits.
 */

function validateTotpDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) {
    throw new Error("TOTP digits must be an integer between 6 and 8.");
  }
}
/**
 * Validate a positive integer TOTP step period.
 * @param periodSeconds - Step size in seconds.
 */

function validateTotpPeriodSeconds(periodSeconds: number): void {
  if (!Number.isInteger(periodSeconds) || periodSeconds <= 0) {
    throw new Error("TOTP period must be a positive integer.");
  }
}

function isObviousPin(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  const firstDigit = value[0];
  if (firstDigit && value.split("").every((digit) => digit === firstDigit)) {
    return true;
  }

  let ascending = true;
  let descending = true;
  for (let index = 1; index < value.length; index += 1) {
    const previousDigit = Number(value[index - 1]);
    const currentDigit = Number(value[index]);
    if (currentDigit !== previousDigit + 1) {
      ascending = false;
    }
    if (currentDigit !== previousDigit - 1) {
      descending = false;
    }
  }

  return ascending || descending;
}

/**
 * Enforce the setup-time policy for the selected primary factor.
 */

export function validatePrimaryFactor(
  primaryFactorType: AuthPrimaryFactorType,
  value: string,
): void {
  if (primaryFactorType === "pin") {
    if (!/^\d+$/.test(value)) {
      throw new Error("PINs must contain digits only.");
    }
    if (value.length < MIN_PIN_LENGTH) {
      throw new Error(`PINs must be at least ${MIN_PIN_LENGTH} digits.`);
    }
    if (isObviousPin(value)) {
      throw new Error(
        "PINs cannot be obvious repeated or sequential digit patterns.",
      );
    }
    return;
  }

  if (!value || value.trim().length === 0) {
    throw new Error("Password or passphrase is required.");
  }
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Passwords or passphrases must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
  }
}

/**
 * Hash a primary-factor secret with Argon2id.
 */

export async function hashPrimaryFactor(
  primaryFactorType: AuthPrimaryFactorType,
  value: string,
): Promise<string> {
  validatePrimaryFactor(primaryFactorType, value);
  return Bun.password.hash(value, PRIMARY_FACTOR_HASH_OPTIONS);
}

/**
 * Verify a PIN or password against the stored Argon2id hash.
 */

export async function verifyPrimaryFactor(
  value: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(value, hash);
}

/**
 * Generate a new RFC 4648 base32 TOTP secret.
 * @param byteLength - Number of random bytes to encode.
 */
export function generateTotpSecret(byteLength = 20): string {
  if (!Number.isInteger(byteLength) || byteLength < 10) {
    throw new Error("TOTP secret byte length must be at least 10.");
  }
  return encodeBase32(randomBytes(byteLength));
}

/**
 * Build the otpauth:// URI consumed by authenticator apps and QR encoders.
 */

export function buildTotpUri({
  accountName,
  issuer = "Metidos",
  secret,
}: TotpEnrollmentInput & { secret: string }): string {
  if (!accountName || accountName.trim().length === 0) {
    throw new Error("TOTP account name is required.");
  }

  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedSecret = encodeURIComponent(secret);
  return `otpauth://totp/${label}?secret=${encodedSecret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=${DEFAULT_TOTP_DIGITS}&period=${DEFAULT_TOTP_PERIOD_SECONDS}`;
}
/**
 * Generate an HMAC-based one-time password for a specific counter.
 * @param secret - Base32 encoded TOTP secret.
 * @param counter - Time-step counter value.
 * @param digits - Desired token width.
 */

async function hotp(
  secret: string,
  counter: bigint,
  digits: number,
): Promise<string> {
  validateTotpDigits(digits);
  const counterBytes = new Uint8Array(8);
  let remaining = counter;
  for (let index = 7; index >= 0; index -= 1) {
    counterBytes[index] = Number(remaining & 255n);
    remaining >>= 8n;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(decodeBase32(secret)),
    {
      name: "HMAC",
      hash: "SHA-1",
    },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, toArrayBuffer(counterBytes)),
  );
  const offsetByte = signature.at(-1);
  if (typeof offsetByte !== "number") {
    throw new Error("Failed to compute TOTP offset.");
  }
  const offset = offsetByte & 15;
  const chunk = signature.slice(offset, offset + 4);
  const first = chunk[0];
  const second = chunk[1];
  const third = chunk[2];
  const fourth = chunk[3];
  if (
    typeof first !== "number" ||
    typeof second !== "number" ||
    typeof third !== "number" ||
    typeof fourth !== "number"
  ) {
    throw new Error("Failed to compute TOTP code.");
  }
  const binary =
    ((first & 127) << 24) |
    ((second & 255) << 16) |
    ((third & 255) << 8) |
    (fourth & 255);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Generate the current TOTP code for a secret and timestamp.
 */

export async function generateTotpCode(
  secret: string,
  atMs = Date.now(),
  options: TotpOptions = {},
): Promise<string> {
  const digits = options.digits ?? DEFAULT_TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? DEFAULT_TOTP_PERIOD_SECONDS;
  validateTotpPeriodSeconds(periodSeconds);
  const counter = BigInt(Math.floor(atMs / 1000 / periodSeconds));
  return hotp(secret, counter, digits);
}

/**
 * Verify a TOTP code within a small +/- window of time steps.
 */

export async function verifyTotpCode(
  secret: string,
  code: string,
  options: VerifyTotpOptions = {},
): Promise<boolean> {
  const digits = options.digits ?? DEFAULT_TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? DEFAULT_TOTP_PERIOD_SECONDS;
  const window = options.window ?? DEFAULT_TOTP_WINDOW;
  const atMs = options.atMs ?? Date.now();
  validateTotpDigits(digits);
  validateTotpPeriodSeconds(periodSeconds);

  const normalizedCode = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(normalizedCode)) {
    return false;
  }

  const currentCounter = Math.floor(atMs / 1000 / periodSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = currentCounter + offset;
    if (candidateCounter < 0) {
      continue;
    }
    const expected = await hotp(secret, BigInt(candidateCounter), digits);
    if (timingSafeTextEqual(normalizedCode, expected)) {
      return true;
    }
  }
  return false;
}

/**
 * Generate one-time recovery codes for first-run output.
 * @param count - Number of codes to generate.
 */

export function generateRecoveryCodes(
  count = DEFAULT_RECOVERY_CODE_COUNT,
): string[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("Recovery-code count must be a positive integer.");
  }

  const codes = new Set<string>();
  while (codes.size < count) {
    codes.add(generateRecoveryCode());
  }
  return [...codes];
}

/**
 * Hash a recovery code for storage.
 * @param code - Recovery code in user-provided form.
 */
export async function hashRecoveryCode(code: string): Promise<string> {
  return Bun.password.hash(
    normalizeRecoveryCode(code),
    PRIMARY_FACTOR_HASH_OPTIONS,
  );
}

/**
 * Verify a recovery code against the stored hash.
 */

export async function verifyRecoveryCode(
  code: string,
  hash: string,
): Promise<boolean> {
  return Bun.password.verify(normalizeRecoveryCode(code), hash);
}

/**
 * Create the setup material the UI needs for first-run enrollment.
 */

export function createAuthSetupMaterial(
  input: TotpEnrollmentInput,
): AuthSetupMaterial {
  const totpSecret = generateTotpSecret();
  return {
    recoveryCodes: generateRecoveryCodes(),
    totpSecret,
    totpUri: buildTotpUri({
      ...input,
      secret: totpSecret,
    }),
  };
}

/**
 * Generate a new opaque session token.
 */

export function generateSessionId(): string {
  return generateRandomToken();
}

/**
 * Generate a new opaque websocket ticket token.
 */

export function generateWebSocketTicketId(): string {
  return generateRandomToken();
}
