/**
 * @file src/mainview/app/use-thread-message-history-controller.ts
 * @description Selected Thread message-history replacement, merge, and backfill controller.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type {
  ProjectProcedures,
  RpcThreadDetail,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import { logClientError } from "../client-logging";
import { createAbortError, isAbortError } from "./async-request-state";
import { buildMainviewShellSelectedThreadDetailRefreshState } from "./mainview-shell-state";
import {
  MAX_RETAINED_THREAD_MESSAGES,
  retainRecentThreadMessages,
} from "./thread-message-retention";
import { mergeThreadMessageHistory } from "./transcript-state";

export const THREAD_HISTORY_BACKFILL_MAX_PAGES = 50;

type ThreadMessageHistoryControllerProcedures = Pick<
  ProjectProcedures,
  "getThread"
>;

export type ThreadMessageHistoryControllerProps = {
  procedures: ThreadMessageHistoryControllerProcedures;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
};

export type ThreadMessageHistoryController = {
  abortThreadHistoryBackfill: (reason: string) => void;
  mergeSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  replaceSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
};

export function useThreadMessageHistoryController({
  procedures,
  selectedThreadDetailRefreshKeyRef,
  selectedThreadIdRef,
  setThreadMessages,
}: ThreadMessageHistoryControllerProps): ThreadMessageHistoryController {
  const selectedThreadHistoryCursorRef = useRef<number | null>(null);
  const threadHistoryBackfillAbortControllerRef =
    useRef<AbortController | null>(null);

  const abortThreadHistoryBackfill = useCallback((reason: string) => {
    selectedThreadHistoryCursorRef.current = null;
    const controller = threadHistoryBackfillAbortControllerRef.current;
    if (!controller) {
      return;
    }

    threadHistoryBackfillAbortControllerRef.current = null;
    controller.abort(createAbortError(null, reason));
  }, []);

  const startThreadHistoryBackfill = useCallback(
    (threadId: number, initialCursor: number | null) => {
      abortThreadHistoryBackfill("Thread history backfill was superseded.");
      selectedThreadHistoryCursorRef.current = initialCursor;
      if (initialCursor === null) {
        return;
      }

      const controller = new AbortController();
      threadHistoryBackfillAbortControllerRef.current = controller;
      void (async () => {
        // The async backfill intentionally captures `procedures` from this hook
        // invocation but does not leak stale work across selections: every new
        // open/replace path calls `abortThreadHistoryBackfill`, the unmount
        // cleanup aborts the active controller, and the stable
        // `selectedThreadIdRef` guard is checked before fetching and before
        // committing accumulated pages. If the user navigates away or the
        // controller is replaced, the AbortSignal and selected-thread guard stop
        // the loop before stale messages can enter state.
        await new Promise<void>((resolve) => {
          if (
            typeof window === "undefined" ||
            typeof window.requestAnimationFrame !== "function"
          ) {
            setTimeout(resolve, 0);
            return;
          }

          window.requestAnimationFrame(() => resolve());
        });
        if (
          controller.signal.aborted ||
          selectedThreadIdRef.current !== threadId ||
          threadHistoryBackfillAbortControllerRef.current !== controller
        ) {
          return;
        }

        let nextCursor: number | null = initialCursor;
        let backfilledMessages: RpcThreadMessage[] = [];
        let loadedPageCount = 0;
        while (
          nextCursor !== null &&
          loadedPageCount < THREAD_HISTORY_BACKFILL_MAX_PAGES
        ) {
          loadedPageCount += 1;
          const detail = await procedures.getThread(
            {
              threadId,
              cursor: nextCursor,
              includeHeavyContent: false,
            },
            {
              priority: "background",
              signal: controller.signal,
            },
          );
          if (selectedThreadIdRef.current !== threadId) {
            return;
          }

          backfilledMessages = retainRecentThreadMessages(
            mergeThreadMessageHistory(backfilledMessages, detail.messages),
          );
          nextCursor =
            detail.nextCursor === nextCursor ? null : detail.nextCursor;
          if (backfilledMessages.length >= MAX_RETAINED_THREAD_MESSAGES) {
            nextCursor = null;
          }
          selectedThreadHistoryCursorRef.current = nextCursor;
        }
        if (loadedPageCount >= THREAD_HISTORY_BACKFILL_MAX_PAGES) {
          selectedThreadHistoryCursorRef.current = null;
        }

        if (
          backfilledMessages.length > 0 &&
          selectedThreadIdRef.current === threadId
        ) {
          // Commit the full accumulated history backfill once so large threads do not
          // repeatedly reflow and repaint while pagination is still in flight.
          setThreadMessages((current) =>
            retainRecentThreadMessages(
              mergeThreadMessageHistory(current, backfilledMessages),
            ),
          );
        }
      })()
        .catch((error) => {
          if (isAbortError(error)) {
            return;
          }
          logClientError("Failed to backfill thread history", error, {
            context: `threadId:${threadId}`,
          });
        })
        .finally(() => {
          if (threadHistoryBackfillAbortControllerRef.current === controller) {
            threadHistoryBackfillAbortControllerRef.current = null;
          }
        });
    },
    [
      abortThreadHistoryBackfill,
      procedures,
      selectedThreadIdRef,
      setThreadMessages,
    ],
  );

  const replaceSelectedThreadMessageHistory = useCallback(
    (detail: RpcThreadDetail) => {
      const refreshState =
        buildMainviewShellSelectedThreadDetailRefreshState(detail);
      selectedThreadDetailRefreshKeyRef.current = refreshState.detailRefreshKey;
      setThreadMessages(retainRecentThreadMessages(detail.messages));
      startThreadHistoryBackfill(detail.thread.id, detail.nextCursor);
    },
    [
      selectedThreadDetailRefreshKeyRef,
      setThreadMessages,
      startThreadHistoryBackfill,
    ],
  );

  const mergeSelectedThreadMessageHistory = useCallback(
    (detail: RpcThreadDetail) => {
      const refreshState =
        buildMainviewShellSelectedThreadDetailRefreshState(detail);
      selectedThreadDetailRefreshKeyRef.current = refreshState.detailRefreshKey;
      setThreadMessages((current) =>
        retainRecentThreadMessages(
          mergeThreadMessageHistory(current, detail.messages),
        ),
      );
    },
    [selectedThreadDetailRefreshKeyRef, setThreadMessages],
  );

  useEffect(
    () => () => {
      abortThreadHistoryBackfill("Thread history backfill was unmounted.");
    },
    [abortThreadHistoryBackfill],
  );

  return {
    abortThreadHistoryBackfill,
    mergeSelectedThreadMessageHistory,
    replaceSelectedThreadMessageHistory,
  };
}
