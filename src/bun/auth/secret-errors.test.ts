/**
 * @file src/bun/auth/secret-errors.test.ts
 * @description Test file for shared auth-secret error mapping.
 */

import { describe, expect, it } from "bun:test";

import { AuthSecretAccessError } from "./secrets";
import { AuthServiceError } from "./service-core";
import { rethrowAuthSecretError } from "./secret-errors";

describe("auth secret service error mapping", () => {
  it("maps auth-secret access failures to a stable service error", () => {
    const error = new AuthSecretAccessError(
      "Auth secret key file is missing at /safe/test/auth-secret.key.",
      "/safe/test/auth-secret.key",
    );

    expect(() => rethrowAuthSecretError(error)).toThrow(AuthServiceError);
    try {
      rethrowAuthSecretError(error);
    } catch (mappedError) {
      expect(mappedError).toBeInstanceOf(AuthServiceError);
      expect((mappedError as AuthServiceError).code).toBe(
        "auth_secret_unavailable",
      );
      expect((mappedError as AuthServiceError).status).toBe(503);
      expect((mappedError as AuthServiceError).message).toBe(error.message);
    }
  });

  it("preserves unrelated failures for caller-specific handling", () => {
    const error = new Error("unexpected failure");

    expect(() => rethrowAuthSecretError(error)).toThrow(error);
  });
});
