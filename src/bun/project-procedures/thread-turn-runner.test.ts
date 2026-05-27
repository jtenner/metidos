import { describe, expect, it } from "bun:test";

import type { ThreadRecord } from "../db";
import type { PiThreadRuntime } from "../pi/thread-runtime";
import type { RpcThreadDetail, RpcThreadRunStatus } from "../rpc-schema";
import { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle";
import { ThreadTurnPersistenceCoordinator } from "./thread-turn-persistence";
import { ThreadTurnRunner } from "./thread-turn-runner";
import { ThreadTurnRuntimeCoordinator } from "./thread-turn-runtime";

function makeThread(input?: Partial<ThreadRecord>): ThreadRecord {
  return {
    activeTurnStartedAt: null,
    agentsAccess: 0,
    bashAccess: 0,
    calendarAccess: 0,
    codexReasoningEffort: "medium",
    createdAt: "2026-05-03T12:00:00.000Z",
    cronJobId: null,
    cronsAccess: 0,
    githubAccess: 0,
    id: 42,
    lastRunAt: null,
    maxInputTokens: 0,
    messagesAccess: 0,
    metidosAccess: 1,
    model: "openai:gpt-5.4",
    notificationsAccess: 0,
    ownerUserId: 7,
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    pluginAccessGroupsJson: "[]",
    projectId: 9,
    reasoningEffort: "medium",
    sqliteAccess: 0,
    summary: null,
    terminalAccess: 0,
    threadsAccess: 0,
    title: "Thread",
    unsafeMode: 0,
    updatedAt: "2026-05-03T12:00:00.000Z",
    usageCachedInputTokens: 0,
    usageCompactionCount: 0,
    usageInputTokens: 0,
    usageLastCompactionAfterInputTokens: null,
    usageLastCompactionAt: null,
    usageLastCompactionBeforeInputTokens: null,
    usageOutputTokens: 0,
    usageTriggerTokens: null,
    weatherAccess: 0,
    webSearchAccess: 0,
    webServerAccess: 0,
    worktreePath: "/repo",
    ...input,
  } as ThreadRecord;
}

function makeRunStatus(
  input?: Partial<RpcThreadRunStatus>,
): RpcThreadRunStatus {
  return {
    error: null,
    hasUnreadError: false,
    startedAt: null,
    state: "idle",
    updatedAt: null,
    ...input,
  };
}

function makeDetail(threadId: number): RpcThreadDetail {
  return {
    messages: [],
    nextCursor: null,
    thread: {
      id: threadId,
    } as RpcThreadDetail["thread"],
  };
}

function createRuntime(): PiThreadRuntime {
  return {
    reloadResources: async () => {},
    session: {
      abort: async () => {},
      dispose: () => {},
    },
  } as PiThreadRuntime;
}

function createRunner(options?: {
  assertModelProviderAvailable?: ThreadTurnRunnerConstructorArg["assertModelProviderAvailable"];
  createRuntime?: ConstructorParameters<
    typeof ThreadTurnRuntimeCoordinator
  >[0]["createRuntime"];
  persistQueuedUserMessage?: ConstructorParameters<
    typeof ThreadTurnPersistenceCoordinator
  >[0]["persistQueuedUserMessage"];
  recovery?: ThreadTurnRunnerConstructorArg["recovery"];
  runStatus?: RpcThreadRunStatus;
  runInBackground?: ThreadTurnRunnerConstructorArg["runInBackground"];
}) {
  const lifecycle = new ThreadRuntimeLifecycle({
    createAbortError: (_cause, message) => new Error(message),
    getNow: () => "2026-05-03T12:00:01.000Z",
    notifyThreadStatusChanged: () => {},
    threadDetailCacheMaxEntries: 8,
  });
  const calls: string[] = [];
  const runStatus = options?.runStatus ?? makeRunStatus();
  if (runStatus.state !== "idle") {
    lifecycle.setRunStatus(42, runStatus);
  }
  const persistence = new ThreadTurnPersistenceCoordinator({
    invalidateThreadDetail: (threadId) =>
      calls.push(`invalidateDetail:${threadId}`),
    markThreadStopped: (_threadId, message, stoppedAt) => {
      calls.push(`markStopped:${message}:${stoppedAt ?? "no-stopped-at"}`);
    },
    persistQueuedUserMessage:
      options?.persistQueuedUserMessage ??
      (async () => {
        calls.push("persistQueued");
      }),
    readDetail: async (threadId) => {
      calls.push("readDetail");
      return makeDetail(threadId);
    },
    stopInProgressCronRuns: (cronJobId) => calls.push(`stopCron:${cronJobId}`),
    stopInProgressMessages: (threadId) =>
      calls.push(`stopMessages:${threadId}`),
  });
  const runner = new ThreadTurnRunner({
    assertModelProviderAvailable:
      options?.assertModelProviderAvailable ??
      (() => calls.push("assertModel")),
    createAbortError: (_cause, message) => new Error(message),
    getNow: () => "2026-05-03T12:00:01.000Z",
    interruptedMessage: "Interrupted.",
    lifecycle,
    persistence,
    recovery: options?.recovery ?? {
      listInterruptedMessageStates: () => [],
      listThreads: () => [],
    },
    runInBackground:
      options?.runInBackground ??
      (async () => {
        calls.push("runInBackground");
      }),
    stopCompletionWaitMs: 1,
    stoppedMessage: "Stopped.",
    runtimeManager: new ThreadTurnRuntimeCoordinator({
      createRuntime:
        options?.createRuntime ??
        (async () => {
          calls.push("createRuntime");
          return createRuntime();
        }),
      lifecycle,
      syncRuntimeSessionState: () => calls.push("syncRuntime"),
    }),
  });

  return { calls, lifecycle, runner };
}

type ThreadTurnRunnerConstructorArg = ConstructorParameters<
  typeof ThreadTurnRunner
>[0];

describe("ThreadTurnRunner", () => {
  it("queues a turn through the lifecycle seam", async () => {
    const { calls, lifecycle, runner } = createRunner();
    const detail = await runner.queueMessage(makeThread(), "hello", [], null);

    expect(detail.thread.id).toBe(42);
    expect(calls).toEqual([
      "assertModel",
      "persistQueued",
      "runInBackground",
      "readDetail",
    ]);
    expect(lifecycle.currentRunStatus(makeThread()).state).toBe("working");
    expect(lifecycle.hasCompletion(42)).toBe(true);
  });

  it("does not persist or mark a thread working when model validation fails", async () => {
    const { calls, lifecycle, runner } = createRunner({
      assertModelProviderAvailable: () => {
        calls.push("assertModel");
        throw new Error("Provider is unavailable.");
      },
      persistQueuedUserMessage: async () => {
        calls.push("persistQueued");
      },
      runInBackground: async () => {
        calls.push("runInBackground");
      },
    });

    await expect(
      runner.queueMessage(makeThread(), "hello", [], null),
    ).rejects.toThrow("Provider is unavailable.");

    expect(calls).toEqual(["assertModel"]);
    expect(lifecycle.currentRunStatus(makeThread()).state).toBe("idle");
    expect(lifecycle.hasCompletion(42)).toBe(false);
  });

  it("passes turn execution context into background runner after persisting the queued message", async () => {
    const { calls, runner } = createRunner({
      runInBackground: async (params) => {
        calls.push(
          `runInBackground:${params.threadId}:${params.input}:${params.images.length}:${params.sessionId}:${params.startedAt}:${params.controller.signal.aborted ? "aborted" : "active"}`,
        );
      },
    });

    await runner.queueMessage(
      makeThread(),
      "with image",
      [
        {
          data: "aGVsbG8=",
          mimeType: "image/png",
          type: "image",
        },
      ],
      "session-1",
    );

    expect(calls).toEqual([
      "assertModel",
      "persistQueued",
      "runInBackground:42:with image:1:session-1:2026-05-03T12:00:01.000Z:active",
      "readDetail",
    ]);
  });

  it("leaves lifecycle idle when queued message persistence fails", async () => {
    const { calls, lifecycle, runner } = createRunner({
      persistQueuedUserMessage: async () => {
        calls.push("persistQueued");
        throw new Error("write failed");
      },
      runInBackground: async () => {
        calls.push("runInBackground");
      },
    });

    await expect(
      runner.queueMessage(makeThread(), "hello", [], null),
    ).rejects.toThrow("write failed");

    expect(calls).toEqual(["assertModel", "persistQueued"]);
    expect(lifecycle.currentRunStatus(makeThread()).state).toBe("idle");
    expect(lifecycle.getController(42)).toBeUndefined();
    expect(lifecycle.hasCompletion(42)).toBe(false);
  });

  it("rejects new turns while a thread is working or still settling", async () => {
    const working = createRunner({
      runStatus: makeRunStatus({ state: "working" }),
    });
    await expect(
      working.runner.queueMessage(makeThread(), "again", [], null),
    ).rejects.toThrow("Thread is already processing a message.");

    const settling = createRunner();
    settling.lifecycle.setCompletion(42, Promise.resolve());
    await expect(
      settling.runner.queueMessage(makeThread(), "again", [], null),
    ).rejects.toThrow("Thread is still stopping. Try again in a moment.");
  });

  it("reuses and reloads an active runtime through the lifecycle seam", async () => {
    const { calls, lifecycle, runner } = createRunner({
      createRuntime: async () => {
        calls.push("createRuntime");
        return createRuntime();
      },
    });
    const reloads: string[] = [];
    const activeRuntime = {
      reloadResources: async () => {
        reloads.push("reload");
      },
      session: {
        abort: async () => {},
        dispose: () => {},
      },
    } as PiThreadRuntime;
    lifecycle.setRuntime(42, activeRuntime);

    const runtime = await runner.ensureRuntime(makeThread(), "session-1");

    expect(runtime).toBe(activeRuntime);
    expect(reloads).toEqual(["reload"]);
    expect(calls).toEqual(["syncRuntime"]);
  });

  it("stops a working turn and waits on the active completion", async () => {
    const { calls, lifecycle, runner } = createRunner({
      runStatus: makeRunStatus({
        startedAt: "2026-05-03T12:00:00.000Z",
        state: "working",
      }),
      runInBackground: async () => {},
    });
    const controller = new AbortController();
    lifecycle.setController(42, controller);
    lifecycle.setCompletion(42, Promise.resolve());
    lifecycle.setRuntime(42, {
      reloadResources: async () => {},
      session: {
        abort: async () => {
          calls.push("abortRuntime");
        },
        dispose: () => {},
      },
    } as PiThreadRuntime);

    const detail = await runner.stopTurn(makeThread());

    expect(detail.thread.id).toBe(42);
    expect(controller.signal.aborted).toBe(true);
    expect(calls).toEqual([
      "abortRuntime",
      "stopMessages:42",
      "invalidateDetail:42",
      "markStopped:Stopped.:2026-05-03T12:00:01.000Z",
      "readDetail",
    ]);
  });

  it("reads detail without stop side effects when no turn is working", async () => {
    const { calls, runner } = createRunner();

    const detail = await runner.stopTurn(makeThread());

    expect(detail.thread.id).toBe(42);
    expect(calls).toEqual(["readDetail"]);
  });

  it("refuses to persist stop state when lifecycle has no active controller", async () => {
    const { calls, runner } = createRunner({
      runStatus: makeRunStatus({
        startedAt: "2026-05-03T12:00:00.000Z",
        state: "working",
      }),
    });

    await expect(runner.stopTurn(makeThread())).rejects.toThrow(
      "Thread stop is unavailable because no active run was found.",
    );

    expect(calls).toEqual([]);
  });

  it("publishes a stopped run settlement event through the lifecycle seam", async () => {
    const { lifecycle, runner } = createRunner({
      runStatus: makeRunStatus({
        startedAt: "2026-05-03T12:00:00.000Z",
        state: "working",
      }),
      runInBackground: async () => {},
    });
    const settledEvents: Array<{
      startedAt: string | null;
      status: string;
      threadId: number;
      updatedAt: string | null;
    }> = [];
    lifecycle.onRunSettled((event) => settledEvents.push(event));
    lifecycle.setController(42, new AbortController());

    await runner.stopTurn(makeThread());

    expect(settledEvents).toEqual([
      {
        startedAt: "2026-05-03T12:00:00.000Z",
        status: "stopped",
        threadId: 42,
        updatedAt: "2026-05-03T12:00:01.000Z",
      },
    ]);
  });

  it("recovers interrupted turns without marking stale in-progress activity after newer settlements", () => {
    const { calls, runner } = createRunner();

    runner.recoverInterruptedTurns({
      inProgressMessages: [
        { lastUpdatedAt: null, threadId: 1 },
        { lastUpdatedAt: "2026-05-03T12:00:00.000Z", threadId: 2 },
        { lastUpdatedAt: "2026-05-03T12:00:00.000Z", threadId: 4 },
      ],
      threads: [
        makeThread({ id: 1 }),
        makeThread({ id: 2 }),
        makeThread({
          activeTurnStartedAt: "2026-05-03T12:00:00.000Z",
          id: 3,
        }),
        makeThread({
          id: 4,
          lastRunAt: "2026-05-03T12:05:00.000Z",
        }),
      ],
    });

    expect(calls).toEqual([
      "stopMessages:1",
      "invalidateDetail:1",
      "stopMessages:2",
      "invalidateDetail:2",
      "markStopped:Interrupted.:no-stopped-at",
      "stopMessages:4",
      "invalidateDetail:4",
      "stopMessages:3",
      "invalidateDetail:3",
      "markStopped:Interrupted.:no-stopped-at",
    ]);
  });

  it("cleans up interrupted cron turns through the persistence seam", () => {
    const { calls, runner } = createRunner();

    runner.recoverInterruptedTurns({
      inProgressMessages: [
        { lastUpdatedAt: "2026-05-03T12:00:00.000Z", threadId: 7 },
      ],
      threads: [makeThread({ cronJobId: 99, id: 7 })],
    });

    expect(calls).toEqual([
      "stopMessages:7",
      "stopCron:99",
      "invalidateDetail:7",
      "markStopped:Interrupted.:no-stopped-at",
    ]);
  });

  it("loads startup recovery inputs through the Thread Turn module seam", () => {
    const { calls, runner } = createRunner({
      recovery: {
        listInterruptedMessageStates: () => [
          { lastUpdatedAt: "2026-05-03T12:00:00.000Z", threadId: 2 },
        ],
        listThreads: () => [makeThread({ id: 2 })],
      },
    });

    runner.recoverInterruptedTurnsOnStartup();

    expect(calls).toEqual([
      "stopMessages:2",
      "invalidateDetail:2",
      "markStopped:Interrupted.:no-stopped-at",
    ]);
  });
});
