/**
 * @file src/bun/project-procedures/work-context-events.ts
 * @description Focused Work Context event construction and publication helpers.
 */

import type {
  RpcContextFocusChanged,
  RpcThread,
  RpcThreadStartRequest,
  RpcThreadStartRequestResolved,
} from "../rpc-schema";

export type WorkContextLifecycleEvent =
  | {
      readonly type: "worktree-git-history-changed";
      readonly projectId: number;
      readonly worktreePath: string;
    }
  | {
      readonly type: "cron-list-changed";
    }
  | {
      readonly type: "context-focus-changed";
      readonly sessionId: string | null;
      readonly payload: RpcContextFocusChanged;
    }
  | {
      readonly type: "thread-start-request-created";
      readonly request: RpcThreadStartRequest;
    }
  | {
      readonly type: "thread-start-request-resolved";
      readonly resolved: RpcThreadStartRequestResolved;
    }
  | {
      readonly type: "thread-detail-invalidated";
      readonly threadId: number;
    }
  | {
      readonly type: "thread-status-changed";
      readonly thread: RpcThread;
    };

export type WorkContextLifecycleEventPublisher = (
  event: WorkContextLifecycleEvent,
) => void;

export type WorkContextEventModule = {
  readonly contextFocusChanged: (
    sessionId: string | null,
    payload: RpcContextFocusChanged,
  ) => WorkContextLifecycleEvent;
  readonly cronListChanged: () => WorkContextLifecycleEvent;
  readonly publish: (
    publishEvent: WorkContextLifecycleEventPublisher,
    event: WorkContextLifecycleEvent,
  ) => void;
  readonly threadDetailInvalidated: (
    threadId: number,
  ) => WorkContextLifecycleEvent;
  readonly threadStartRequestCreated: (
    request: RpcThreadStartRequest,
  ) => WorkContextLifecycleEvent;
  readonly threadStartRequestResolved: (
    resolved: RpcThreadStartRequestResolved,
  ) => WorkContextLifecycleEvent;
  readonly threadStatusChanged: (
    thread: RpcThread,
  ) => WorkContextLifecycleEvent;
  readonly worktreeGitHistoryChanged: (
    projectId: number,
    worktreePath: string,
  ) => WorkContextLifecycleEvent;
};

export function createWorktreeGitHistoryChangedEvent(
  projectId: number,
  worktreePath: string,
): WorkContextLifecycleEvent {
  return {
    projectId,
    type: "worktree-git-history-changed",
    worktreePath,
  };
}

export function createCronListChangedEvent(): WorkContextLifecycleEvent {
  return {
    type: "cron-list-changed",
  };
}

export function createContextFocusChangedEvent(
  sessionId: string | null,
  payload: RpcContextFocusChanged,
): WorkContextLifecycleEvent {
  return {
    sessionId,
    payload,
    type: "context-focus-changed",
  };
}

export function createThreadStartRequestCreatedEvent(
  request: RpcThreadStartRequest,
): WorkContextLifecycleEvent {
  return {
    request,
    type: "thread-start-request-created",
  };
}

export function createThreadStartRequestResolvedEvent(
  resolved: RpcThreadStartRequestResolved,
): WorkContextLifecycleEvent {
  return {
    resolved,
    type: "thread-start-request-resolved",
  };
}

export function createThreadDetailInvalidatedEvent(
  threadId: number,
): WorkContextLifecycleEvent {
  return {
    threadId,
    type: "thread-detail-invalidated",
  };
}

export function createThreadStatusChangedEvent(
  thread: RpcThread,
): WorkContextLifecycleEvent {
  return {
    thread,
    type: "thread-status-changed",
  };
}

export function publishWorkContextLifecycleEvent(
  publishEvent: WorkContextLifecycleEventPublisher,
  event: WorkContextLifecycleEvent,
): void {
  publishEvent(event);
}

export const workContextEvents: WorkContextEventModule = {
  contextFocusChanged: createContextFocusChangedEvent,
  cronListChanged: createCronListChangedEvent,
  publish: publishWorkContextLifecycleEvent,
  threadDetailInvalidated: createThreadDetailInvalidatedEvent,
  threadStartRequestCreated: createThreadStartRequestCreatedEvent,
  threadStartRequestResolved: createThreadStartRequestResolvedEvent,
  threadStatusChanged: createThreadStatusChangedEvent,
  worktreeGitHistoryChanged: createWorktreeGitHistoryChangedEvent,
};
