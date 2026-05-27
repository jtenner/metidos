import { describe, expect, it } from "bun:test";

import type { ThreadRecord } from "../db";
import type { ProjectRecord } from "../project-store";
import type { RpcWorktree } from "../rpc-schema";
import { threadLifecycle } from "./thread-lifecycle";

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

describe("threadLifecycle", () => {
  it("creates thread rows before reading detail behind one workflow seam", async () => {
    const events: string[] = [];
    const created = thread({ id: 42 });
    const detail = {
      messages: [],
      nextCursor: null,
      thread: { id: 42 },
    } as never;

    const result = await threadLifecycle.createThread({
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
      project: project(),
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

  it("queues Thread turns after prompt and image capability checks", async () => {
    const events: string[] = [];
    const detail = {
      messages: [],
      nextCursor: null,
      thread: { id: 11 },
    } as never;
    const image = {
      data: "abcd",
      mimeType: "image/png",
      type: "image" as const,
    };

    await expect(
      threadLifecycle.queueTurn({
        images: [image],
        modelSupportsImageInput: () => false,
        rawInput: "Describe it",
        runner: {
          queueMessage: async () => {
            throw new Error("unexpected queue");
          },
        },
        sessionId: null,
        thread: thread({ id: 11 }),
      }),
    ).rejects.toThrow("Current model does not support images.");

    const result = await threadLifecycle.queueTurn({
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

  it("routes caller-owned Thread turns through a shared resolve/send sequence", async () => {
    const events: string[] = [];

    const result = await threadLifecycle.queueCallerTurn({
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
  });

  it("keeps Thread detail cache policy and stop orchestration inside the Thread module", async () => {
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
    const events: string[] = [];

    await expect(
      threadLifecycle.readDetail({
        buildDetail: async () => {
          throw new Error("unexpected paged read");
        },
        expectedThread: {} as never,
        includeHeavyContent: true,
        messageLimit: null,
        readCachedDetail: async (threadId, options) => {
          events.push(
            `cached:${threadId}:${options?.expectedThread ? "expected" : "none"}`,
          );
          return cached;
        },
        threadId: 1,
      }),
    ).resolves.toBe(cached);

    await expect(
      threadLifecycle.readDetail({
        buildDetail: async (threadId, options) => {
          events.push(
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
      threadLifecycle.stopTurn({
        runner: {
          stopTurn: async (threadRecord) => {
            events.push(`stop:${threadRecord.id}`);
            return stopped;
          },
        },
        thread: thread({ id: 9 }),
      }),
    ).resolves.toBe(stopped);

    expect(events).toEqual([
      "cached:1:expected",
      "paged:1:30:10:false",
      "stop:9",
    ]);
  });
});
