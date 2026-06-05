import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ProjectProcedures,
  RpcModelOption,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
  RpcThreadRunStatus,
} from "../../bun/rpc-schema";
import type { ThreadStore } from "./thread-store";
import {
  type ThreadTurnController,
  useThreadTurnController,
} from "./use-thread-turn-controller";

function thread(overrides: Partial<RpcThread> = {}): RpcThread {
  return {
    id: 42,
    model: "openai/gpt-4.1",
    permissions: [],
    pluginAccessGroups: [],
    projectId: 7,
    reasoningEffort: "medium",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: "2026-06-03T00:00:00.000Z",
      state: "working",
      updatedAt: "2026-06-03T00:00:00.000Z",
    },
    updatedAt: "2026-06-03T00:00:00.000Z",
    worktreePath: "/repo",
    ...overrides,
  } as RpcThread;
}

function detail(updatedThread: RpcThread): RpcThreadDetail {
  return {
    messages: [],
    nextCursor: null,
    thread: updatedThread,
  };
}

async function flushAsyncTurn(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function renderController(input?: {
  isSending?: boolean;
  isStoppingThread?: boolean;
  procedures?: Partial<ProjectProcedures>;
  selectedThread?: RpcThread | null;
  selectedThreadId?: number | null;
  selectedThreadIdRef?: { current: number | null };
  selectedThreadIsWorking?: boolean;
  selectedThreadRunStateRef?: { current: RpcThreadRunStatus["state"] };
}): {
  controller: ThreadTurnController;
  readState: () => {
    chatError: string;
    mergeCalls: RpcThreadDetail[];
    messages: RpcThreadMessage[];
    selectedThreadRunState: RpcThreadRunStatus["state"];
    sendingCalls: boolean[];
    stoppingCalls: boolean[];
    upsertedThreads: RpcThread[];
  };
  selectedThreadIdRef: { current: number | null };
} {
  let controller: ThreadTurnController | null = null;
  let chatError = "existing error";
  let messages: RpcThreadMessage[] = [];
  const selectedThread =
    input && "selectedThread" in input ? input.selectedThread : thread();
  const selectedThreadId =
    input && "selectedThreadId" in input
      ? input.selectedThreadId
      : (selectedThread?.id ?? null);
  const selectedThreadIdRef = input?.selectedThreadIdRef ?? {
    current: selectedThreadId,
  };
  const selectedThreadRunStateRef = input?.selectedThreadRunStateRef ?? {
    current: selectedThread?.runStatus.state ?? "idle",
  };
  const sendingCalls: boolean[] = [];
  const stoppingCalls: boolean[] = [];
  const upsertedThreads: RpcThread[] = [];
  const mergeCalls: RpcThreadDetail[] = [];
  const threadStore: ThreadStore = {
    byId: selectedThread ? { [selectedThread.id]: selectedThread } : {},
    orderedIds: selectedThread ? [selectedThread.id] : [],
  };

  function TestHarness(): null {
    controller = useThreadTurnController({
      activeCodexModel: "openai/gpt-4.1",
      busyState: {
        state: {
          isSending: input?.isSending ?? false,
          isStoppingThread: input?.isStoppingThread ?? false,
        },
        setters: {
          setIsSending: (value) => {
            sendingCalls.push(Boolean(value));
          },
          setIsStoppingThread: (value) => {
            stoppingCalls.push(Boolean(value));
          },
        },
      },
      codexModels: [] as RpcModelOption[],
      initialChatInput: "",
      mergeSelectedThreadMessageHistory: (updatedDetail) => {
        mergeCalls.push(updatedDetail);
      },
      procedures: {
        sendThreadMessage: async () => detail(thread()),
        stopThreadTurn: async () =>
          detail(
            thread({
              runStatus: {
                error: "Thread run was stopped by the user.",
                hasUnreadError: false,
                startedAt: "2026-06-03T00:00:00.000Z",
                state: "stopped",
                updatedAt: "2026-06-03T00:01:00.000Z",
              },
              updatedAt: "2026-06-03T00:01:00.000Z",
            }),
          ),
        ...input?.procedures,
      } as ProjectProcedures,
      selectedComposerDraftKey: "draft:42",
      selectedThread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadId,
      selectedThreadIdRef,
      selectedThreadIsWorking: input?.selectedThreadIsWorking ?? true,
      selectedThreadRunStateRef,
      setChatError: (value) => {
        chatError = typeof value === "function" ? value(chatError) : value;
      },
      setThreadMessages: (value) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
      threadStoreRef: { current: threadStore },
      upsertThread: (updatedThread) => {
        upsertedThreads.push(updatedThread);
      },
    });
    return null;
  }

  renderToString(<TestHarness />);
  if (!controller) {
    throw new Error("Expected test harness to expose controller.");
  }

  return {
    controller,
    readState: () => ({
      chatError,
      mergeCalls,
      messages,
      selectedThreadRunState: selectedThreadRunStateRef.current,
      sendingCalls,
      stoppingCalls,
      upsertedThreads,
    }),
    selectedThreadIdRef,
  };
}

describe("useThreadTurnController", () => {
  it("optimistically marks a working Thread stopped and merges the successful stop result", async () => {
    const { controller, readState } = renderController();

    controller.stopSelectedThreadTurn();
    const optimisticState = readState();

    expect(optimisticState.chatError).toBe("");
    expect(optimisticState.selectedThreadRunState).toBe("stopped");
    expect(optimisticState.stoppingCalls).toEqual([true]);
    expect(optimisticState.upsertedThreads[0]?.runStatus).toMatchObject({
      error: "Thread run was stopped by the user.",
      hasUnreadError: false,
      state: "stopped",
    });

    await flushAsyncTurn();

    expect(readState()).toMatchObject({
      mergeCalls: [
        {
          thread: {
            id: 42,
            runStatus: { state: "stopped" },
          },
        },
      ],
      stoppingCalls: [true, false],
    });
    expect(readState().upsertedThreads.at(-1)?.updatedAt).toBe(
      "2026-06-03T00:01:00.000Z",
    );
  });

  it("does not surface a stale stop failure after switching threads", async () => {
    let rejectStop!: (error: Error) => void;
    const stopPromise = new Promise<RpcThreadDetail>((_, reject) => {
      rejectStop = reject;
    });
    const previousThread = thread({ id: 42 });
    const selectedThreadIdRef = { current: 42 as number | null };
    const selectedThreadRunStateRef: {
      current: RpcThreadRunStatus["state"];
    } = { current: "working" };
    const { controller, readState } = renderController({
      procedures: {
        stopThreadTurn: async () => stopPromise,
      },
      selectedThread: previousThread,
      selectedThreadIdRef,
      selectedThreadRunStateRef,
    });

    controller.stopSelectedThreadTurn();
    selectedThreadIdRef.current = 99;
    selectedThreadRunStateRef.current = "idle";
    rejectStop(new Error("stop RPC unavailable"));
    await stopPromise.catch(() => null);
    await flushAsyncTurn();

    expect(readState()).toMatchObject({
      chatError: "",
      selectedThreadRunState: "idle",
      stoppingCalls: [true, false],
    });
    expect(readState().upsertedThreads.at(-1)).toEqual(previousThread);
  });

  it("rolls back the optimistic stop state when the stop RPC fails", async () => {
    const previousThread = thread({
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: "2026-06-03T00:00:00.000Z",
        state: "working",
        updatedAt: "2026-06-03T00:00:00.000Z",
      },
    });
    const { controller, readState } = renderController({
      procedures: {
        stopThreadTurn: async () => {
          throw new Error("stop RPC unavailable");
        },
      },
      selectedThread: previousThread,
      selectedThreadRunStateRef: { current: "working" },
    });

    controller.stopSelectedThreadTurn();
    await flushAsyncTurn();

    expect(readState()).toMatchObject({
      chatError: "stop RPC unavailable",
      selectedThreadRunState: "working",
      stoppingCalls: [true, false],
    });
    expect(readState().upsertedThreads.at(-1)).toEqual(previousThread);
  });

  it("ignores stop requests when no selected Thread is currently working", () => {
    let stopCalls = 0;
    const { controller, readState } = renderController({
      procedures: {
        stopThreadTurn: async () => {
          stopCalls += 1;
          return detail(thread());
        },
      },
      selectedThreadIsWorking: false,
    });

    controller.stopSelectedThreadTurn();

    expect(stopCalls).toBe(0);
    expect(readState()).toMatchObject({
      chatError: "existing error",
      stoppingCalls: [],
      upsertedThreads: [],
    });
  });

  it("protects empty-thread discard only while a send is in flight", () => {
    expect(
      renderController({
        isSending: true,
      }).controller.isThreadEmptyDiscardProtected(42),
    ).toBe(true);
    expect(
      renderController({
        isSending: false,
      }).controller.isThreadEmptyDiscardProtected(42),
    ).toBe(false);
  });
});
