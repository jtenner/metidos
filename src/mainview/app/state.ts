/**
 * @file src/mainview/app/state.ts
 * @description Temporary compatibility barrel for focused Mainview state modules.
 *
 * New production code should import from focused modules such as
 * `project-worktree-state`, `thread-ui-state`, `async-request-state`, and
 * `mainview-ui-state` directly. This barrel remains only while older tests or
 * external callers migrate.
 */

export * from "./async-request-state";
export { formatGitHistoryTimestamp } from "./date-format";
export * from "./directory-suggestion-state";
export {
  appendGitHistoryPage,
  mergeResetGitHistory,
} from "./git-history-state";
export * from "./mainview-ui-state";
export * from "./persisted-thread-state";
export * from "./project-worktree-state";
export * from "./thread-ui-state";
export type { MessageGroup, VisibleMessage } from "./visible-message-state";
