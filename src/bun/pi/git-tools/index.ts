/**
 * @file src/bun/pi/git-tools/index.ts
 * @description Pi-native Git tool definitions and default Git CLI host.
 */

import type { ToolDefinition } from "@mariozechner/pi-coding-agent";

import { runGitCommand } from "../../git";
import { createPiGitHistoryTools } from "./history";
import { createPiGitHistoryOperationTools } from "./history-ops";
import { createPiGitInspectionTools } from "./inspection";
import { createPiGitLowLevelTools } from "./low-level";
import { createPiGitPlumbingTools } from "./plumbing";
import { createPiGitReadTools } from "./read";
import { createPiGitSearchTools } from "./search";
import type { PiGitToolHost, PiGitToolScope } from "./shared";
import { createPiGitWorktreeTools } from "./worktree";
import { createPiGitWriteTools } from "./write";

export type { PiGitToolHost, PiGitToolScope };

export function createPiGitCliHost(worktreePath: string): PiGitToolHost {
  return {
    getStatus: (signal) =>
      runGitCommand(
        worktreePath,
        ["status", "--porcelain=v1", "--branch", "--untracked-files=all"],
        typeof signal === "undefined" ? undefined : { signal },
      ),
  };
}

export function createPiGitTools(
  scope: PiGitToolScope,
  host: PiGitToolHost,
): ToolDefinition[] {
  return [
    ...createPiGitReadTools(scope, host),
    ...createPiGitSearchTools(scope, host),
    ...createPiGitHistoryTools(scope, host),
    ...createPiGitHistoryOperationTools(scope, host),
    ...createPiGitPlumbingTools(scope, host),
    ...createPiGitInspectionTools(scope, host),
    ...createPiGitLowLevelTools(scope, host),
    ...createPiGitWriteTools(scope, host),
    ...createPiGitWorktreeTools(scope, host),
  ];
}
