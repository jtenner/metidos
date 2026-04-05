/**
 * @file src/mainview/thread-send.ts
 * @description Module for thread send.
 */

import type { RpcThreadDetail } from "../bun/rpc-schema";

type ThreadSendFailureSelectionOptions = {
  requestedThreadId: number;
  selectedThreadId: number | null;
};

type SentThreadDetailSelectionOptions = ThreadSendFailureSelectionOptions & {
  detail: Pick<RpcThreadDetail, "thread">;
};

/**
 * Only surface a send-message failure in the current workspace when the failed
 * request still targets the selected thread.
 */
export function shouldApplyThreadSendFailureToSelection(
  options: ThreadSendFailureSelectionOptions,
): boolean {
  return options.selectedThreadId === options.requestedThreadId;
}

/**
 * Only replace the visible transcript when the send completion still belongs
 * to the selected thread that initiated the request.
 */
export function shouldApplySentThreadDetailToSelection(
  options: SentThreadDetailSelectionOptions,
): boolean {
  return (
    shouldApplyThreadSendFailureToSelection(options) &&
    options.detail.thread.id === options.requestedThreadId
  );
}
