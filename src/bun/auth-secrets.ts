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
 * Function of authSecretDirectory.
 * @param options - The value of `options`.
 */

function authSecretDirectory(options?: AuthSecretOptions): string {
  return options?.appDataDir ?? dirname(getAppDatabasePath());
}
/**
 * Function of getAuthSecretKeyPath.
 * @param options - The value of `options`.
 */

export function getAuthSecretKeyPath(options?: AuthSecretOptions): string {
  return resolve(authSecretDirectory(options), AUTH_SECRET_KEY_FILE_NAME);
}
/**
 * Function of applyOwnerOnlyDirectoryPermissions.
 * @param path - The value of `path`.
 */

function applyOwnerOnlyDirectoryPermissions(path: string): void {
  try {
    chmodSync(path, 0o700);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Function of ensureDirectory.
 * @param path - The value of `path`.
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
 * Function of applyOwnerOnlyFilePermissions.
 * @param path - The value of `path`.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch {
    // Windows does not reliably support POSIX chmod semantics; ignore there.
  }
}
/**
 * Function of base64UrlEncode.
 * @param bytes - The value of `bytes`.
 */

function base64UrlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}
/**
 * Function of base64UrlDecode.
 * @param value - The value of `value`.
 */

function base64UrlDecode(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
/**
 * Function of randomBytes.
 * @param length - The value of `length`.
 */

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}
/**
 * Function of toArrayBuffer.
 * @param bytes - The value of `bytes`.
 */

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
/**
 * Function of loadOrCreateRawKey.
 * @param options - The value of `options`.
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
 * Function of importSecretKey.
 * @param usages - The value of `usages`.
 * @param options - The value of `options`.
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
 * Function of deleteAuthSecretKey.
 * @param options - The value of `options`.
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
