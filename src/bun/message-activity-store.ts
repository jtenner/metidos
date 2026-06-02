/**
 * @file src/bun/message-activity-store.ts
 * @description Domain store Interface for thread message and activity rows.
 */

import type { Database } from "bun:sqlite";

import {
  createThreadMessage,
  listThreadMessages,
  listThreadMessagesPage,
  stopInProgressThreadMessages,
  upsertThreadActivities,
  upsertThreadActivity,
  writeThreadMessage,
} from "./db";

export type MessageActivityStore = {
  createMessage: typeof createThreadMessage;
  listMessages: typeof listThreadMessages;
  listMessagesPage: typeof listThreadMessagesPage;
  stopInProgressMessages: typeof stopInProgressThreadMessages;
  upsertActivities: typeof upsertThreadActivities;
  upsertActivity: typeof upsertThreadActivity;
  writeMessage: typeof writeThreadMessage;
};

export function createMessageActivityStore(
  _database: Database,
): MessageActivityStore {
  // Security/audit boundary: this store is a persistence adapter only. It does
  // not authenticate callers or scope reads by project/session because some
  // background flows (runtime resume, activity persistence, cleanup) are
  // intentionally ownerless. RPC procedures must authorize the thread/project
  // before calling into this store; see `threadById(..., context)` gates in
  // `project-procedures.ts`. Message payload size limits are enforced before
  // persistence by the agent/RPC input paths, while paginated reads are clamped
  // in `listThreadMessagesPage` so externally driven detail reads remain
  // bounded even if this adapter is reused directly.
  return {
    createMessage: (db, input) => createThreadMessage(db, input),
    listMessages: (db, threadId) => listThreadMessages(db, threadId),
    listMessagesPage: (db, threadId, options) =>
      listThreadMessagesPage(db, threadId, options),
    stopInProgressMessages: (db, threadId) =>
      stopInProgressThreadMessages(db, threadId),
    upsertActivities: (db, inputs) => upsertThreadActivities(db, inputs),
    upsertActivity: (db, input) => upsertThreadActivity(db, input),
    writeMessage: (db, input) => writeThreadMessage(db, input),
  };
}

export function createBoundMessageActivityStore(database: Database): {
  [K in keyof MessageActivityStore]: MessageActivityStore[K] extends (
    database: Database,
    ...args: infer Args
  ) => infer Result
    ? (...args: Args) => Result
    : never;
} {
  // Bound stores intentionally use the same process singleton connection as
  // project-procedures so message/activity writes share transaction state with
  // thread updates instead of racing through a separate SQLite handle.
  const store = createMessageActivityStore(database);
  return {
    createMessage: (...args) => store.createMessage(database, ...args),
    listMessages: (...args) => store.listMessages(database, ...args),
    listMessagesPage: (...args) => store.listMessagesPage(database, ...args),
    stopInProgressMessages: (...args) =>
      store.stopInProgressMessages(database, ...args),
    upsertActivities: (...args) => store.upsertActivities(database, ...args),
    upsertActivity: (...args) => store.upsertActivity(database, ...args),
    writeMessage: (...args) => store.writeMessage(database, ...args),
  };
}
