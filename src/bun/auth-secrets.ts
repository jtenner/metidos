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
 * Performs authSecretDirectory operation.
 * @param options - Configuration options used by this operation.
 */

function authSecretDirectory(options?: AuthSecretOptions): string {
  return options?.appDataDir ?? dirname(getAppDatabasePath());
}
/**
 * Gets auth secret key path.
 * @param options - Configuration options used by this operation.
 */

export function getAuthSecretKeyPath(options?: AuthSecretOptions): string {
  return resolve(authSecretDirectory(options), AUTH_SECRET_KEY_FILE_NAME);
}
/**
 * Applies owner only directory permissions.
 * @param path - Filesystem path.
 */

function applyOwnerOnlyDirectoryPermissions(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Performs ensureDirectory operation.
 * @param path - Filesystem path.
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
 * Applies owner only file permissions.
 * @param path - Filesystem path.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Performs base64UrlEncode operation.
 * @param bytes - bytes argument for base64UrlEncode.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
/**
 * Performs base64UrlDecode operation.
 * @param value - Input value.
 */

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
/**
 * Performs randomBytes operation.
 * @param length - length argument for randomBytes.
 */

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
/**
 * Converts array buffer value.
 * @param bytes - bytes argument for toArrayBuffer.
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
/**
 * Loads or create raw key.
 * @param options - Configuration options used by this operation.
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
 * Performs importSecretKey operation.
 * @param usages - usages argument for importSecretKey.
 * @param options - Configuration options used by this operation.
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
