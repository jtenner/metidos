/**
 * @file src/mainview/thread-workspace-selection-controller.ts
 * @description Selection orchestration helpers for Project, Worktree, and Thread transitions.
 */

import type { MutableRefObject } from "react";
import type { RpcThread } from "../bun/rpc-schema";
import { preferredThreadForWorktree } from "./app/thread-store";
import {
  planSelectedWorktreeThreadSync,
  type SelectedWorktreeThreadSyncPlan,
} from "./thread-workspace-selection";

export type SelectedWorktreeThreadSyncPlanOptions = {
  projectId: number;
  selectedProjectIdRef: MutableRefObject<number | null>;
  selectedThreadIdRef: MutableRefObject<number | null>;
  selectedWorktreePathRef: MutableRefObject<string | null>;
  threadOpenInFlight: boolean;
  threads: RpcThread[];
  worktreeAutoCreationInFlight: boolean;
  worktreePath: string;
};

export function deriveSelectedWorktreeThreadSyncPlan(
  options: SelectedWorktreeThreadSyncPlanOptions,
): SelectedWorktreeThreadSyncPlan {
  const preferredThread = preferredThreadForWorktree(
    options.threads,
    options.projectId,
    options.worktreePath,
  );

  return planSelectedWorktreeThreadSync({
    preferredThreadId: preferredThread?.id ?? null,
    projectId: options.projectId,
    selectedProjectId: options.selectedProjectIdRef.current,
    selectedThreadId: options.selectedThreadIdRef.current,
    selectedWorktreePath: options.selectedWorktreePathRef.current,
    threadOpenInFlight: options.threadOpenInFlight,
    worktreeAutoCreationInFlight: options.worktreeAutoCreationInFlight,
    worktreePath: options.worktreePath,
  });
}
