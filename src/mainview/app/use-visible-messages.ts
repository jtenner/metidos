/**
 * @file src/mainview/app/use-visible-messages.ts
 * @description React adapter for transcript visible-state projection.
 */

import { useDeferredValue, useMemo, useRef } from "react";
import type {
  RpcProject,
  RpcThread,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import {
  buildVisibleTranscriptState,
  createVisibleTranscriptStateCache,
  threadMessagesKeepTranscriptBusy,
  type VisibleTranscriptState,
} from "./transcript-state";

export {
  clearVisibleMessageSignatureCaches,
  compactTextSignature,
  deriveVisibleTranscriptMediaPayloads,
  mergeThreadMessageHistory,
  pruneVisibleMessageCache,
  shouldRenderThreadMessageControl,
  threadMessageVisibleSignature,
} from "./transcript-state";

type UseVisibleMessagesParams = {
  activeChatError: string;
  activeChatNotice: string;
  activeSelectedWorktreeFolder: string;
  activeSelectedWorktreePath: string | null;
  activeThreadWorkingMessage: string | null | undefined;
  activeThreadWorkingVisible: boolean | undefined;
  isCreatingThread: boolean;
  isThreadLoading: boolean;
  selectedProject: RpcProject | null;
  selectedThread: RpcThread | null;
  selectedThreadId: number | null;
  threadMessages: RpcThreadMessage[];
};

export type UseVisibleMessagesResult = VisibleTranscriptState;

/**
 * Defers hot transcript message updates for rendering while delegating row,
 * media payload, and cache projection to the transcript state seam.
 */
export function useVisibleMessages({
  activeChatError,
  activeChatNotice,
  activeSelectedWorktreeFolder,
  activeSelectedWorktreePath,
  activeThreadWorkingMessage,
  activeThreadWorkingVisible,
  isCreatingThread,
  isThreadLoading,
  selectedProject,
  selectedThread,
  selectedThreadId,
  threadMessages,
}: UseVisibleMessagesParams): UseVisibleMessagesResult {
  const visibleMessageCacheRef = useRef(createVisibleTranscriptStateCache());
  const previousSelectedThreadIdRef = useRef<number | null>(selectedThreadId);
  const currentThreadDetail = useMemo(
    () => ({ selectedThreadId, threadMessages }),
    [selectedThreadId, threadMessages],
  );
  const deferredThreadDetail = useDeferredValue(currentThreadDetail);
  const deferredThreadMessages =
    deferredThreadDetail.selectedThreadId === selectedThreadId
      ? deferredThreadDetail.threadMessages
      : threadMessages;
  // Deferring hot message arrays is intentional: the selected-thread id check
  // prevents old Thread content from bleeding across navigation, while allowing
  // same-Thread streaming updates to yield to urgent input and layout work.
  const immediateTranscriptIsBusy = useMemo(
    () => threadMessagesKeepTranscriptBusy(threadMessages),
    [threadMessages],
  );

  return useMemo<UseVisibleMessagesResult>(() => {
    if (previousSelectedThreadIdRef.current !== selectedThreadId) {
      visibleMessageCacheRef.current.clear();
      previousSelectedThreadIdRef.current = selectedThreadId;
    }

    return buildVisibleTranscriptState({
      activeChatError,
      activeChatNotice,
      activeSelectedWorktreeFolder,
      activeSelectedWorktreePath,
      activeThreadWorkingMessage,
      activeThreadWorkingVisible,
      cache: visibleMessageCacheRef.current,
      initialTranscriptIsBusy: immediateTranscriptIsBusy,
      isCreatingThread,
      isThreadLoading,
      selectedProject,
      selectedThread,
      selectedThreadId,
      threadMessages: deferredThreadMessages,
    });
  }, [
    activeChatError,
    activeChatNotice,
    activeSelectedWorktreeFolder,
    activeSelectedWorktreePath,
    activeThreadWorkingMessage,
    activeThreadWorkingVisible,
    isCreatingThread,
    isThreadLoading,
    selectedProject,
    selectedThread,
    selectedThreadId,
    immediateTranscriptIsBusy,
    deferredThreadMessages,
  ]);
}
