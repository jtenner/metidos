/**
 * @file src/bun/auth/secrets.ts
 * @description Module for auth secrets.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { getAppDatabaseDirectoryPath } from "../db";

const AUTH_SECRET_KEY_FILE_NAME = "auth-secret.key";
const AUTH_SECRET_LEGACY_VERSION = "v1";
const AUTH_SECRET_VERSION = "v2";
const AES_GCM_IV_LENGTH = 12;
const AUTH_SECRET_KEY_LENGTH = 32;
const WINDOWS_ACL_GUIDANCE =
  ".wiki/local-auth-hardening.md#windows-acl-expectation-for-auth-secrets";
const OWNER_ACCESS_ONLY_MODE = 0o700;
const GROUP_OR_OTHER_ACCESS_MASK = 0o077;
const STICKY_DIRECTORY_MODE = 0o1000;
const warnedLooseAuthSecretParentDirectories = new Set<string>();

function warnAuthSecretManualCheck(message: string): void {
  // This low-level auth-secret helper can run before the backend logger is
  // initialized, including CLI reset/setup flows. Keep filesystem-permission
  // hardening guidance on stderr so operators see it during early startup.
  console.warn(message);
}

export type AuthSecretOptions = {
  additionalData?: Uint8Array;
  appDataDir?: string;
};

export const AUTH_TOTP_SECRET_PURPOSE = "metidos.auth.totp-secret";

export function buildUserScopedAuthSecretAdditionalData(
  purpose: string,
  userId: number,
): Uint8Array {
  if (!purpose.trim()) {
    throw new Error("Auth secret purpose is required.");
  }
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Auth secret user id must be a positive integer.");
  }
  return new TextEncoder().encode(`${purpose}:user:${userId}`);
}

export function buildLocalOperatorAuthSecretAdditionalData(
  purpose: string,
): Uint8Array {
  if (!purpose.trim()) {
    throw new Error("Auth secret purpose is required.");
  }
  return new TextEncoder().encode(`${purpose}:local-operator`);
}

export class AuthSecretAccessError extends Error {
  constructor(
    message: string,
    readonly keyPath: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AuthSecretAccessError";
  }
}

function buildMissingAuthSecretKeyMessage(path: string): string {
  return `Auth secret key file is missing at ${path}. Restore the original key file or complete a full auth reset before re-enrolling TOTP secrets.`;
}

function buildInvalidAuthSecretKeyMessage(path: string): string {
  return `Persisted TOTP secrets cannot be decrypted with auth-secret.key at ${path}. Restore the original key file or complete a full auth reset before re-enrolling TOTP secrets.`;
}

function buildMalformedAuthSecretKeyMessage(path: string): string {
  return `Auth secret key file at ${path} is malformed. Expected a base64url-encoded ${AUTH_SECRET_KEY_LENGTH}-byte AES-256 key. Restore the original key file or complete a full auth reset before re-enrolling TOTP secrets.`;
}

function buildUnsafeAuthSecretKeyFileMessage(path: string): string {
  return `Auth secret key file at ${path} must be a regular owner-only file, not a symlink or special file.`;
}

function buildUndecryptableAuthSecretMessage(path: string): string {
  return `Persisted TOTP secrets could not be decrypted. The stored ciphertext may be corrupted or tampered with, or auth-secret.key at ${path} may not match the encrypted data.`;
}
/**
 * Resolve the directory for persisted auth secret key material.
 * @param options - Optional app-data override.
 */

function authSecretDirectory(options?: AuthSecretOptions): string {
  return getAppDatabaseDirectoryPath(options);
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
    chmodSync(path, OWNER_ACCESS_ONLY_MODE);
  } catch (error) {
    if (process.platform === "win32") {
      warnAuthSecretManualCheck(
        `Unable to enforce owner-only permissions on auth secret directory ${path}; verify Windows ACLs manually. See ${WINDOWS_ACL_GUIDANCE}.`,
      );
      return;
    }
    throw error;
  }
}

function warnLooseExistingAuthSecretParentDirectories(path: string): void {
  if (process.platform === "win32") {
    return;
  }
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : null;
  let current = dirname(resolve(path));
  while (current && dirname(current) !== current) {
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(current);
    } catch {
      return;
    }
    if (!stats.isDirectory()) {
      return;
    }
    if (
      currentUid !== null &&
      typeof stats.uid === "number" &&
      stats.uid !== currentUid
    ) {
      return;
    }
    if ((stats.mode & STICKY_DIRECTORY_MODE) !== 0) {
      return;
    }
    if (
      (stats.mode & GROUP_OR_OTHER_ACCESS_MASK) !== 0 &&
      !warnedLooseAuthSecretParentDirectories.has(current)
    ) {
      warnedLooseAuthSecretParentDirectories.add(current);
      warnAuthSecretManualCheck(
        `Auth secret parent directory ${current} is accessible by group or other users; consider tightening it to owner-only permissions because it contains or leads to auth-secret.key.`,
      );
    }
    current = dirname(current);
  }
}

