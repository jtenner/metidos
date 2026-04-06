/**
 * @file src/bun/logging.test.ts
 * @description Test file for bun logging helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  isTraceLoggingEnabled,
  shouldEmitLogLevel,
  TRACE_LOGGING_ENV,
} from "./logging";

describe("logging helpers", () => {
  it("disables trace logging by default", () => {
    expect(isTraceLoggingEnabled({})).toBeFalse();
    expect(shouldEmitLogLevel("TRACE", {})).toBeFalse();
  });

  it("enables trace logging only when the env flag is set to 1", () => {
    expect(
      isTraceLoggingEnabled({
        [TRACE_LOGGING_ENV]: "1",
      }),
    ).toBeTrue();
    expect(
      shouldEmitLogLevel("TRACE", {
        [TRACE_LOGGING_ENV]: "1",
      }),
    ).toBeTrue();
    expect(
      shouldEmitLogLevel("TRACE", {
        [TRACE_LOGGING_ENV]: "true",
      }),
    ).toBeFalse();
  });

  it("always emits non-trace log levels", () => {
    expect(shouldEmitLogLevel("INFO", {})).toBeTrue();
    expect(shouldEmitLogLevel("WARNING", {})).toBeTrue();
    expect(shouldEmitLogLevel("ERROR", {})).toBeTrue();
  });
});
