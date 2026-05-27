import { describe, expect, it } from "bun:test";

import type { ThreadRecord } from "../db";
import type { ProjectRecord } from "../project-store";
import type { RpcWorktree, RpcWorktreeSnapshot } from "../rpc-schema";
import { workContextLifecycle } from "./work-context-lifecycle";

function worktree(path: string): RpcWorktree {
  return {
    path,
    bare: false,
    branch: null,
    head: null,
    pinnedAt: null,
  };
}

function project(input?: Partial<ProjectRecord>): ProjectRecord {
  return {
    createdAt: "2026-05-10T18:00:00.000Z",
    gitRemote: null,
    id: 9,
    isOpen: 1,
    lastOpenedAt: "2026-05-10T18:00:00.000Z",
    name: "Repo",
    path: "/repo",
    updatedAt: "2026-05-10T18:00:00.000Z",
    ...input,
  };
}

function snapshot(input?: Partial<RpcWorktreeSnapshot>): RpcWorktreeSnapshot {
  return {
    changes: [],
    diff: [],
    files: ["README.md"],
    lastUpdatedAt: "2026-05-10T18:02:00.000Z",
    path: "/repo",
    ...input,
  };
}

function thread(input?: Partial<ThreadRecord>): ThreadRecord {
  return {
    activeTurnStartedAt: null,
    agentsAccess: 0,
    bashAccess: 0,
    calendarAccess: 0,
    codexReasoningEffort: "medium",
    createdAt: "2026-05-10T18:00:00.000Z",
    cronJobId: null,
    cronsAccess: 0,
    githubAccess: 0,
    id: 1,
    lastErrorAt: null,
    lastRunAt: null,
    maxInputTokens: 0,
    messagesAccess: 0,
    metidosAccess: 1,
    model: "openai:gpt-5.4",
    notificationsAccess: 0,
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
    updatedAt: "2026-05-10T18:00:00.000Z",
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

describe("workContextLifecycle", () => {
  it("exposes explicit lifecycle events for publication side effects", () => {
    const published: string[] = [];
    const publish = (
      event: Parameters<typeof workContextLifecycle.events.publish>[1],
    ) => {
      published.push(event.type);
    };

    workContextLifecycle.events.publish(
      publish,
      workContextLifecycle.events.cronListChanged(),
    );
    workContextLifecycle.events.publish(
      publish,
      workContextLifecycle.events.threadDetailInvalidated(42),
    );
    workContextLifecycle.events.publish(
      publish,
      workContextLifecycle.events.threadStatusChanged({ id: 42 } as never),
    );
    workContextLifecycle.events.publish(
      publish,
      workContextLifecycle.events.contextFocusChanged("session-7", {
        projectId: 9,
        projectName: "Repo",
        projectPath: "/repo",
        threadId: 42,
        worktreePath: "/repo",
      }),
    );

    expect(published).toEqual([
      "cron-list-changed",
      "thread-detail-invalidated",
      "thread-status-changed",
      "context-focus-changed",
    ]);
  });

  it("hydrates a root worktree fallback when a project has no git listing", () => {
    expect(
      workContextLifecycle.projectWorktrees.hydrateOpenProjectWorktrees({
        projectPath: "/repo",
        rootPinnedAt: "2026-05-10T18:00:00.000Z",
        worktrees: [],
      }),
    ).toEqual([
      {
        ...worktree("/repo"),
        pinnedAt: "2026-05-10T18:00:00.000Z",
      },
    ]);
  });

  it("hydrates visible and hidden worktree records through the shared interface", () => {
    expect(
      workContextLifecycle.projectWorktrees.hydrateFreshListing({
        includeHidden: true,
        projectPath: "/repo",
        trackedWorktrees: [
          {
            pinnedAt: "2026-05-10T18:01:00.000Z",
            worktreePath: "/repo-feature",
          },
        ],
        worktrees: [
          worktree("/repo-hidden"),
          worktree("/repo-feature"),
          worktree("/repo"),
        ],
      }),
    ).toEqual({
      hiddenWorktrees: [worktree("/repo-hidden")],
      worktrees: [
        {
          ...worktree("/repo-feature"),
          pinnedAt: "2026-05-10T18:01:00.000Z",
        },
        worktree("/repo"),
      ],
    });
  });

  it("coordinates worktree open history, snapshot, polling, and warmup sequencing", async () => {
    const state = workContextLifecycle.projectWorktrees.createPollState(
      project(),
      [worktree("/repo")],
    );
    let limited = false;
    let synced = false;
    let warmedStatePath = "";

    const opened = await workContextLifecycle.projectWorktrees.openWorktree({
      project: state.project,
      queueHistoryWarmup: (worktreeState) => {
        warmedStatePath = worktreeState.history.worktreePath;
      },
      readAndStoreSnapshot: async () => snapshot(),
      readGitHistoryFirstPage: async () => ({
        history: {
          entries: [
            {
              authorName: "Alice",
              committedAt: "2026-05-10T18:01:00.000Z",
              hash: "abcdef123456",
              shortHash: "abcdef1",
              subject: "Initial",
            },
          ],
          branch: "main",
          headHash: "abcdef123456",
          headShortHash: "abcdef1",
          lastUpdatedAt: "2026-05-10T18:01:00.000Z",
          limit: 50,
          nextOffset: null,
          projectId: 9,
          worktreePath: "/repo",
        },
        signature: "sig-1",
        summary: {
          branch: "main",
          headHash: "abcdef123456",
          headShortHash: "abcdef1",
          lastUpdatedAt: "2026-05-10T18:01:00.000Z",
          projectId: 9,
          worktreePath: "/repo",
        },
      }),
      runWorktreeOpenLimited: async (callback) => {
        limited = true;
        return callback();
      },
      state,
      syncBackgroundPolling: () => {
        synced = true;
      },
      worktreePath: "/repo",
      worktrees: state.worktrees,
    });

    expect(limited).toBe(true);
    expect(synced).toBe(true);
    expect(warmedStatePath).toBe("/repo");
    expect(opened.worktree.files).toEqual(["README.md"]);
    expect(state.openWorktrees.get("/repo")?.historySignature).toBe("sig-1");
    expect(state.openWorktrees.get("/repo")?.historyEntries).toHaveLength(1);
  });

  it("publishes git-history refresh events when polling detects a new signature", async () => {
    const state = workContextLifecycle.projectWorktrees.createPollState(
      project(),
      [worktree("/repo")],
    );
    const worktreeState =
      workContextLifecycle.projectWorktrees.ensureWorktreePollState(
        state,
        "/repo",
        "2026-05-10T18:00:00.000Z",
      );
    worktreeState.historySignature = "sig-old";
    const abortedReasons: string[] = [];
    const notified = new Promise<{ worktreePath: string }>((resolve) => {
      workContextLifecycle.projectWorktrees.startGitHistoryPolling(
        state,
        "/repo",
        {
          abortGitHistoryPrefetch: (_worktreeState, reason) => {
            abortedReasons.push(reason);
          },
          logBackgroundGitFailure: (_message, error) => {
            throw error;
          },
          publishEvent: (event) => {
            if (event.type === "worktree-git-history-changed") {
              resolve({
                worktreePath: event.worktreePath,
              });
            }
          },
          pollIntervalMs: 60_000,
          readGitHistorySummary: async () => ({
            history: {
              branch: "main",
              headHash: "fedcba654321",
              headShortHash: "fedcba6",
              lastUpdatedAt: "2026-05-10T18:03:00.000Z",
              projectId: 9,
              worktreePath: "/repo",
            },
            signature: "sig-new",
          }),
        },
      );
    });

    await expect(notified).resolves.toEqual({
      worktreePath: "/repo",
    });
    expect(worktreeState.historySignature).toBe("sig-new");
    expect(worktreeState.historyEntries).toEqual([]);
    expect(worktreeState.historyNextOffset).toBe(0);
    expect(abortedReasons).toEqual([
      "Git history signature changed for /repo.",
    ]);

    workContextLifecycle.projectWorktrees.stopWorktreeBackgroundPolling(
      worktreeState,
      "test cleanup",
      (_worktreeState, reason) => {
        abortedReasons.push(reason);
      },
    );
  });

  it("keeps active-worktree polling transitions inside the lifecycle interface", () => {
    const state = workContextLifecycle.projectWorktrees.createPollState(
      project(),
      [worktree("/repo"), worktree("/repo-feature")],
    );
    workContextLifecycle.projectWorktrees.ensureWorktreePollState(
      state,
      "/repo",
      "2026-05-10T18:00:00.000Z",
    );
    workContextLifecycle.projectWorktrees.ensureWorktreePollState(
      state,
      "/repo-feature",
      "2026-05-10T18:00:00.000Z",
    );
    state.activeWorktreePath = "/repo-feature";
    const started: string[] = [];
    const stopped: string[] = [];

    workContextLifecycle.projectWorktrees.syncBackgroundPolling(state, {
      hasForegroundReadPressure: false,
      startGitHistoryPolling: (_state, worktreePath) => {
        started.push(worktreePath);
        const worktreeState = _state.openWorktrees.get(worktreePath);
        if (!worktreeState) {
          throw new Error(`Missing worktree state for ${worktreePath}`);
        }
        return worktreeState;
      },
      stopWorktreeBackgroundPolling: (worktreeState, reason) => {
        stopped.push(`${worktreeState.history.worktreePath}:${reason}`);
      },
    });

    expect(started).toEqual(["/repo-feature"]);
    expect(stopped).toEqual([
      "/repo:Worktree /repo is no longer the active view.",
    ]);

    stopped.length = 0;
    workContextLifecycle.projectWorktrees.syncBackgroundPolling(state, {
      hasForegroundReadPressure: true,
      startGitHistoryPolling: (_state, worktreePath) => {
        const worktreeState = _state.openWorktrees.get(worktreePath);
        if (!worktreeState) {
          throw new Error(`Missing worktree state for ${worktreePath}`);
        }
        return worktreeState;
      },
      stopWorktreeBackgroundPolling: (worktreeState, reason) => {
        stopped.push(`${worktreeState.history.worktreePath}:${reason}`);
      },
    });

    expect(stopped).toEqual([
      "/repo:Foreground read pressure paused worktree polling for /repo.",
      "/repo-feature:Foreground read pressure paused worktree polling for /repo-feature.",
    ]);
  });

  it("creates thread rows behind the lifecycle interface before reading detail", async () => {
    const events: string[] = [];
    const projectRecord = project();
    const created = thread({ id: 42 });
    const detail = { messages: [], nextCursor: null, thread: {} } as never;

    const result = await workContextLifecycle.threads.createThread({
      access: {
        agentsAccess: false,
        calendarAccess: false,
        cronsAccess: false,
        gitAccess: true,
        githubAccess: false,
        metidosAccess: true,
        notificationsAccess: false,
        permissions: ["metidos:git", "metidos:threads"],
        pluginAccessGroups: [],
        sqliteAccess: false,
        threadsAccess: true,
        unsafeMode: false,
        weatherAccess: false,
        webSearchAccess: true,
        webServerAccess: false,
      },
      assertProjectWorkspacePath: async (_project, worktreePath) => {
        events.push(`assert:${worktreePath}`);
        return worktree(worktreePath);
      },
      createThreadRecord: async (input) => {
        events.push(
          `create:${input.project.id}:${input.worktreePath}:${input.model}:${input.reasoningEffort}`,
        );
        expect(input.worktree?.path).toBe("/repo");
        expect(input.access.threadsAccess).toBe(true);
        return created;
      },
      model: "openai:gpt-5.4",
      project: projectRecord,
      readDetail: async (threadId) => {
        events.push(`detail:${threadId}`);
        return detail;
      },
      reasoningEffort: "medium",
      recordCrossWorkspaceAuditEvent: (threadRecord) => {
        events.push(`audit:${threadRecord.id}`);
      },
      worktreePath: "/repo",
    });

    expect(result).toBe(detail);
    expect(events).toEqual([
      "assert:/repo",
      "create:9:/repo:openai:gpt-5.4:medium",
      "audit:42",
      "detail:42",
    ]);
  });

  it("queues thread turns through the lifecycle interface after prompt and image checks", async () => {
    const events: string[] = [];
    const detail = { messages: [], nextCursor: null, thread: {} } as never;
    const image = {
      data: "abcd",
      mimeType: "image/png",
      type: "image" as const,
    };

    const result = await workContextLifecycle.threads.queueTurn({
      images: [image],
      logImageAttachments: (images) => {
        events.push(`log:${images.length}`);
      },
      modelSupportsImageInput: (model) => {
        events.push(`supports:${model}`);
        return true;
      },
      rawInput: "   ",
      runner: {
        queueMessage: async (threadRecord, input, images, sessionId) => {
          events.push(
            `queue:${threadRecord.id}:${input}:${images.length}:${sessionId}`,
          );
          return detail;
        },
      },
      sessionId: "session-2",
      thread: thread({ id: 11 }),
    });

    expect(result).toBe(detail);
    expect(events).toEqual([
      "log:1",
      "supports:openai:gpt-5.4",
      "queue:11:Describe this image.:1:session-2",
    ]);
  });

  it("routes caller-owned thread turns through a shared create/send sequence", async () => {
    const events: string[] = [];

    const result = await workContextLifecycle.threads.queueCallerTurn({
      afterThreadResolved: (threadId) => {
        events.push(`after:${threadId}`);
      },
      input: "Run the job",
      queueTurn: async ({ input, threadId }) => {
        events.push(`queue:${threadId}:${input}`);
        return { status: "working" };
      },
      resolveThreadId: async () => {
        events.push("resolve");
        return 42;
      },
    });

    expect(result).toEqual({
      result: { status: "working" },
      threadId: 42,
    });
    expect(events).toEqual(["resolve", "after:42", "queue:42:Run the job"]);

    await expect(
      workContextLifecycle.threads.queueCallerTurn({
        input: "   ",
        queueTurn: async () => {
          throw new Error("unexpected queue");
        },
        resolveThreadId: async () => {
          throw new Error("unexpected resolve");
        },
      }),
    ).rejects.toThrow("Thread input is required.");
  });

  it("keeps thread detail cache policy and stop orchestration behind the lifecycle interface", async () => {
    const cached = {
      messages: [],
      nextCursor: null,
      thread: { id: 1 },
    } as never;
    const paged = {
      messages: [],
      nextCursor: null,
      thread: { id: 2 },
    } as never;
    const stopped = {
      messages: [],
      nextCursor: null,
      thread: { id: 3 },
    } as never;
    const detailEvents: string[] = [];

    await expect(
      workContextLifecycle.threads.readDetail({
        buildDetail: async () => {
          throw new Error("unexpected paged read");
        },
        expectedThread: {} as never,
        includeHeavyContent: true,
        messageLimit: null,
        readCachedDetail: async (threadId, options) => {
          detailEvents.push(
            `cached:${threadId}:${options?.expectedThread ? "expected" : "none"}`,
          );
          return cached;
        },
        threadId: 1,
      }),
    ).resolves.toBe(cached);

    await expect(
      workContextLifecycle.threads.readDetail({
        buildDetail: async (threadId, options) => {
          detailEvents.push(
            `paged:${threadId}:${options.cursor}:${options.messageLimit}:${options.includeHeavyContent}`,
          );
          return paged;
        },
        cursor: 30,
        expectedThread: {} as never,
        includeHeavyContent: false,
        messageLimit: 10,
        readCachedDetail: async () => {
          throw new Error("unexpected cached read");
        },
        threadId: 1,
      }),
    ).resolves.toBe(paged);

    await expect(
      workContextLifecycle.threads.stopTurn({
        runner: {
          stopTurn: async (threadRecord) => {
            detailEvents.push(`stop:${threadRecord.id}`);
            return stopped;
          },
        },
        thread: thread({ id: 9 }),
      }),
    ).resolves.toBe(stopped);

    expect(detailEvents).toEqual([
      "cached:1:expected",
      "paged:1:30:10:false",
      "stop:9",
    ]);
  });
});