function chmodCreatedDirectoryTree(
  firstCreatedPath: string,
  leafPath: string,
): void {
  const firstCreated = resolve(firstCreatedPath);
  const leaf = resolve(leafPath);
  const relativeLeaf = relative(firstCreated, leaf);
  if (
    relativeLeaf === ".." ||
    relativeLeaf.startsWith(`..${sep}`) ||
    relativeLeaf === ""
  ) {
    applyOwnerOnlyDirectoryPermissions(leaf);
    return;
  }

  applyOwnerOnlyDirectoryPermissions(firstCreated);
  let current = firstCreated;
  for (const segment of relativeLeaf.split(sep)) {
    if (!segment) {
      continue;
    }
    current = join(current, segment);
    applyOwnerOnlyDirectoryPermissions(current);
  }
}
/**
 * Ensure the directory exists and enforce owner-only permissions.
 * @param path - Directory path.
 */

function ensureDirectory(path: string): void {
  const createdPath = !existsSync(path)
    ? mkdirSync(path, {
        recursive: true,
        mode: OWNER_ACCESS_ONLY_MODE,
      })
    : undefined;
  if (createdPath) {
    chmodCreatedDirectoryTree(createdPath, path);
    warnLooseExistingAuthSecretParentDirectories(path);
    return;
  }
  applyOwnerOnlyDirectoryPermissions(path);
  warnLooseExistingAuthSecretParentDirectories(path);
}
/**
 * Apply owner-only permissions to a key file where supported.
 * @param path - File path.
 */

function applyOwnerOnlyFilePermissions(path: string): void {
  try {
    chmodSync(path, 0o600);
  } catch (error) {
    if (process.platform === "win32") {
      warnAuthSecretManualCheck(
        `Unable to enforce owner-only permissions on auth secret key ${path}; verify Windows ACLs manually. See ${WINDOWS_ACL_GUIDANCE}.`,
      );
      return;
    }
    throw error;
  }
}

