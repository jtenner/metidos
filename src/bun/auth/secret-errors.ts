/**
 * @file src/bun/auth/secret-errors.ts
 * @description Shared auth-secret error mapping helpers.
 */

import { AuthSecretAccessError } from "./secrets";
import { AuthServiceError } from "./service-core";

/**
 * Convert low-level auth-secret storage failures into the stable service error
 * used by login, session step-up, and reset flows.
 *
 * Keep this mapping centralized so missing, unreadable, malformed, or
 * undecryptable `auth-secret.key` failures consistently surface as a 503
 * `auth_secret_unavailable` response instead of flow-specific 500 errors.
 */
export function rethrowAuthSecretError(error: unknown): never {
  if (error instanceof AuthSecretAccessError) {
    throw new AuthServiceError("auth_secret_unavailable", error.message, 503);
  }
  throw error;
}
