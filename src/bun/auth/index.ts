/**
 * @file src/bun/auth/index.ts
 * @description Authentication primitives for hashing factors, TOTP, and recovery codes.
 */

import { createHash, timingSafeEqual } from "node:crypto";

import type { AuthPrimaryFactorType } from "../db";

const PRIMARY_FACTOR_HASH_OPTIONS = {
  algorithm: "argon2id",
  memoryCost: 19_456,
  timeCost: 2,
} as const;
const RFC4648_BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const DEFAULT_SESSION_LIFETIME_DAYS = 7;
export const DEFAULT_TOTP_ALGORITHM = "SHA-256";
export const LEGACY_TOTP_ALGORITHM = "SHA-1";
export const DEFAULT_TOTP_DIGITS = 6;
export const DEFAULT_TOTP_PERIOD_SECONDS = 30;
export const DEFAULT_TOTP_WINDOW = 1;
export const DEFAULT_RECOVERY_CODE_COUNT = 10;
export const MIN_PIN_LENGTH = 6;
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PRIMARY_FACTOR_BYTES = 1024;

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

type TotpOptions = {
  algorithm?: TotpAlgorithm;
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
  // TOTP candidates are fixed-length numeric strings; digesting first gives
  // timingSafeEqual fixed-size buffers without exposing useful content timing.
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
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

function randomAlphabetCharacter(alphabet: string): string {
  if (alphabet.length <= 0 || alphabet.length > 256) {
    throw new Error("Recovery-code alphabet length is invalid.");
  }

  const maximumUniformByte =
    Math.floor(256 / alphabet.length) * alphabet.length;
  const maximumAttempts = 1_024;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const [byte] = randomBytes(1);
    if (typeof byte !== "number") {
      throw new Error("Failed to generate recovery-code entropy.");
    }
    if (byte < maximumUniformByte) {
      return alphabet[byte % alphabet.length] ?? "";
    }
  }

  throw new Error("Failed to generate unbiased recovery-code entropy.");
}

