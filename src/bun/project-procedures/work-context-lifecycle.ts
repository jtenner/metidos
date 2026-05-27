/**
 * @file src/bun/project-procedures/work-context-lifecycle.ts
 * @description Shared Project/Worktree/Thread lifecycle decisions for backend procedure callers.
 */

import {
  projectWorktreeLifecycle,
  type ProjectWorktreeLifecycleModule,
} from "./project-worktree-lifecycle";
import {
  threadLifecycle,
  type ThreadLifecycleModule,
} from "./thread-lifecycle";
import {
  workContextEvents,
  type WorkContextEventModule,
} from "./work-context-events";

export type {
  WorkContextLifecycleEvent,
  WorkContextLifecycleEventPublisher,
} from "./work-context-events";

export type WorkContextLifecycle = {
  readonly events: WorkContextEventModule;
  readonly projectWorktrees: ProjectWorktreeLifecycleModule;
  readonly threads: ThreadLifecycleModule;
};

export {
  applyRefreshedListingToPollState,
  createProjectPollState,
  createProjectRootWorkspaceWorktree,
  createProjectWorktreeContext,
  createWorktreePollState,
  ensureWorktreePollState,
  filterProjectWorktreesForAccess,
  hydrateFreshProjectWorktreeListing,
  hydrateOpenProjectWorktrees,
  isGitWorkspaceUnavailableError,
  openWorktreeLifecycle,
  projectWorktreeLifecycle,
  reconcileProjectPrimaryWorktreePath,
  splitProjectWorktreesForVisibility,
  startWorktreeGitHistoryPolling,
  stopWorktreeBackgroundPolling,
  stopWorktreePolling,
  syncProjectWorktreeBackgroundPolling,
  trackedProjectWorktree,
  updateProjectPollStateProject,
} from "./project-worktree-lifecycle";

export type {
  CreateProjectWorktreeContextInput,
  OpenWorktreeLifecycleInput,
  ProjectPollState,
  ProjectWorktreeLifecycleModule,
  StartWorktreeGitHistoryPollingOptions,
  WorkContextProjectWorktreeListing,
  WorktreePollState,
} from "./project-worktree-lifecycle";

export {
  createContextFocusChangedEvent,
  createCronListChangedEvent,
  createThreadDetailInvalidatedEvent,
  createThreadStartRequestCreatedEvent,
  createThreadStartRequestResolvedEvent,
  createThreadStatusChangedEvent,
  publishWorkContextLifecycleEvent,
} from "./work-context-events";

export {
  createThreadLifecycle,
  queueCallerThreadTurnLifecycle,
  queueThreadTurnLifecycle,
  readThreadDetailLifecycle,
  stopThreadTurnLifecycle,
  threadLifecycle,
} from "./thread-lifecycle";

export type {
  CreateThreadLifecycleInput,
  QueueCallerThreadTurnLifecycleInput,
  QueueCallerThreadTurnLifecycleResult,
  QueueThreadTurnLifecycleInput,
  ReadThreadDetailLifecycleInput,
  StopThreadTurnLifecycleInput,
  ThreadAccessControls,
  ThreadLifecycleModule,
} from "./thread-lifecycle";

export const workContextLifecycle: WorkContextLifecycle = {
  events: workContextEvents,
  projectWorktrees: projectWorktreeLifecycle,
  threads: threadLifecycle,
};
