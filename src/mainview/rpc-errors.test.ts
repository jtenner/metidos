/**
 * @file src/mainview/rpc-errors.test.ts
 * @description Tests for frontend RPC error classification helpers.
 */

import { describe, expect, it } from "bun:test";

import { RpcError, isStepUpRequiredRpcError } from "./rpc-errors";

describe("RPC error classification", () => {
  it("classifies recent step-up failures separately from generic RPC errors", () => {
    expect(
      isStepUpRequiredRpcError(
        new RpcError(
          "Recent step-up authentication is required for this sensitive action.",
          "step_up_required",
          null,
        ),
      ),
    ).toBeTrue();

    expect(
      isStepUpRequiredRpcError(
        new RpcError("No session", "session_required", null),
      ),
    ).toBeFalse();
    expect(isStepUpRequiredRpcError(new Error("step_up_required"))).toBeFalse();
  });
});
