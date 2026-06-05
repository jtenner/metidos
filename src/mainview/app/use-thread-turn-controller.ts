/**
 * @file src/mainview/app/use-thread-turn-controller.ts
 * @description Selected Thread turn send/stop workflow controller for Mainview.
 */

import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import type {
  ProjectProcedures,
  RpcModelOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import { sendThreadTurn } from "../thread-send";
import { buildMainviewShellSelectedThreadDetailRefreshState } from "./mainview-shell-state";
import type { ThreadStore } from "./thread-store";

export type ThreadTurnBusyState = {
  state: {
    isSending: boolean;
    isStoppingThread: boolean;
  };
  setters: {
    setIsSending: Dispatch<SetStateAction<boolean>>;
    setIsStoppingThread: Dispatch<SetStateAction<boolean>>;
  };
};

export function useThreadTurnBusyState(): ThreadTurnBusyState {
  const [isSending, setIsSending] = useState(false);
  const [isStoppingThread, setIsStoppingThread] = useState(false);

  return {
    state: { isSending, isStoppingThread },
    setters: { setIsSending, setIsStoppingThread },
  };
}

export type ThreadTurnControllerProps = {
  activeCodexModel: string;
  codexModels: RpcModelOption[];
  createThreadForActiveWorktree?:
    | (() => Promise<RpcThreadDetail | null>)
    | undefined;
  busyState: ThreadTurnBusyState;
  initialChatInput: string;
  mergeSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  procedures: Pick<ProjectProcedures, "sendThreadMessage" | "stopThreadTurn">;
  selectedComposerDraftKey: string | null;
  selectedThread: RpcThread | null;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadId: number | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadIsWorking: boolean;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  setChatError: Dispatch<SetStateAction<string>>;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
  threadStoreRef: MutableRefObject<ThreadStore>;
  upsertThread: (thread: RpcThread) => void;
};

export type ThreadTurnController = {
  isSending: boolean;
  isStoppingThread: boolean;
  isThreadEmptyDiscardProtected: (threadId: number) => boolean;
  postMessage: () => void;
  stopSelectedThreadTurn: () => void;
};

export function useThreadTurnController({
  activeCodexModel,
  busyState,
  codexModels,
  createThreadForActiveWorktree,
  initialChatInput,
  mergeSelectedThreadMessageHistory,
  procedures,
  selectedComposerDraftKey,
  selectedThread,
  selectedThreadDetailRefreshKeyRef,
  selectedThreadId,
  selectedThreadIdRef,
  selectedThreadIsWorking,
  selectedThreadRunStateRef,
  setChatError,
  setThreadMessages,
  threadStoreRef,
  upsertThread,
}: ThreadTurnControllerProps): ThreadTurnController {
  const { isSending, isStoppingThread } = busyState.state;
  const { setIsSending, setIsStoppingThread } = busyState.setters;
  const optimisticThreadMessageIdRef = useRef(-1);

  const isThreadEmptyDiscardProtected = useCallback(
    (_threadId: number): boolean => isSending,
    [isSending],
  );

  const postMessage = useCallback(() => {
    sendThreadTurn({
      activeCodexModel,
      codexModels,
      draftKey: selectedComposerDraftKey ?? null,
      ensureSelectedThread: createThreadForActiveWorktree,
      initialChatInput,
      isSending,
      optimisticThreadMessageIdRef,
      procedures,
      selectedThread,
      selectedThreadDetailRefreshKeyRef,
      selectedThreadIdRef,
      selectedThreadIsWorking,
      selectedThreadRunStateRef,
      setChatError,
      setIsSending,
      setThreadMessages,
      getThreadById: (threadId) =>
        threadStoreRef.current.byId[threadId] ?? null,
      upsertThread,
    });
  }, [
    activeCodexModel,
    codexModels,
    createThreadForActiveWorktree,
    initialChatInput,
    isSending,
    procedures,
    selectedComposerDraftKey,
    selectedThread,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
    selectedThreadIsWorking,
    selectedThreadRunStateRef,
    setChatError,
    setIsSending,
    setThreadMessages,
    threadStoreRef,
    upsertThread,
  ]);

  const stopSelectedThreadTurn = useCallback(() => {
    if (!selectedThreadId || !selectedThreadIsWorking || isStoppingThread) {
      return;
    }

    const previousThread = selectedThread;
    const optimisticStoppedAt = new Date().toISOString();
    setIsStoppingThread(true);
    setChatError("");
    if (previousThread) {
      selectedThreadRunStateRef.current = "stopped";
      upsertThread({
        ...previousThread,
        updatedAt: optimisticStoppedAt,
        runStatus: {
          ...previousThread.runStatus,
          state: "stopped",
          updatedAt: optimisticStoppedAt,
          error: "Thread run was stopped by the user.",
          hasUnreadError: false,
        },
      });
    }
    void (async () => {
      try {
        const detail = await procedures.stopThreadTurn({
          threadId: selectedThreadId,
        });
        upsertThread(detail.thread);
        if (selectedThreadIdRef.current === detail.thread.id) {
          selectedThreadRunStateRef.current =
            buildMainviewShellSelectedThreadDetailRefreshState(detail).runState;
          mergeSelectedThreadMessageHistory(detail);
        }
      } catch (error) {
        if (previousThread) {
          upsertThread(previousThread);
          if (selectedThreadIdRef.current === previousThread.id) {
            selectedThreadRunStateRef.current = previousThread.runStatus.state;
          }
        }
        if (selectedThreadIdRef.current === selectedThreadId) {
          setChatError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        setIsStoppingThread(false);
      }
    })();
  }, [
    isStoppingThread,
    mergeSelectedThreadMessageHistory,
    procedures,
    selectedThread,
    selectedThreadId,
    selectedThreadIdRef,
    selectedThreadIsWorking,
    selectedThreadRunStateRef,
    setChatError,
    setIsStoppingThread,
    upsertThread,
  ]);

  return {
    isSending,
    isStoppingThread,
    isThreadEmptyDiscardProtected,
    postMessage,
    stopSelectedThreadTurn,
  };
}
