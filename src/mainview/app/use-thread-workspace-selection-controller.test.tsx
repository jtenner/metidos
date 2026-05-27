import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ProjectProcedures,
  RpcProject,
  RpcThread,
  RpcThreadDetail,
  RpcWorktree,
} from "../../bun/rpc-schema";
import {
  readChatComposerImageAttachments,
  resetChatComposerImageAttachmentStoreForTest,
  setChatComposerImageAttachments,
} from "../controls/chat-composer-image-attachments";
import { buildProjectWorktreeIndex } from "./project-worktree-state";
import {
  resolveSelectedWorktreeThreadSyncPlanForModel,
  useThreadWorkspaceSelectionController,
} from "./use-thread-workspace-selection-controller";

type Controller = ReturnType<typeof useThreadWorkspaceSelectionController>;
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function project(overrides?: Partial<RpcProject>): RpcProject {
  return {
    id: 7,
    isOpen: 1,
    name: "Project",
    path: "/repo",
    ...overrides,
  } as RpcProject;
}

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

function detail(openedThread = thread()): RpcThreadDetail {
  return {
    messages: [],
    nextCursor: null,
    thread: openedThread,
  };
}

function renderController(input: {
  calls: string[];
  procedures?: Partial<ProjectProcedures>;
  selectedProjectIdRef?: { current: number | null };
  selectedThreadIdRef?: { current: number | null };
  selectedWorktreePathRef?: { current: string | null };
  threads?: RpcThread[];
  worktreeOpened?: boolean;
}): Controller {
  let controller: Controller | null = null;
  const calls = input.calls;
  const selectedProjectIdRef = input.selectedProjectIdRef ?? { current: null };
  const selectedThreadIdRef = input.selectedThreadIdRef ?? { current: null };
  const selectedThreadRunStateRef = { current: "idle" as const };
  const selectedWorktreePathRef = input.selectedWorktreePathRef ?? {
    current: null,
  };
  const selectedThreadDetailRefreshKeyRef = { current: null };

  function TestHarness(): null {
    controller = useThreadWorkspaceSelectionController({
      actions: {
        abortThreadHistoryBackfill: (reason) =>
          calls.push(`abortHistory:${reason}`),
        ensureWorktreeOpen: async (projectId, worktreePath) => {
          calls.push(`ensureWorktreeOpen:${projectId}:${worktreePath}`);
        },
        executeRpcAction: async (_label, action) => action(),
        loadProjectWorktrees: async () => [],
        prepareOpenedThreadDetail: (openedDetail) => openedDetail,
        replaceSelectedThreadMessageHistory: () =>
          calls.push("replaceSelectedThreadMessageHistory"),
        removeThread: (threadId) => calls.push(`removeThread:${threadId}`),
        selectProject: (selectedProject, worktreePath) => {
          calls.push(`selectProject:${selectedProject.id}:${worktreePath}`);
          selectedProjectIdRef.current = selectedProject.id;
          selectedWorktreePathRef.current = worktreePath ?? null;
        },
        upsertProject: (upsertedProject) =>
          calls.push(`upsertProject:${upsertedProject.id}`),
        upsertThread: (upsertedThread) =>
          calls.push(`upsertThread:${upsertedThread.id}`),
      },
      modelDefaults: {
        activeCodexModel: "openai:gpt-5.4",
        activeModelProviderAvailable: true,
        activeReasoningEffort: "medium",
        defaultCodexModel: "openai:gpt-5.4",
        defaultCodexReasoningEffort: "medium",
      },
      procedures: {
        createThread: async () => detail(),
        discardEmptyThread: async () => undefined,
        getThread: async ({ threadId }) => detail(thread({ id: threadId })),
        openProject: async () => ({
          project: project(),
          worktrees: [worktree()],
        }),
        ...input.procedures,
      } as ProjectProcedures,
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
          opened: input.worktreeOpened ?? false,
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
        threadStoreRef: { current: { byId: {}, orderedIds: [] } },
      },
      selection: {
        activeSelectedWorktreeOpened: false,
        activeSelectedWorktreePath: selectedWorktreePathRef.current,
        isApprovingThreadStartRequest: false,
        isThreadLoading: false,
        selectedProjectId: selectedProjectIdRef.current,
        selectedThread: null,
        selectedThreadId: selectedThreadIdRef.current,
        sessionStateReady: true,
      },
      setters: {
        setChatError: () => {},
        setIsApprovingThreadStartRequest: () => {},
        setIsCreatingThread: () => {},
        setIsThreadLoading: () => {},
        setMobileProjectListOpen: (value) =>
          calls.push(`setMobileProjectListOpen:${String(value)}`),
        setModelControlError: () => {},
        setPendingThreadStartRequests: () => {},
        setPrimaryView: (value) =>
          calls.push(`setPrimaryView:${String(value)}`),
        setReasoningEffortControlError: () => {},
        setSelectedProjectId: (value) => {
          calls.push(`setSelectedProjectId:${String(value)}`);
          selectedProjectIdRef.current =
            typeof value === "function"
              ? value(selectedProjectIdRef.current)
              : value;
        },
        setSelectedThreadId: (value) => {
          calls.push(`setSelectedThreadId:${String(value)}`);
          selectedThreadIdRef.current =
            typeof value === "function"
              ? value(selectedThreadIdRef.current)
              : value;
        },
        setSelectedWorktreePath: (value) => {
          calls.push(`setSelectedWorktreePath:${String(value)}`);
          selectedWorktreePathRef.current =
            typeof value === "function"
              ? value(selectedWorktreePathRef.current)
              : value;
        },
        setThreadAccessControlError: () => {},
        setThreadMessages: () => calls.push("setThreadMessages"),
        setThreadStartRequestError: () => {},
        setThreadsError: (value) => calls.push(`setThreadsError:${value}`),
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
        threads: input.threads ?? [],
      },
    });
    return null;
  }

  renderToString(<TestHarness />);
  if (!controller) {
    throw new Error("Expected test harness to expose controller.");
  }
  return controller;
}

