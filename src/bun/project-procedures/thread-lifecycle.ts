/**
 * @file src/bun/project-procedures/thread-lifecycle.ts
 * @description Focused Thread lifecycle, detail, and turn workflows for Backend procedure callers.
 */

import type { ChatImageAttachment } from "../../shared/chat-images";
import { resolveChatPromptText } from "../../shared/chat-images";
import type { ThreadRecord } from "../db";
import type { ProjectRecord } from "../project-store";
import type {
  RpcReasoningEffort,
  RpcThread,
  RpcThreadDetail,
  RpcWorktree,
} from "../rpc-schema";
import type { ThreadTurnRunner } from "./thread-turn-runner";

export type ThreadAccessControls = {
  webSearchAccess: boolean;
  githubAccess: boolean;
  gitAccess: boolean;
  sqliteAccess: boolean;
  webServerAccess: boolean;
  agentsAccess: boolean;
  calendarAccess: boolean;
  notificationsAccess: boolean;
  weatherAccess: boolean;
  threadsAccess: boolean;
  cronsAccess: boolean;
  metidosAccess: boolean;
  pluginAccessGroups: string[];
  permissions: string[] | null;
  unsafeMode: boolean;
};

export type CreateThreadLifecycleInput = {
  access: ThreadAccessControls;
  assertProjectWorkspacePath: (
    project: ProjectRecord,
    worktreePath: string,
  ) => Promise<RpcWorktree | null>;
  createThreadRecord: (input: {
    access: ThreadAccessControls;
    cronJobId: number | null;
    model: string;
    project: ProjectRecord;
    reasoningEffort: RpcReasoningEffort;
    worktree: RpcWorktree | null;
    worktreePath: string;
  }) => Promise<ThreadRecord>;
  model: string;
  project: ProjectRecord;
  readDetail: (threadId: number) => Promise<RpcThreadDetail>;
  reasoningEffort: RpcReasoningEffort;
  recordCrossWorkspaceAuditEvent?: (thread: ThreadRecord) => void;
  worktreePath: string;
  cronJobId?: number | null;
};

export type QueueThreadTurnLifecycleInput = {
  images: ChatImageAttachment[];
  logImageAttachments?: (images: readonly ChatImageAttachment[]) => void;
  modelSupportsImageInput: (model: string) => boolean;
  rawInput: string;
  runner: Pick<ThreadTurnRunner, "queueMessage">;
  sessionId: string | null;
  thread: ThreadRecord;
};

export type StopThreadTurnLifecycleInput = {
  runner: Pick<ThreadTurnRunner, "stopTurn">;
  thread: ThreadRecord;
};

export type QueueCallerThreadTurnLifecycleInput<TQueueResult> = {
  afterThreadResolved?: (threadId: number) => Promise<void> | void;
  input: string;
  queueTurn: (input: {
    input: string;
    threadId: number;
  }) => Promise<TQueueResult> | TQueueResult;
  resolveThreadId: () => Promise<number> | number;
};

export type QueueCallerThreadTurnLifecycleResult<TQueueResult> = {
  result: TQueueResult;
  threadId: number;
};

export type ReadThreadDetailLifecycleInput = {
  buildDetail: (
    threadId: number,
    options: {
      cursor?: number;
      includeHeavyContent: boolean;
      messageLimit?: number;
    },
  ) => Promise<RpcThreadDetail>;
  cursor?: number;
  expectedThread: RpcThread;
  includeHeavyContent: boolean;
  messageLimit: number | null;
  readCachedDetail: (
    threadId: number,
    options?: { expectedThread?: RpcThread },
  ) => Promise<RpcThreadDetail>;
  threadId: number;
};

export type ThreadLifecycleModule = {
  readonly createThread: (
    input: CreateThreadLifecycleInput,
  ) => Promise<RpcThreadDetail>;
  readonly queueTurn: (
    input: QueueThreadTurnLifecycleInput,
  ) => Promise<RpcThreadDetail>;
  readonly queueCallerTurn: <TQueueResult>(
    input: QueueCallerThreadTurnLifecycleInput<TQueueResult>,
  ) => Promise<QueueCallerThreadTurnLifecycleResult<TQueueResult>>;
  readonly readDetail: (
    input: ReadThreadDetailLifecycleInput,
  ) => Promise<RpcThreadDetail>;
  readonly stopTurn: (
    input: StopThreadTurnLifecycleInput,
  ) => Promise<RpcThreadDetail>;
};

export async function createThreadLifecycle(
  input: CreateThreadLifecycleInput,
): Promise<RpcThreadDetail> {
  const worktree = await input.assertProjectWorkspacePath(
    input.project,
    input.worktreePath,
  );
  const thread = await input.createThreadRecord({
    access: input.access,
    cronJobId: input.cronJobId ?? null,
    model: input.model,
    project: input.project,
    reasoningEffort: input.reasoningEffort,
    worktree,
    worktreePath: input.worktreePath,
  });
  input.recordCrossWorkspaceAuditEvent?.(thread);
  return input.readDetail(thread.id);
}

export async function queueThreadTurnLifecycle(
  input: QueueThreadTurnLifecycleInput,
): Promise<RpcThreadDetail> {
  if (input.images.length > 0) {
    input.logImageAttachments?.(input.images);
  }

  const resolvedInput = resolveChatPromptText(
    input.rawInput,
    input.images.length,
  );
  if (!resolvedInput) {
    throw new Error("Thread input is required.");
  }
  if (
    input.images.length > 0 &&
    !input.modelSupportsImageInput(input.thread.model)
  ) {
    throw new Error("Current model does not support images.");
  }

  return input.runner.queueMessage(
    input.thread,
    resolvedInput,
    input.images,
    input.sessionId,
  );
}

export async function queueCallerThreadTurnLifecycle<TQueueResult>(
  input: QueueCallerThreadTurnLifecycleInput<TQueueResult>,
): Promise<QueueCallerThreadTurnLifecycleResult<TQueueResult>> {
  if (!input.input.trim()) {
    throw new Error("Thread input is required.");
  }

  const threadId = await input.resolveThreadId();
  await input.afterThreadResolved?.(threadId);
  const result = await input.queueTurn({
    input: input.input,
    threadId,
  });
  return {
    result,
    threadId,
  };
}

export async function readThreadDetailLifecycle(
  input: ReadThreadDetailLifecycleInput,
): Promise<RpcThreadDetail> {
  if (
    typeof input.cursor === "number" ||
    input.messageLimit !== null ||
    !input.includeHeavyContent
  ) {
    return input.buildDetail(input.threadId, {
      includeHeavyContent: input.includeHeavyContent,
      ...(typeof input.cursor === "number" ? { cursor: input.cursor } : {}),
      ...(input.messageLimit !== null
        ? { messageLimit: input.messageLimit }
        : {}),
    });
  }

  return input.readCachedDetail(input.threadId, {
    expectedThread: input.expectedThread,
  });
}

export function stopThreadTurnLifecycle(
  input: StopThreadTurnLifecycleInput,
): Promise<RpcThreadDetail> {
  return input.runner.stopTurn(input.thread);
}

export const threadLifecycle: ThreadLifecycleModule = {
  createThread: createThreadLifecycle,
  queueTurn: queueThreadTurnLifecycle,
  queueCallerTurn: queueCallerThreadTurnLifecycle,
  readDetail: readThreadDetailLifecycle,
  stopTurn: stopThreadTurnLifecycle,
};
