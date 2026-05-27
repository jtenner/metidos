/**
 * @file src/bun/pi/thread-tool-policy.ts
 * @description Thread-scoped Pi tool availability and permission policy.
 */

import type { ThreadRecord } from "../db";
import { hasThreadPermission } from "../thread-permissions";

export const METIDOS_PERMISSION = {
  agents: "metidos:agents",
  calendar: "metidos:calendar",
  crons: "metidos:crons",
  git: "metidos:git",
  github: "metidos:github",
  lancedb: "metidos:lancedb",
  notifications: "metidos:notifications",
  sqlite: "metidos:sqlite",
  threads: "metidos:threads",
  unsafe: "metidos:unsafe",
  webSearch: "metidos:web-search",
  webServer: "metidos:webserver",
} as const;

export type MetidosPermissionId =
  (typeof METIDOS_PERMISSION)[keyof typeof METIDOS_PERMISSION];

export type PiThreadToolPolicyThread = Pick<ThreadRecord, "permissions">;

export type PiThreadToolPolicy = {
  activeToolNames: readonly string[];
  allowBash: boolean;
  allowUnsafeModeEscalation: boolean;
  runtimePromptLine: string;
};

export function hasPiThreadRuntimePermission(
  thread: PiThreadToolPolicyThread,
  permission: MetidosPermissionId,
): boolean {
  return hasThreadPermission(thread.permissions, permission);
}

const SAFE_ACTIVE_TOOL_NAMES = [
  "read",
  "ls",
  "find",
  "grep",
  "edit",
  "write",
] as const;

const UNSAFE_ACTIVE_TOOL_NAMES = [
  "read",
  "bash",
  "ls",
  "find",
  "grep",
  "edit",
  "write",
] as const;

export function buildPiThreadToolPolicy(
  thread: PiThreadToolPolicyThread,
): PiThreadToolPolicy {
  if (hasPiThreadRuntimePermission(thread, METIDOS_PERMISSION.unsafe)) {
    return {
      activeToolNames: UNSAFE_ACTIVE_TOOL_NAMES,
      allowBash: true,
      allowUnsafeModeEscalation: true,
      runtimePromptLine:
        "Unsafe mode is enabled. Bash is available, and Metidos tools may create unsafe child threads or cron jobs. Stay within the workspace unless the user explicitly asks for broader host access.",
    };
  }

  return {
    activeToolNames: SAFE_ACTIVE_TOOL_NAMES,
    allowBash: false,
    allowUnsafeModeEscalation: false,
    runtimePromptLine:
      "Unsafe mode is disabled. Bash is unavailable. Use the installed worktree-scoped file/search tools instead. new_thread requests user approval before creating child threads, including unsafe ones; unsafe child cron jobs remain unavailable.",
  };
}
