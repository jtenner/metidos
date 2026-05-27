import { describe, expect, it } from "bun:test";
import type { Dispatch, SetStateAction } from "react";
import { renderToString } from "react-dom/server";
import type {
  ProjectProcedures,
  RpcReasoningEffort,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcWorktree,
} from "../../bun/rpc-schema";
import { buildProjectWorktreeIndex } from "./project-worktree-state";
import type { ThreadStore } from "./thread-store";
import {
  type ThreadWorkspaceController,
  useThreadWorkspaceController,
} from "./use-thread-workspace-controller";

function worktree(path = "/repo"): RpcWorktree {
  return {
    bare: false,
    branch: "main",
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    id: 11,
    projectId: 7,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    worktreePath: "/repo",
    ...overrides,
  } as RpcThread;
}

function message(id: number, text: string): RpcThreadMessage {
  return {
    id,
    kind: "chat",
    role: "assistant",
    text,
    threadId: 11,
  } as RpcThreadMessage;
}

function detail(options?: {
  messages?: RpcThreadMessage[];
  openedThread?: RpcThread;
}): RpcThreadDetail {
  return {
    messages: options?.messages ?? [],
    nextCursor: null,
    thread: options?.openedThread ?? thread(),
  };
}

function applySetState<T>(current: T, value: SetStateAction<T>): T {
  return typeof value === "function"
    ? (value as (previous: T) => T)(current)
    : value;
}

type RenderedController = {
  calls: string[];
  controller: ThreadWorkspaceController;
  readChatError: () => string;
  readMessages: () => RpcThreadMessage[];
  readPendingThreadModel: () => string;
  readThreadStore: () => ThreadStore;
  selectedThreadDetailRefreshKeyRef: { current: string | null };
  selectedThreadIdRef: { current: number | null };
};