function generateRecoveryCode(): string {
  let raw = "";
  while (raw.length < 10) {
    raw += randomAlphabetCharacter(RECOVERY_CODE_ALPHABET);
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

function validateTotpAlgorithm(algorithm: TotpAlgorithm): void {
  if (
    algorithm !== "SHA-1" &&
    algorithm !== "SHA-256" &&
    algorithm !== "SHA-512"
  ) {
    throw new Error("TOTP algorithm must be SHA-1, SHA-256, or SHA-512.");
  }
}

function formatTotpUriAlgorithm(algorithm: TotpAlgorithm): string {
  validateTotpAlgorithm(algorithm);
  return algorithm.replace("-", "");
}

function isDateLikePin(value: string): boolean {
  // Treat only common operator-entered date shapes as weak PINs. Years are
  // intentionally bounded to 1900-2099, so far-future or zero-padded numeric
  // strings are not rejected as dates unless they match realistic YYMMDD,
  // MMDDYY/MMDD, or YYYYMMDD patterns.
  if (!/^\d{6,8}$/u.test(value)) {
    return false;
  }

  const inRange = (input: string, min: number, max: number): boolean => {
    const parsed = Number.parseInt(input, 10);
    return Number.isInteger(parsed) && parsed >= min && parsed <= max;
  };
  if (value.length === 6) {
    const currentYear = new Date().getUTCFullYear();
    const currentCentury = Math.floor(currentYear / 100) * 100;
    const previousCentury = currentCentury - 100;
    const yy = Number.parseInt(value.slice(0, 2), 10);
    const possibleYears = [previousCentury + yy, currentCentury + yy];
    if (
      (inRange(value.slice(0, 4), 1900, 2099) &&
        inRange(value.slice(4, 6), 1, 12)) ||
      (inRange(value.slice(0, 2), 1, 12) &&
        inRange(value.slice(2, 4), 1, 31)) ||
      (possibleYears.some((year) => year >= 1900 && year <= 2099) &&
        inRange(value.slice(2, 4), 1, 12) &&
        inRange(value.slice(4, 6), 1, 31))
    ) {
      return true;
    }
  }
  if (
    value.length === 8 &&
    inRange(value.slice(0, 4), 1900, 2099) &&
    inRange(value.slice(4, 6), 1, 12) &&
    inRange(value.slice(6, 8), 1, 31)
  ) {
    return true;
  }
  return false;
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
  // Bound primary-factor byte length before Argon2 work so extremely long
  // secrets cannot inflate hashing cost or request memory. The UI may apply
  // narrower guidance, but this server-side cap is the authoritative limit.
  if (Buffer.byteLength(value, "utf8") > MAX_PRIMARY_FACTOR_BYTES) {
    throw new Error(
      `Primary factors must be at most ${MAX_PRIMARY_FACTOR_BYTES} bytes.`,
    );
  }

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
    if (isDateLikePin(value)) {
      throw new Error("PINs cannot look like common date patterns.");
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
 *
 * HTTP handlers only assert that primary-factor fields are present; the actual
 * server-side PIN/password policy lives here so CLI, tests, and future callers
 * cannot bypass minimum-length or format rules by skipping the web route layer.
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
  algorithm = DEFAULT_TOTP_ALGORITHM,
  issuer = "Metidos",
  secret,
}: TotpEnrollmentInput & {
  algorithm?: TotpAlgorithm;
  secret: string;
}): string {
  if (!accountName || accountName.trim().length === 0) {
    throw new Error("TOTP account name is required.");
  }

  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const encodedIssuer = encodeURIComponent(issuer);
  const encodedSecret = encodeURIComponent(secret);
  const encodedAlgorithm = formatTotpUriAlgorithm(algorithm);
  return `otpauth://totp/${label}?secret=${encodedSecret}&issuer=${encodedIssuer}&algorithm=${encodedAlgorithm}&digits=${DEFAULT_TOTP_DIGITS}&period=${DEFAULT_TOTP_PERIOD_SECONDS}`;
}

export function encodeStoredTotpSecret(
  secret: string,
  algorithm: TotpAlgorithm = DEFAULT_TOTP_ALGORITHM,
): string {
  validateTotpAlgorithm(algorithm);
  return `${algorithm}:${secret}`;
}

export function parseStoredTotpSecret(storedSecret: string): {
  algorithm: TotpAlgorithm;
  secret: string;
} {
  if (!storedSecret.trim()) {
    throw new Error("Stored TOTP secret is missing.");
  }

  const [maybeAlgorithm, ...secretParts] = storedSecret.split(":");
  if (
    maybeAlgorithm === "SHA-1" ||
    maybeAlgorithm === "SHA-256" ||
    maybeAlgorithm === "SHA-512"
  ) {
    const secret = secretParts.join(":");
    if (!secret.trim()) {
      throw new Error("Stored TOTP secret is missing.");
    }
    return {
      algorithm: maybeAlgorithm,
      secret,
    };
  }

  if (secretParts.length > 0) {
    throw new Error("Stored TOTP secret algorithm is unsupported.");
  }

  // Legacy rows stored only the base32 secret. Validate the fallback algorithm
  // here so a future constant change fails at parse time rather than much later
  // inside HOTP generation.
  validateTotpAlgorithm(LEGACY_TOTP_ALGORITHM);
  return {
    algorithm: LEGACY_TOTP_ALGORITHM,
    secret: storedSecret,
  };
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
  algorithm: TotpAlgorithm,
): Promise<string> {
  validateTotpDigits(digits);
  validateTotpAlgorithm(algorithm);
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
      hash: algorithm,
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
  const algorithm = options.algorithm ?? DEFAULT_TOTP_ALGORITHM;
  const digits = options.digits ?? DEFAULT_TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? DEFAULT_TOTP_PERIOD_SECONDS;
  validateTotpAlgorithm(algorithm);
  validateTotpPeriodSeconds(periodSeconds);
  const counter = BigInt(Math.floor(atMs / 1000 / periodSeconds));
  return hotp(secret, counter, digits, algorithm);
}

export async function verifyTotpMatchedCounter(
  secret: string,
  code: string,
  options: VerifyTotpOptions = {},
): Promise<number | null> {
  const algorithm = options.algorithm ?? DEFAULT_TOTP_ALGORITHM;
  const digits = options.digits ?? DEFAULT_TOTP_DIGITS;
  const periodSeconds = options.periodSeconds ?? DEFAULT_TOTP_PERIOD_SECONDS;
  const window = options.window ?? DEFAULT_TOTP_WINDOW;
  const atMs = options.atMs ?? Date.now();
  validateTotpAlgorithm(algorithm);
  validateTotpDigits(digits);
  validateTotpPeriodSeconds(periodSeconds);

  const normalizedCode = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${digits}}$`).test(normalizedCode)) {
    return null;
  }

  const currentCounter = Math.floor(atMs / 1000 / periodSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    const candidateCounter = currentCounter + offset;
    if (candidateCounter < 0) {
      continue;
    }
    const expected = await hotp(
      secret,
      BigInt(candidateCounter),
      digits,
      algorithm,
    );
    if (timingSafeTextEqual(normalizedCode, expected)) {
      return candidateCounter;
    }
  }
  return null;
}

/**
 * Verify a TOTP code within a small +/- window of time steps.
 */

export async function verifyTotpCode(
  secret: string,
  code: string,
  options: VerifyTotpOptions = {},
): Promise<boolean> {
  return (await verifyTotpMatchedCounter(secret, code, options)) !== null;
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
  // A recovery code carries roughly 50 bits of entropy with the current
  // alphabet/length, so collisions at DEFAULT_RECOVERY_CODE_COUNT are
  // negligible. Keep a bounded retry guard anyway so tests or future alphabet
  // changes cannot turn deduplication into an unbounded loop.
  const maximumAttempts = count * 32;
  for (
    let attempt = 0;
    codes.size < count && attempt < maximumAttempts;
    attempt += 1
  ) {
    codes.add(generateRecoveryCode());
  }
  if (codes.size < count) {
    throw new Error("Unable to generate unique recovery codes.");
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
