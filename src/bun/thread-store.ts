/**
 * @file src/bun/thread-store.ts
 * @description Domain store Interface for persisted thread records.
 */

import type { Database } from "bun:sqlite";

import {
  createThread,
  deleteThread,
  getThreadById,
  hasActiveThreadForCronJob,
  listThreads,
  listThreadsByIds,
  listThreadsPage,
  listThreadsWithInProgressMessages,
  markThreadErrorSeen,
  markThreadFailed,
  markThreadRan,
  markThreadRunStarted,
  markThreadStopped,
  renameThread,
  setThreadAccess,
  setThreadModel,
  setThreadPinned,
  setThreadReasoningEffort,
  setThreadUsage,
  updateThreadPiSessionState,
} from "./db";

export type ThreadStore = {
  create: typeof createThread;
  delete: typeof deleteThread;
  getById: typeof getThreadById;
  hasActiveForCronJob: typeof hasActiveThreadForCronJob;
  list: typeof listThreads;
  listByIds: typeof listThreadsByIds;
  listPage: typeof listThreadsPage;
  listWithInProgressMessages: typeof listThreadsWithInProgressMessages;
  markErrorSeen: typeof markThreadErrorSeen;
  markFailed: typeof markThreadFailed;
  markRan: typeof markThreadRan;
  markRunStarted: typeof markThreadRunStarted;
  markStopped: typeof markThreadStopped;
  rename: typeof renameThread;
  setAccess: typeof setThreadAccess;
  setModel: typeof setThreadModel;
  setPinned: typeof setThreadPinned;
  setReasoningEffort: typeof setThreadReasoningEffort;
  setUsage: typeof setThreadUsage;
  updatePiSessionState: typeof updateThreadPiSessionState;
};

export function createThreadStore(_database: Database): ThreadStore {
  return {
    create: (db, input) => createThread(db, input),
    delete: (db, threadId) => deleteThread(db, threadId),
    getById: (db, threadId) => getThreadById(db, threadId),
    hasActiveForCronJob: (db, cronJobId) =>
      hasActiveThreadForCronJob(db, cronJobId),
    list: (db) => listThreads(db),
    listByIds: (db, threadIds) => listThreadsByIds(db, threadIds),
    listPage: (db, options) => listThreadsPage(db, options),
    listWithInProgressMessages: (db) => listThreadsWithInProgressMessages(db),
    markErrorSeen: (db, threadId) => markThreadErrorSeen(db, threadId),
    markFailed: (db, threadId, error) => markThreadFailed(db, threadId, error),
    markRan: (db, threadId) => markThreadRan(db, threadId),
    markRunStarted: (db, threadId, startedAt) =>
      markThreadRunStarted(db, threadId, startedAt),
    markStopped: (db, threadId, message, stoppedAt) =>
      markThreadStopped(db, threadId, message, stoppedAt),
    rename: (db, threadId, title, summary) =>
      renameThread(db, threadId, title, summary),
    setAccess: (db, threadId, access) => setThreadAccess(db, threadId, access),
    setModel: (db, threadId, model) => setThreadModel(db, threadId, model),
    setPinned: (db, threadId, pinned) => setThreadPinned(db, threadId, pinned),
    setReasoningEffort: (db, threadId, reasoningEffort) =>
      setThreadReasoningEffort(db, threadId, reasoningEffort),
    setUsage: (db, threadId, usage, compactionStats) =>
      setThreadUsage(db, threadId, usage, compactionStats),
    updatePiSessionState: (db, threadId, state) =>
      updateThreadPiSessionState(db, threadId, state),
  };
}

export function createBoundThreadStore(database: Database): {
  [K in keyof ThreadStore]: ThreadStore[K] extends (
    database: Database,
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result
    : never;
} {
  // Bound stores intentionally close over the process singleton database used
  // by project-procedures. Maintenance/reset flows that remove database files
  // happen before this module-level store is used in the long-running backend.
  const store = createThreadStore(database);
  return {
    create: (...args) => store.create(database, ...args),
    delete: (...args) => store.delete(database, ...args),
    getById: (...args) => store.getById(database, ...args),
    hasActiveForCronJob: (...args) =>
      store.hasActiveForCronJob(database, ...args),
    list: (...args) => store.list(database, ...args),
    listByIds: (...args) => store.listByIds(database, ...args),
    listPage: (...args) => store.listPage(database, ...args),
    listWithInProgressMessages: (...args) =>
      store.listWithInProgressMessages(database, ...args),
    markErrorSeen: (...args) => store.markErrorSeen(database, ...args),
    markFailed: (...args) => store.markFailed(database, ...args),
    markRan: (...args) => store.markRan(database, ...args),
    markRunStarted: (...args) => store.markRunStarted(database, ...args),
    markStopped: (...args) => store.markStopped(database, ...args),
    rename: (...args) => store.rename(database, ...args),
    setAccess: (...args) => store.setAccess(database, ...args),
    setModel: (...args) => store.setModel(database, ...args),
    setPinned: (...args) => store.setPinned(database, ...args),
    setReasoningEffort: (...args) =>
      store.setReasoningEffort(database, ...args),
    setUsage: (...args) => store.setUsage(database, ...args),
    updatePiSessionState: (...args) =>
      store.updatePiSessionState(database, ...args),
  };
}
