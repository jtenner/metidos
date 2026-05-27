/**
 * @file src/mainview/app/use-thread-workspace-controller.ts
 * @description Composed selected Thread workspace workflow controller for Mainview.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ProjectProcedures,
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcReasoningEffort,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadPermissionDescriptor,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import type { ThreadStore } from "./thread-store";
import { useThreadMessageHistoryController } from "./use-thread-message-history-controller";
import { useThreadSettingsController } from "./use-thread-settings-controller";
import {
  type ThreadTurnBusyState,
  useThreadTurnController,
} from "./use-thread-turn-controller";
import { useThreadStatusController } from "./use-thread-status-controller";
import {
  type ThreadWorkspaceSelectionActions,
  type ThreadWorkspaceSelectionController,
  type ThreadWorkspaceSelectionControllerProps,
  type ThreadWorkspaceSelectionThreads,
  useThreadWorkspaceSelectionController,
} from "./use-thread-workspace-selection-controller";

type ThreadWorkspaceSelectionConfig = {
  actions: Omit<
    ThreadWorkspaceSelectionActions,
    | "abortThreadHistoryBackfill"
    | "prepareOpenedThreadDetail"
    | "replaceSelectedThreadMessageHistory"
  >;
  projectState: ThreadWorkspaceSelectionControllerProps["projectState"];
  refs: ThreadWorkspaceSelectionControllerProps["refs"];
  selection: ThreadWorkspaceSelectionControllerProps["selection"];
  setters: ThreadWorkspaceSelectionControllerProps["setters"];
  threads: Omit<ThreadWorkspaceSelectionThreads, "threads">;
};

export type ThreadWorkspaceControllerProps = {
  activeCodexModel: string;
  activeModelProviderAvailableForThreadCreation: boolean;
  activeReasoningEffort: RpcReasoningEffort;
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  codexModels: RpcModelOption[];
  defaultCodexModel: string;
  defaultCodexReasoningEffort: RpcReasoningEffort;
  discardThreadIfEmpty: (threadId: number) => Promise<void>;
  initialChatInput: string;
  isDocumentVisible: boolean;
  isUpdatingThreadAccess: boolean;
  isUpdatingThreadModel: boolean;
  isUpdatingThreadReasoningEffort: boolean;
  procedures: ProjectProcedures;
  selection: ThreadWorkspaceSelectionConfig;
  selectedComposerDraftKey: string | null;
  selectedThread: RpcThread | null;
  selectedThreadDetailRefreshKeyRef: MutableRefObject<string | null>;
  selectedThreadId: number | null;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedThreadIsWorking: boolean;
  selectedThreadRunStateRef: MutableRefObject<RpcThreadRunStatus["state"]>;
  setChatError: Dispatch<SetStateAction<string>>;
  setIsUpdatingThreadAccess: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingThreadModel: Dispatch<SetStateAction<boolean>>;
  setIsUpdatingThreadReasoningEffort: Dispatch<SetStateAction<boolean>>;
  setModelControlError: Dispatch<SetStateAction<string>>;
  setPendingThreadAccessValue: (access: ThreadAccessValue) => void;
  setPendingThreadModel: Dispatch<SetStateAction<string>>;
  setPendingThreadReasoningEffort: Dispatch<SetStateAction<RpcReasoningEffort>>;
  setReasoningEffortControlError: Dispatch<SetStateAction<string>>;
  setThreadAccessControlError: Dispatch<SetStateAction<string>>;
  setThreadMessages: Dispatch<SetStateAction<RpcThreadMessage[]>>;
  setThreadStore: Dispatch<SetStateAction<ThreadStore>>;
  threadStoreRef: MutableRefObject<ThreadStore>;
  threadTurnBusyState: ThreadTurnBusyState;
  threads: RpcThread[];
  upsertThread: (thread: RpcThread) => void;
  applyOptimisticThreadErrorSeenToList: (threads: RpcThread[]) => RpcThread[];
  prepareOpenedThreadDetail: (detail: RpcThreadDetail) => RpcThreadDetail;
};

export type ThreadWorkspaceController = {
  history: {
    abortThreadHistoryBackfill: (reason: string) => void;
    mergeSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
    replaceSelectedThreadMessageHistory: (detail: RpcThreadDetail) => void;
  };
  selection: ThreadWorkspaceSelectionController;
  settings: {
    updateActiveCodexModel: (model: string) => Promise<boolean>;
    updateActiveReasoningEffort: (
      reasoningEffort: RpcReasoningEffort,
    ) => Promise<boolean>;
    updateActiveThreadAccess: (access: ThreadAccessValue) => Promise<void>;
  };
  turn: {
    isSending: boolean;
    isStoppingThread: boolean;
    isThreadEmptyDiscardProtected: (threadId: number) => boolean;
    postMessage: () => void;
    stopSelectedThreadTurn: () => void;
  };
};

export function useThreadWorkspaceController({
  activeCodexModel,
  activeModelProviderAvailableForThreadCreation,
  activeReasoningEffort,
  applyOptimisticThreadErrorSeenToList,
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  codexModels,
  defaultCodexModel,
  defaultCodexReasoningEffort,
  discardThreadIfEmpty,
  initialChatInput,
  isDocumentVisible,
  isUpdatingThreadAccess,
  isUpdatingThreadModel,
  isUpdatingThreadReasoningEffort,
  prepareOpenedThreadDetail,
  procedures,
  selection: selectionConfig,
  selectedComposerDraftKey,
  selectedThread,
  selectedThreadDetailRefreshKeyRef,
  selectedThreadId,
  selectedThreadIdRef,
  selectedThreadIsWorking,
  selectedThreadRunStateRef,
  setChatError,
  setIsUpdatingThreadAccess,
  setIsUpdatingThreadModel,
  setIsUpdatingThreadReasoningEffort,
  setModelControlError,
  setPendingThreadAccessValue,
  setPendingThreadModel,
  setPendingThreadReasoningEffort,
  setReasoningEffortControlError,
  setThreadAccessControlError,
  setThreadMessages,
  setThreadStore,
  threadStoreRef,
  threadTurnBusyState,
  threads,
  upsertThread,
}: ThreadWorkspaceControllerProps): ThreadWorkspaceController {
  const history = useThreadMessageHistoryController({
    procedures,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
    setThreadMessages,
  });

  const settings = useThreadSettingsController({
    availablePluginAccessGroups,
    availableThreadPermissionDescriptors,
    defaultCodexModel,
    defaultCodexReasoningEffort,
    isUpdatingThreadAccess,
    isUpdatingThreadModel,
    isUpdatingThreadReasoningEffort,
    procedures,
    selectedThread,
    selectedThreadIdRef,
    setIsUpdatingThreadAccess,
    setIsUpdatingThreadModel,
    setIsUpdatingThreadReasoningEffort,
    setModelControlError,
    setPendingThreadAccessValue,
    setPendingThreadModel,
    setPendingThreadReasoningEffort,
    setReasoningEffortControlError,
    setThreadAccessControlError,
    upsertThread,
  });

  const selection = useThreadWorkspaceSelectionController({
    actions: {
      ...selectionConfig.actions,
      abortThreadHistoryBackfill: history.abortThreadHistoryBackfill,
      prepareOpenedThreadDetail,
      replaceSelectedThreadMessageHistory:
        history.replaceSelectedThreadMessageHistory,
    },
    modelDefaults: {
      activeCodexModel,
      activeModelProviderAvailable:
        activeModelProviderAvailableForThreadCreation,
      activeReasoningEffort,
      defaultCodexModel,
      defaultCodexReasoningEffort,
    },
    procedures,
    projectState: selectionConfig.projectState,
    refs: selectionConfig.refs,
    selection: selectionConfig.selection,
    setters: selectionConfig.setters,
    threads: {
      ...selectionConfig.threads,
      threads,
    },
  });

  const activeSelectionProjectId = selectionConfig.selection.selectedProjectId;
  const activeSelectionWorktreePath =
    selectionConfig.selection.activeSelectedWorktreePath;
  const createThreadForActiveWorktree =
    activeSelectionProjectId !== null && activeSelectionWorktreePath
      ? () =>
          selection.createThreadForWorktree(
            activeSelectionProjectId,
            activeSelectionWorktreePath,
          )
      : undefined;

  const turn = useThreadTurnController({
    activeCodexModel,
    busyState: threadTurnBusyState,
    codexModels,
    createThreadForActiveWorktree,
    initialChatInput,
    mergeSelectedThreadMessageHistory:
      history.mergeSelectedThreadMessageHistory,
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
  });

  useThreadStatusController({
    applyOptimisticThreadErrorSeenToList,
    discardThreadIfEmpty,
    isDocumentVisible,
    isThreadEmptyDiscardProtected: turn.isThreadEmptyDiscardProtected,
    mergeSelectedThreadMessageHistory:
      history.mergeSelectedThreadMessageHistory,
    prepareOpenedThreadDetail,
    procedures,
    selectedThreadId,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
    selectedThreadRunStateRef,
    setThreadStore,
    threads,
  });

  return {
    history,
    selection,
    settings,
    turn,
  };
}
