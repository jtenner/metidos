/**
 * @file src/bun/plugin/replay.test.ts
 * @description Coverage for deterministic Plugin System v1 replay fixtures.
 */

import { describe, expect, it } from "bun:test";
import { redactReplayValue } from "./replay";

describe("plugin replay fixtures", () => {
  it("normalizes secret-looking fixture values before diffing", () => {
    expect(
      redactReplayValue({
        Authorization: "Bearer live",
        nested: { api_key: "live", ok: true },
        token: "live",
      }),
    ).toEqual({
      Authorization: "[REDACTED]",
      nested: { api_key: "[REDACTED]", ok: true },
      token: "[REDACTED]",
    });
  });
});
