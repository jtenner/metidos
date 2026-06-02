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
    // AuthServiceError.message is serialized by auth HTTP/RPC error handlers.
    // AuthSecretAccessError.message includes the local auth-secret.key path for
    // CLI/operator diagnostics, so collapse it here before browser-facing auth
    // surfaces can expose the user's app-data directory.
    throw new AuthServiceError(
      "auth_secret_unavailable",
      "Auth secret key material is unavailable. Restore the original key file or complete a full auth reset before continuing.",
      503,
    );
  }
  throw error;
}
