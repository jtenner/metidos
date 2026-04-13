/**
 * @file src/bun/auth-usernames.test.ts
 * @description Tests for shared auth username normalization helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  INVALID_WORKSPACE_HOME_USERNAME_MESSAGE,
  normalizeUsername,
  normalizeWorkspaceHomeUsername,
} from "./auth-usernames";

describe("auth username helpers", () => {
  it("trims usernames and rejects blank values", () => {
    expect(normalizeUsername("  alice  ")).toBe("alice");
    expect(() => normalizeUsername("   ")).toThrow("Username is required.");
  });

  it("accepts workspace-home-safe usernames", () => {
    expect(normalizeWorkspaceHomeUsername("  alice smith  ")).toBe(
      "alice smith",
    );
  });

  for (const invalidUsername of [
    ".",
    "..",
    "alice/bob",
    "alice\\bob",
    "alice:admin",
    "alice\u0000",
  ]) {
    it(`rejects workspace-home-unsafe username ${JSON.stringify(invalidUsername)}`, () => {
      expect(() => normalizeWorkspaceHomeUsername(invalidUsername)).toThrow(
        INVALID_WORKSPACE_HOME_USERNAME_MESSAGE,
      );
    });
  }
});
