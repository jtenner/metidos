/**
 * @file src/mainview/thread-send.test.ts
 * @description Test file for thread send.
 */

import { describe, expect, it } from "bun:test";

import type { RpcThreadDetail } from "../bun/rpc-schema";
import {
  shouldApplySentThreadDetailToSelection,
  shouldApplyThreadSendFailureToSelection,
} from "./thread-send";

/**
 * Performs threadDetail operation.
 * @param threadId - Thread identifier.
 */

function threadDetail(threadId: number): RpcThreadDetail {
  return {
    thread: {
      id: threadId,
    },
    messages: [],
  } as unknown as RpcThreadDetail;
}

describe("thread send selection helpers", () => {
  it("applies a send completion when the original thread is still selected", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(17),
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeTrue();
  });

  it("ignores a send completion after the user switches to another thread", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(17),
        requestedThreadId: 17,
        selectedThreadId: 42,
      }),
    ).toBeFalse();
  });

  it("ignores a completion that resolves with a different thread id", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(42),
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeFalse();
  });

  it("only surfaces send failures while the failed thread remains selected", () => {
    expect(
      shouldApplyThreadSendFailureToSelection({
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeTrue();
    expect(
      shouldApplyThreadSendFailureToSelection({
        requestedThreadId: 17,
        selectedThreadId: 42,
      }),
    ).toBeFalse();
  });
});
