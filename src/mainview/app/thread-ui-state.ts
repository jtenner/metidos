/**
 * @file src/mainview/app/thread-ui-state.ts
 * @description Thread selection, popover, event, and model state helpers.
 */

import type { RpcReasoningEffort, RpcThreadDetail } from "../../bun/rpc-schema";

/**
 * UI anchor for project context menu rendering.
 */
export type ProjectActionMenuState = {
  mode: "actions" | "delete";
  projectId: number;
  x: number;
  y: number;
};

/**
 * Context-menu coordinates for a single thread row action menu.
 */
export type ThreadActionMenuState = {
  threadId: number;
  x: number;
  y: number;
};

/**
 * Popover payload for inline thread warning/error text.
 */
export type ErrorPreviewPopoverState = {
  anchorId: string;
  reference: HTMLElement;
  text: string;
};

/**
 * Popover payload for thread summary content display.
 */
export type ThreadSummaryPopoverState = {
  anchorId: string;
  reference: HTMLElement;
  title: string;
  summary: string;
};

/**
 * Optional details used when opening a thread and validating selection.
 */
export type OpenThreadOptions = {
  detailPromise?: Promise<RpcThreadDetail> | null;
  selectionGuard?: {
    projectId: number;
    worktreePath: string;
  } | null;
};

export const THREAD_START_REQUEST_CREATED_EVENT_NAME =
  "metidos:thread-start-request-created";
export const THREAD_START_REQUEST_RESOLVED_EVENT_NAME =
  "metidos:thread-start-request-resolved";
export const THREAD_STATUS_CHANGED_EVENT_NAME = "metidos:thread-status-changed";
export const CONTEXT_FOCUS_CHANGED_EVENT_NAME = "metidos:context-focus-changed";
export const THREAD_EXTENSION_UI_EVENT_NAME = "metidos:thread-extension-ui";

/**
 * Mainview background polling cadence. Thread run status remains the fastest
 * visible-tab poller because it drives live transcript/status freshness. Less
 * urgent refresh paths use slower, distinct intervals so their RPCs do not
 * consistently line up with status polling ticks.
 */
export const THREAD_STATUS_POLL_INTERVAL_MS = 3_000;
export const CRON_JOBS_POLL_INTERVAL_MS = 5_000;
export const PROJECT_SKILLS_POLL_INTERVAL_MS = 30_000;

const CODEX_REASONING_EFFORT_VALUES: RpcReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * Stable anchor id for the active worktree row thread-switcher trigger.
 */
export function worktreeThreadPopoverAnchorId(
  projectId: number,
  worktreePath: string,
): string {
  return `worktree-thread-anchor-${projectId}-${encodeURIComponent(worktreePath).replaceAll("%", "_")}`;
}

/**
 * Checks whether a value is a recognized codex reasoning effort.
 * @param value - Input value.
 */
export function isCodexReasoningEffort(
  value: unknown,
): value is RpcReasoningEffort {
  return (
    typeof value === "string" &&
    CODEX_REASONING_EFFORT_VALUES.includes(value as RpcReasoningEffort)
  );
}