describe("thread workspace selection model guard", () => {
  it("keeps first-run missing-provider state from auto-creating a thread", () => {
    expect(
      resolveSelectedWorktreeThreadSyncPlanForModel(
        { action: "create-thread" },
        { activeModelProviderAvailable: false },
      ),
    ).toEqual({ action: "noop" });

    expect(
      resolveSelectedWorktreeThreadSyncPlanForModel(
        { action: "open-thread", threadId: 7 },
        { activeModelProviderAvailable: false },
      ),
    ).toEqual({ action: "open-thread", threadId: 7 });
  });
});

describe("useThreadWorkspaceSelectionController", () => {
  it("opens already-selected closed worktrees through the controller command", async () => {
    const calls: string[] = [];
    const controller = renderController({
      calls,
      selectedProjectIdRef: { current: 7 },
      selectedThreadIdRef: { current: 11 },
      selectedWorktreePathRef: { current: "/repo" },
    });

    await controller.handleProjectWorktreeClick(project(), "/repo");

    expect(calls).toEqual([
      "setMobileProjectListOpen:false",
      "setThreadsError:",
      "ensureWorktreeOpen:7:/repo",
    ]);
  });

  it("clears stale thread selection before selecting a different worktree", async () => {
    const calls: string[] = [];
    const controller = renderController({
      calls,
      selectedProjectIdRef: { current: 7 },
      selectedThreadIdRef: { current: 11 },
      selectedWorktreePathRef: { current: "/old" },
      threads: [thread()],
    });

    await controller.handleProjectWorktreeClick(project(), "/repo");
    await Promise.resolve();

    expect(calls).toContain("setMobileProjectListOpen:false");
    expect(calls).toContain("abortHistory:Thread selection was cleared.");
    expect(calls).toContain("setSelectedThreadId:null");
    expect(calls).toContain("selectProject:7:/repo");
    expect(calls).toContain("ensureWorktreeOpen:7:/repo");
  });

  it("ignores stale project-open responses after a newer worktree click", async () => {
    const calls: string[] = [];
    const firstOpen = deferred<{
      hiddenWorktrees: RpcWorktree[];
      project: RpcProject;
      worktrees: RpcWorktree[];
    }>();
    const secondOpen = deferred<{
      hiddenWorktrees: RpcWorktree[];
      project: RpcProject;
      worktrees: RpcWorktree[];
    }>();
    let openProjectCallCount = 0;
    const selectedProjectIdRef = { current: null as number | null };
    const selectedWorktreePathRef = { current: null as string | null };
    const controller = renderController({
      calls,
      procedures: {
        getThread: async ({ threadId }) =>
          detail(
            thread({ id: threadId, projectId: 8, worktreePath: "/repo-b" }),
          ),
        openProject: async () => {
          openProjectCallCount += 1;
          return openProjectCallCount === 1
            ? firstOpen.promise
            : secondOpen.promise;
        },
      },
      selectedProjectIdRef,
      selectedWorktreePathRef,
      threads: [thread({ id: 81, projectId: 8, worktreePath: "/repo-b" })],
    });

    const staleClick = controller.handleProjectWorktreeClick(
      project({ id: 7, isOpen: 0, path: "/repo-a" }),
      "/repo-a",
    );
    const currentClick = controller.handleProjectWorktreeClick(
      project({ id: 8, isOpen: 0, path: "/repo-b" }),
      "/repo-b",
    );

    secondOpen.resolve({
      hiddenWorktrees: [],
      project: project({ id: 8, path: "/repo-b" }),
      worktrees: [worktree("/repo-b")],
    });
    await currentClick;
    firstOpen.resolve({
      hiddenWorktrees: [],
      project: project({ id: 7, path: "/repo-a" }),
      worktrees: [worktree("/repo-a")],
    });
    await staleClick;

    expect(calls).toContain("selectProject:8:/repo-b");
    expect(calls).not.toContain("selectProject:7:/repo-a");
    expect(selectedProjectIdRef.current).toBe(8);
    expect(selectedWorktreePathRef.current).toBe("/repo-b");
  });

  it("switches to chat as soon as a Thread is selected", async () => {
    const calls: string[] = [];
    const pending = deferred<RpcThreadDetail>();
    const controller = renderController({
      calls,
      procedures: {
        getThread: async () => pending.promise,
      },
      selectedProjectIdRef: { current: 7 },
      selectedWorktreePathRef: { current: "/repo" },
    });

    const openRequest = controller.openThread(11);

    expect(calls).toContain("setSelectedThreadId:11");
    expect(calls).toContain("setPrimaryView:chat");

    pending.resolve(detail(thread({ id: 11 })));
    await openRequest;
  });

  it("ignores stale Thread-open responses after a newer Thread is selected", async () => {
    const calls: string[] = [];
    const pending = new Map<number, Deferred<RpcThreadDetail>>();
    const selectedProjectIdRef = { current: 7 as number | null };
    const selectedThreadIdRef = { current: null as number | null };
    const selectedWorktreePathRef = { current: "/repo" as string | null };
    const controller = renderController({
      calls,
      procedures: {
        getThread: async ({ threadId }) => {
          const request = deferred<RpcThreadDetail>();
          pending.set(threadId, request);
          return request.promise;
        },
      },
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
    });

    const firstOpen = controller.openThread(11);
    const secondOpen = controller.openThread(12);

    pending.get(12)?.resolve(detail(thread({ id: 12, title: "Current" })));
    await secondOpen;
    pending.get(11)?.resolve(detail(thread({ id: 11, title: "Stale" })));
    await firstOpen;

    expect(calls).toContain("upsertThread:12");
    expect(calls).not.toContain("upsertThread:11");
    expect(calls).toContain("replaceSelectedThreadMessageHistory");
    expect(selectedProjectIdRef.current).toBe(7);
    expect(selectedThreadIdRef.current).toBe(12);
    expect(selectedWorktreePathRef.current).toBe("/repo");
  });

  it("discards persisted auto-created Threads when the Worktree selection changes first", async () => {
    const calls: string[] = [];
    const createdThread = deferred<RpcThreadDetail>();
    const selectedProjectIdRef = { current: 7 as number | null };
    const selectedThreadIdRef = { current: null as number | null };
    const selectedWorktreePathRef = { current: "/repo" as string | null };
    const controller = renderController({
      calls,
      procedures: {
        createThread: async () => createdThread.promise,
        discardEmptyThread: async ({ threadId }) => {
          calls.push(`discardEmptyThread:${threadId}`);
          return { discarded: true, threadId };
        },
      },
      selectedProjectIdRef,
      selectedThreadIdRef,
      selectedWorktreePathRef,
    });

    const createRequest = controller.createThreadForWorktree(7, "/repo", {
      requireNoSelectedThread: true,
    });
    expect(calls).toContain("upsertThread:-1");
    expect(selectedThreadIdRef.current).toBe(-1);

    selectedWorktreePathRef.current = "/repo/other";
    createdThread.resolve(detail(thread({ id: 101, worktreePath: "/repo" })));
    await createRequest;

    expect(calls).toContain("removeThread:-1");
    expect(calls).toContain("discardEmptyThread:101");
    expect(calls).not.toContain("upsertThread:101");
    expect(selectedThreadIdRef.current).toBe(-1);
    expect(selectedWorktreePathRef.current).toBe("/repo/other");
  });

  it("migrates new-thread composer images onto the persisted thread key", async () => {
    resetChatComposerImageAttachmentStoreForTest();
    setChatComposerImageAttachments(
      [
        {
          byteSize: 12,
          data: "aGVsbG8=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      "thread:none",
    );
    const calls: string[] = [];
    const selectedProjectIdRef = { current: 7 as number | null };
    const selectedWorktreePathRef = { current: "/repo" as string | null };
    const controller = renderController({
      calls,
      procedures: {
        createThread: async () =>
          detail(thread({ id: 101, worktreePath: "/repo" })),
      },
      selectedProjectIdRef,
      selectedWorktreePathRef,
    });

    await controller.createThreadForWorktree(7, "/repo");

    expect(readChatComposerImageAttachments("thread:101")).toHaveLength(1);
  });

  it("deduplicates concurrent create requests for the same Worktree", async () => {
    const calls: string[] = [];
    const createdThread = deferred<RpcThreadDetail>();
    let createThreadCallCount = 0;
    const controller = renderController({
      calls,
      procedures: {
        createThread: async () => {
          createThreadCallCount += 1;
          return createdThread.promise;
        },
      },
      selectedProjectIdRef: { current: 7 },
      selectedThreadIdRef: { current: null },
      selectedWorktreePathRef: { current: "/repo" },
    });

    const firstCreate = controller.createThreadForWorktree(7, "/repo");
    const secondCreate = controller.createThreadForWorktree(7, "/repo");

    expect(secondCreate).toBe(firstCreate);
    expect(createThreadCallCount).toBe(1);

    createdThread.resolve(detail(thread({ id: 101, worktreePath: "/repo" })));
    await firstCreate;

    expect(calls.filter((call) => call === "upsertThread:101")).toHaveLength(1);
  });
});