function renderController(input?: {
  procedures?: Partial<ProjectProcedures>;
  selectedThread?: RpcThread | null;
  selectedThreadId?: number | null;
  threadStore?: ThreadStore;
  threads?: RpcThread[];
}): RenderedController {
  let controller: ThreadWorkspaceController | null = null;
  const calls: string[] = [];
  let chatError = "";
  let isSending = false;
  let isStoppingThread = false;
  let isUpdatingThreadAccess = false;
  let isUpdatingThreadModel = false;
  let isUpdatingThreadReasoningEffort = false;
  let messages: RpcThreadMessage[] = [];
  let pendingThreadModel = "openai:gpt-5.4";
  let pendingThreadReasoningEffort: RpcReasoningEffort = "medium";
  let threadStore: ThreadStore = input?.threadStore ?? {
    byId: {},
    orderedIds: [],
  };
  const threadStoreRef = { current: threadStore };
  const selectedProjectIdRef = { current: 7 as number | null };
  const selectedThreadDetailRefreshKeyRef = { current: null as string | null };
  const selectedThreadIdRef = {
    current: input?.selectedThreadId ?? input?.selectedThread?.id ?? null,
  };
  const selectedThreadRunStateRef = { current: "idle" as const };
  const selectedWorktreePathRef = { current: "/repo" as string | null };

  const setThreadStore: Dispatch<SetStateAction<ThreadStore>> = (value) => {
    threadStore = applySetState(threadStore, value);
    threadStoreRef.current = threadStore;
  };
  const upsertThread = (upsertedThread: RpcThread) => {
    calls.push(`upsertThread:${upsertedThread.id}`);
    setThreadStore((current) => ({
      byId: { ...current.byId, [upsertedThread.id]: upsertedThread },
      orderedIds: current.orderedIds.includes(upsertedThread.id)
        ? current.orderedIds
        : [...current.orderedIds, upsertedThread.id],
    }));
  };

  function TestHarness(): null {
    controller = useThreadWorkspaceController({
      activeCodexModel: "openai:gpt-5.4",
      activeModelProviderAvailableForThreadCreation: true,
      activeReasoningEffort: "medium",
      applyOptimisticThreadErrorSeenToList: (items) => items,
      availablePluginAccessGroups: [],
      availableThreadPermissionDescriptors: [],
      codexModels: [],
      defaultCodexModel: "openai:gpt-5.4",
      defaultCodexReasoningEffort: "medium",
      discardThreadIfEmpty: async (threadId) => {
        calls.push(`discardThreadIfEmpty:${threadId}`);
      },
      initialChatInput: "",
      isDocumentVisible: true,
      isUpdatingThreadAccess,
      isUpdatingThreadModel,
      isUpdatingThreadReasoningEffort,
      prepareOpenedThreadDetail: (openedDetail) => openedDetail,
      procedures: {
        createThread: async () => detail(),
        getThread: async ({ threadId }) =>
          detail({
            messages: [message(2, "loaded")],
            openedThread: thread({
              id: threadId,
              runStatus: {
                error: null,
                hasUnreadError: false,
                startedAt: null,
                state: "idle",
                updatedAt: "2026-05-27T12:00:00.000Z",
              },
            }),
          }),
        sendThreadMessage: async ({ threadId }) =>
          detail({ openedThread: thread({ id: threadId }) }),
        stopThreadTurn: async ({ threadId }) =>
          detail({ openedThread: thread({ id: threadId }) }),
        updateThreadAccess: async ({ threadId }) => thread({ id: threadId }),
        updateThreadModel: async ({ model, threadId }) =>
          thread({ id: threadId, model }),
        updateThreadReasoningEffort: async ({ reasoningEffort, threadId }) =>
          thread({ id: threadId, reasoningEffort }),
        ...input?.procedures,
      } as ProjectProcedures,
      selectedComposerDraftKey: null,
      selectedThread: input?.selectedThread ?? null,
      selectedThreadDetailRefreshKeyRef,
      selectedThreadId: selectedThreadIdRef.current,
      selectedThreadIdRef,
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef,
      selection: {
        actions: {
          ensureWorktreeOpen: async (projectId, worktreePath) => {
            calls.push(`ensureWorktreeOpen:${projectId}:${worktreePath}`);
          },
          executeRpcAction: async (_label, action) => action(),
          loadProjectWorktrees: async () => [],
          removeThread: (threadId) => calls.push(`removeThread:${threadId}`),
          selectProject: (selectedProject, worktreePath) => {
            calls.push(`selectProject:${selectedProject.id}:${worktreePath}`);
            selectedProjectIdRef.current = selectedProject.id;
            selectedWorktreePathRef.current = worktreePath ?? null;
          },
          upsertProject: (upsertedProject) =>
            calls.push(`upsertProject:${upsertedProject.id}`),
          upsertThread,
        },
        projectState: {
          getProjectState: () => ({
            ...buildProjectWorktreeIndex([worktree()]),
            error: "",
            loadingWorktrees: false,
            openWorktrees: new Set<string>(),
            worktreesLoadedAt: 1,
          }),
          getWorktreeState: () => ({
            error: "",
            loading: false,
            opened: false,
          }),
          setProjectState: (projectId) =>
            calls.push(`setProjectState:${projectId}`),
        },
        refs: {
          selectedProjectIdRef,
          selectedThreadDetailRefreshKeyRef,
          selectedThreadIdRef,
          selectedThreadRunStateRef,
          selectedWorktreePathRef,
          threadStoreRef,
        },
        selection: {
          activeSelectedWorktreeOpened: false,
          activeSelectedWorktreePath: selectedWorktreePathRef.current,
          isApprovingThreadStartRequest: false,
          isThreadLoading: false,
          selectedProjectId: selectedProjectIdRef.current,
          selectedThread: input?.selectedThread ?? null,
          selectedThreadId: selectedThreadIdRef.current,
          sessionStateReady: true,
        },
        setters: {
          setChatError: (value) => {
            chatError = applySetState(chatError, value);
          },
          setIsApprovingThreadStartRequest: () => {},
          setIsCreatingThread: () => {},
          setIsThreadLoading: (value) =>
            calls.push(`setIsThreadLoading:${String(value)}`),
          setMobileProjectListOpen: (value) =>
            calls.push(`setMobileProjectListOpen:${String(value)}`),
          setModelControlError: () => {},
          setPendingThreadStartRequests: () => {},
          setPrimaryView: (value) => calls.push(`setPrimaryView:${value}`),
          setReasoningEffortControlError: () => {},
          setSelectedProjectId: (value) => {
            selectedProjectIdRef.current = applySetState(
              selectedProjectIdRef.current,
              value,
            );
          },
          setSelectedThreadId: (value) => {
            selectedThreadIdRef.current = applySetState(
              selectedThreadIdRef.current,
              value,
            );
          },
          setSelectedWorktreePath: (value) => {
            selectedWorktreePathRef.current = applySetState(
              selectedWorktreePathRef.current,
              value,
            );
          },
          setThreadAccessControlError: () => {},
          setThreadMessages: (value) => {
            messages = applySetState(messages, value);
          },
          setThreadsError: (value) => calls.push(`setThreadsError:${value}`),
          setThreadStartRequestError: () => {},
        },
        threads: {
          safeChildAccessDefaults: {
            agentsAccess: false,
            gitAccess: false,
            githubAccess: false,
            metidosAccess: true,
            permissions: [],
            sqliteAccess: false,
            unsafeMode: false,
            webSearchAccess: false,
          },
        },
      },
      setChatError: (value) => {
        chatError = applySetState(chatError, value);
      },
      setIsUpdatingThreadAccess: (value) => {
        isUpdatingThreadAccess = applySetState(isUpdatingThreadAccess, value);
      },
      setIsUpdatingThreadModel: (value) => {
        isUpdatingThreadModel = applySetState(isUpdatingThreadModel, value);
      },
      setIsUpdatingThreadReasoningEffort: (value) => {
        isUpdatingThreadReasoningEffort = applySetState(
          isUpdatingThreadReasoningEffort,
          value,
        );
      },
      setModelControlError: () => {},
      setPendingThreadAccessValue: () => {},
      setPendingThreadModel: (value) => {
        pendingThreadModel = applySetState(pendingThreadModel, value);
      },
      setPendingThreadReasoningEffort: (value) => {
        pendingThreadReasoningEffort = applySetState(
          pendingThreadReasoningEffort,
          value,
        );
      },
      setReasoningEffortControlError: () => {},
      setThreadAccessControlError: () => {},
      setThreadMessages: (value) => {
        messages = applySetState(messages, value);
      },
      setThreadStore,
      threadStoreRef,
      threadTurnBusyState: {
        state: { isSending, isStoppingThread },
        setters: {
          setIsSending: (value) => {
            isSending = applySetState(isSending, value);
          },
          setIsStoppingThread: (value) => {
            isStoppingThread = applySetState(isStoppingThread, value);
          },
        },
      },
      threads: input?.threads ?? [],
      upsertThread,
    });
    return null;
  }

  renderToString(<TestHarness />);
  if (!controller) {
    throw new Error("Expected test harness to expose controller.");
  }
  return {
    calls,
    controller,
    readChatError: () => chatError,
    readMessages: () => messages,
    readPendingThreadModel: () => pendingThreadModel,
    readThreadStore: () => threadStore,
    selectedThreadDetailRefreshKeyRef,
    selectedThreadIdRef,
  };
}

