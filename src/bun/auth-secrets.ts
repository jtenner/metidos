/**
 * @file src/bun/auth-secrets.ts
 * @description Module for auth secrets.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";

import { getAppDatabasePath } from "./db";

const AUTH_SECRET_KEY_FILE_NAME = "auth-secret.key";
const AUTH_SECRET_VERSION = "v1";
const AES_GCM_IV_LENGTH = 12;

type AuthSecretOptions = {
  appDataDir?: string;
};
/**
 * Resolve the directory for persisted auth secret key material.
 * @param options - Optional app-data override.
 */

function authSecretDirectory(options?: AuthSecretOptions): string {
  return options?.appDataDir ?? dirname(getAppDatabasePath());
}
/**
 * Get the full path to the auth secret key file.
 * @param options - Optional app-data override.
 */

export function getAuthSecretKeyPath(options?: AuthSecretOptions): string {
  return resolve(authSecretDirectory(options), AUTH_SECRET_KEY_FILE_NAME);
}
/**
 * Apply owner-only permissions to a directory where supported.
 * @param path - Directory path.
 */

function applyOwnerOnlyDirectoryPermissions(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Ensure the directory exists and enforce owner-only permissions.
 * @param path - Directory path.
 */

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, {
      recursive: true,
      mode: 0o700,
    });
  }
  applyOwnerOnlyDirectoryPermissions(path);
}
/**
 * Apply owner-only permissions to a key file where supported.
 * @param path - File path.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Base64URL-encode bytes for file storage.
 * @param bytes - Raw key bytes.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
/**
 * Decode base64url data into bytes.
 * @param value - Base64url-encoded input.
 */

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
/**
 * Generate random bytes from the WebCrypto source.
 * @param length - Number of bytes to generate.
 */

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
/**
 * Convert bytes to an ArrayBuffer for crypto APIs.
 * @param bytes - Raw bytes.
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
/**
 * Load existing auth key or create a new one if missing.
 * @param options - Optional app-data override.
 */

function loadOrCreateRawKey(options?: AuthSecretOptions): Uint8Array {
  const directory = authSecretDirectory(options);
  ensureDirectory(directory);
  const path = getAuthSecretKeyPath(options);

  if (existsSync(path)) {
    applyOwnerOnlyFilePermissions(path);
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) {
      throw new Error(`Auth secret key file at ${path} is empty.`);
    }
    return base64UrlDecode(raw);
  }

  const created = randomBytes(32);
  writeFileSync(path, base64UrlEncode(created), {
    encoding: "utf8",
    mode: 0o600,
  });
  applyOwnerOnlyFilePermissions(path);
  return created;
}
/**
 * Import the auth secret into an AES-GCM CryptoKey.
 * @param usages - Key usages (encrypt/decrypt).
 * @param options - Optional app-data override.
 */

async function importSecretKey(
  usages: KeyUsage[],
  options?: AuthSecretOptions,
): Promise<CryptoKey> {
  const rawKey = loadOrCreateRawKey(options);
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(rawKey),
    {
      name: "AES-GCM",
    },
    false,
    usages,
  );
}
/**
 * Deletes auth secret key.
 * @param options - Configuration options used by this operation.
 */

export function deleteAuthSecretKey(options?: AuthSecretOptions): boolean {
  /** Remove the persisted auth-secret key so a full local reset can reseed TOTP encryption cleanly. */
  const path = getAuthSecretKeyPath(options);
  if (!existsSync(path)) {
    return false;
  }
  rmSync(path, {
    force: true,
  });
  return true;
}

/**
 * Encrypt a secret for storage using a locally managed AES-GCM key.
 */
export async function encryptAuthSecret(
  plaintext: string,
  options?: AuthSecretOptions,
): Promise<string> {
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const key = await importSecretKey(["encrypt"], options);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(iv),
      },
      key,
      toArrayBuffer(new TextEncoder().encode(plaintext)),
    ),
  );
  return [
    AUTH_SECRET_VERSION,
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
  ].join(".");
}

/**
 * Decrypt a stored secret created by `encryptAuthSecret`.
 */
export async function decryptAuthSecret(
  ciphertext: string,
  options?: AuthSecretOptions,
): Promise<string> {
  const [version, ivEncoded, payloadEncoded] = ciphertext.split(".");
  if (
    version !== AUTH_SECRET_VERSION ||
    !ivEncoded ||
    !payloadEncoded ||
    ciphertext.split(".").length !== 3
  ) {
    throw new Error("Invalid auth secret ciphertext.");
  }

  const key = await importSecretKey(["decrypt"], options);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlDecode(ivEncoded)),
    },
    key,
    toArrayBuffer(base64UrlDecode(payloadEncoded)),
  );
  return new TextDecoder().decode(plaintext);
}