function assertRegularAuthSecretKeyFile(path: string): void {
  let stats: ReturnType<typeof lstatSync>;
  try {
    stats = lstatSync(path);
  } catch (error) {
    throw new AuthSecretAccessError(
      buildMissingAuthSecretKeyMessage(path),
      path,
      {
        cause: error,
      },
    );
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new AuthSecretAccessError(
      buildUnsafeAuthSecretKeyFileMessage(path),
      path,
    );
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
 * Load an existing auth key or create a new one when explicitly allowed.
 * @param options - Optional app-data override.
 */
function loadRawKey(
  options?: AuthSecretOptions,
  input: {
    createIfMissing: boolean;
  } = {
    createIfMissing: false,
  },
): Uint8Array {
  const directory = authSecretDirectory(options);
  ensureDirectory(directory);
  const path = getAuthSecretKeyPath(options);

  if (existsSync(path)) {
    assertRegularAuthSecretKeyFile(path);
    applyOwnerOnlyFilePermissions(path);
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) {
      throw new AuthSecretAccessError(
        buildInvalidAuthSecretKeyMessage(path),
        path,
      );
    }
    let decoded: Uint8Array;
    try {
      decoded = base64UrlDecode(raw);
    } catch (error) {
      throw new AuthSecretAccessError(
        buildMalformedAuthSecretKeyMessage(path),
        path,
        { cause: error },
      );
    }
    if (decoded.byteLength !== AUTH_SECRET_KEY_LENGTH) {
      throw new AuthSecretAccessError(
        buildMalformedAuthSecretKeyMessage(path),
        path,
      );
    }
    return decoded;
  }

  if (!input.createIfMissing) {
    throw new AuthSecretAccessError(
      buildMissingAuthSecretKeyMessage(path),
      path,
    );
  }

  const created = randomBytes(AUTH_SECRET_KEY_LENGTH);
  try {
    // Keep the owner-only mode on the exclusive create call itself. A later
    // chmod is retained as defense-in-depth, but must not be the only
    // permission boundary because another local process could observe the file
    // between creation and a separate permission update.
    writeFileSync(path, base64UrlEncode(created), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    // EEXIST is the expected concurrent-startup race: another process can
    // create auth-secret.key between the existsSync() preflight and this
    // exclusive create. Re-read through the normal path so the regular-file,
    // key-length, decoding, and permission checks still apply, and so callers
    // get a stable auth-secret error instead of a raw filesystem race.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "EEXIST"
    ) {
      return loadRawKey(options, { createIfMissing: false });
    }
    throw error;
  }
  // Re-stat after the exclusive create and after chmod. `flag: "wx"` prevents
  // following a pre-existing symlink, but this second regular-file assertion
  // closes the small create/chmod observation gap and keeps future refactors
  // from weakening the auth-secret invariant.
  assertRegularAuthSecretKeyFile(path);
  applyOwnerOnlyFilePermissions(path);
  assertRegularAuthSecretKeyFile(path);
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
  const rawKey = loadRawKey(options, {
    createIfMissing: usages.includes("encrypt"),
  });
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
  try {
    const stats = lstatSync(path);
    if (!stats.isFile() && !stats.isSymbolicLink()) {
      return false;
    }
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a secret for storage using a locally managed AES-GCM key.
 */
export async function encryptAuthSecret(
  plaintext: string,
  options?: AuthSecretOptions,
): Promise<string> {
  // AES-GCM requires nonce uniqueness per key. These are low-volume local auth
  // secrets, so a fresh 96-bit WebCrypto random IV gives collision risk far
  // below the operational risk of maintaining a persistent IV registry beside
  // the encrypted TOTP settings.
  const iv = randomBytes(AES_GCM_IV_LENGTH);
  const key = await importSecretKey(["encrypt"], options);
  const algorithm: AesGcmParams = {
    name: "AES-GCM",
    iv: toArrayBuffer(iv),
  };
  if (options?.additionalData) {
    algorithm.additionalData = toArrayBuffer(options.additionalData);
  }
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      algorithm,
      key,
      toArrayBuffer(new TextEncoder().encode(plaintext)),
    ),
  );
  return [
    options?.additionalData ? AUTH_SECRET_VERSION : AUTH_SECRET_LEGACY_VERSION,
    base64UrlEncode(iv),
    base64UrlEncode(ciphertext),
  ].join(".");
}

async function decryptAuthSecretInternal(
  ciphertext: string,
  options: AuthSecretOptions | undefined,
  input: { allowLegacyCiphertext: boolean },
): Promise<string> {
  const [version, ivEncoded, payloadEncoded] = ciphertext.split(".");
  if (
    (version !== AUTH_SECRET_VERSION &&
      version !== AUTH_SECRET_LEGACY_VERSION) ||
    !ivEncoded ||
    !payloadEncoded ||
    ciphertext.split(".").length !== 3
  ) {
    throw new Error("Invalid auth secret ciphertext.");
  }
  const keyPath = getAuthSecretKeyPath(options);
  if (version === AUTH_SECRET_LEGACY_VERSION && !input.allowLegacyCiphertext) {
    throw new AuthSecretAccessError(
      "Legacy auth secret ciphertext must be migrated before decryption.",
      keyPath,
    );
  }
  if (version === AUTH_SECRET_VERSION && !options?.additionalData) {
    throw new AuthSecretAccessError(
      "Auth secret additional data is required.",
      keyPath,
    );
  }
  if (version === AUTH_SECRET_LEGACY_VERSION && options?.additionalData) {
    throw new AuthSecretAccessError(
      "Legacy auth secret ciphertext must be migrated before scoped decryption.",
      keyPath,
    );
  }

  let key: CryptoKey;
  try {
    key = await importSecretKey(["decrypt"], options);
  } catch (error) {
    if (error instanceof AuthSecretAccessError) {
      throw error;
    }
    throw new AuthSecretAccessError(
      buildInvalidAuthSecretKeyMessage(keyPath),
      keyPath,
    );
  }

  try {
    const algorithm: AesGcmParams = {
      name: "AES-GCM",
      iv: toArrayBuffer(base64UrlDecode(ivEncoded)),
    };
    if (version === AUTH_SECRET_VERSION && options?.additionalData) {
      algorithm.additionalData = toArrayBuffer(options.additionalData);
    }
    const plaintext = await crypto.subtle.decrypt(
      algorithm,
      key,
      toArrayBuffer(base64UrlDecode(payloadEncoded)),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new AuthSecretAccessError(
      buildUndecryptableAuthSecretMessage(keyPath),
      keyPath,
    );
  }
}

/**
 * Decrypt a stored v2 secret created by `encryptAuthSecret`.
 */
export async function decryptAuthSecret(
  ciphertext: string,
  options?: AuthSecretOptions,
): Promise<string> {
  return decryptAuthSecretInternal(ciphertext, options, {
    allowLegacyCiphertext: false,
  });
}

/**
 * Decrypt legacy v1 ciphertext only for immediate re-encryption migrations.
 */
export async function decryptLegacyAuthSecretForMigration(
  ciphertext: string,
  options?: AuthSecretOptions,
): Promise<string> {
  return decryptAuthSecretInternal(ciphertext, options, {
    allowLegacyCiphertext: true,
  });
}
