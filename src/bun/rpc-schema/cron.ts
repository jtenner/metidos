import type { RpcReasoningEffort } from "./model-catalog";

export type RpcCronJobRunStatus =
  | "InProgress"
  | "Stopped"
  | "Errored"
  | "Completed";

export type RpcCronJob = {
  id: number;
  projectId: number;
  worktreePath: string;
  schedule: string;
  prompt: string;
  title: string;
  description: string;
  model: string;
  reasoningEffort: RpcReasoningEffort;
  webSearchAccess: boolean;
  githubAccess: boolean;
  gitAccess?: boolean;
  sqliteAccess?: boolean;
  webServerAccess?: boolean;
  agentsAccess: boolean;
  calendarAccess?: boolean;
  notificationsAccess?: boolean;
  weatherAccess?: boolean;
  threadsAccess?: boolean;
  cronsAccess?: boolean;
  metidosAccess: boolean;
  pluginAccessGroups?: string[];
  permissions?: string[];
  unsafeMode: boolean;
  lastRunDate: number | null;
  lastRunStatus: RpcCronJobRunStatus | null;
  enabled: 0 | 1;
  deletedAt: number | null;
  createdAt: string;
  updatedAt: string;
  nextRunDate: number | null;
};