describe("useThreadWorkspaceController", () => {
  it("opens a Thread through the consolidated selection seam and replaces message history", async () => {
    const { calls, controller, readMessages, selectedThreadIdRef } =
      renderController();

    await controller.selection.openThread(11);

    expect(selectedThreadIdRef.current).toBe(11);
    expect(readMessages().map((item) => item.id)).toEqual([2]);
    expect(calls).toContain("setPrimaryView:chat");
    expect(calls).toContain("upsertThread:11");
    expect(calls).toContain("setMobileProjectListOpen:false");
  });

  it("updates selected Thread model through the consolidated settings seam", async () => {
    const selectedThread = thread({ id: 11, model: "openai:gpt-5.4" });
    const { controller, readPendingThreadModel, readThreadStore } =
      renderController({
        selectedThread,
        selectedThreadId: selectedThread.id,
        threadStore: {
          byId: { [selectedThread.id]: selectedThread },
          orderedIds: [selectedThread.id],
        },
        threads: [selectedThread],
      });

    await expect(
      controller.settings.updateActiveCodexModel("openai:gpt-5.5"),
    ).resolves.toBe(true);

    expect(readPendingThreadModel()).toBe("openai:gpt-5.5");
    expect(readThreadStore().byId[11]?.model).toBe("openai:gpt-5.5");
  });
});
