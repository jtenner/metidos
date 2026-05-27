/**
 * @file src/bun/pi/git-tools/worktree.ts
 * @description Pi-native Git worktree inspection and initialization tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { listGitWorktreesForProjectPath, runGitCommand } from "../../git";
import {
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

const GitWorktreeListToolParameters = Type.Object({
  maxWorktrees: Type.Optional(
    Type.Integer({
      description: "Maximum number of worktrees to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitInitToolParameters = Type.Object({
  initialBranch: Type.Optional(
    Type.String({
      description: "Initial branch name for the new repository.",
      minLength: 1,
    }),
  ),
  quiet: Type.Optional(
    Type.Boolean({
      description: "Suppress the standard git init output.",
    }),
  ),
});

type GitWorktreeEntry = {
  bare: boolean;
  branch: string | null;
  current: boolean;
  head: string | null;
  path: string;
};

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePositiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < minimum
  ) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, value));
}

function formatGitWorktreeEntry(entry: GitWorktreeEntry): string {
  const marker = entry.current ? "*" : " ";
  const branchText = entry.branch ? ` branch=${entry.branch}` : " detached";
  const headText = entry.head ? ` head=${entry.head}` : " head=unknown";
  const bareText = entry.bare ? " bare" : "";
  return `${marker} ${entry.path}${branchText}${headText}${bareText}`.trimEnd();
}

async function validateInitialBranchName(
  worktreePath: string,
  branchName: string,
  signal?: AbortSignal,
): Promise<void> {
  await runGitCommand(
    worktreePath,
    ["check-ref-format", "--branch", branchName],
    typeof signal === "undefined" ? undefined : { signal },
  );
}

export function createPiGitWorktreeTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "List linked worktrees for the current repository with `maxWorktrees` bounding the returned entries.",
        execute: async (_toolCallId, params, signal) => {
          const maxWorktrees = normalizePositiveInteger(
            params.maxWorktrees,
            50,
            1,
            2_000,
          );
          const worktrees = await listGitWorktreesForProjectPath(
            scope.worktreePathContext,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const shownWorktrees = worktrees
            .slice(0, maxWorktrees)
            .map((item) => ({
              ...item,
              current: item.path === scope.worktreePathContext,
            }));
          const truncated =
            worktrees.length > shownWorktrees.length
              ? worktrees.length - shownWorktrees.length
              : null;
          const textSections = [
            `Git worktrees for ${scope.worktreePathContext}`,
            `Showing ${shownWorktrees.length} worktree(s) from ${worktrees.length} total with limit ${maxWorktrees}.`,
            shownWorktrees.length > 0
              ? [
                  "Worktrees",
                  shownWorktrees
                    .map((worktree) => formatGitWorktreeEntry(worktree))
                    .join("\n"),
                ].join("\n\n")
              : "Worktrees\n\n- none",
          ];
          if (truncated !== null) {
            textSections.push(
              `Truncated: ${truncated} additional worktree(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            currentWorktreePath: scope.worktreePathContext,
            shownWorktreeCount: shownWorktrees.length,
            truncated,
            worktreeCount: worktrees.length,
            worktrees: shownWorktrees,
            maxWorktrees,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Worktree List",
        name: "git_worktree_list",
        parameters: GitWorktreeListToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitWorktreeListToolParameters>(
            args,
            [],
            ["maxWorktrees"],
          ),
        promptGuidelines: [
          "Use this to inspect which linked worktrees exist before deciding where to switch or create a thread.",
        ],
        promptSnippet: "List linked Git worktrees for the repository",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Initialize the current worktree with `initialBranch` and `quiet` controls while staying bound to the active repository path.",
        execute: async (_toolCallId, params, signal) => {
          const initialBranch = normalizeOptionalText(params.initialBranch);
          if (initialBranch) {
            await validateInitialBranchName(
              scope.worktreePathContext,
              initialBranch,
              signal,
            );
          }

          const quiet = params.quiet === true;
          const initOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "init",
              ...(quiet ? ["-q"] : []),
              ...(initialBranch ? ["--initial-branch", initialBranch] : []),
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const currentBranch = await runGitCommand(
            scope.worktreePathContext,
            ["branch", "--show-current"],
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              `Initialized Git repository in ${scope.worktreePathContext}.`,
              `Initial branch: ${currentBranch || initialBranch || "unknown"}`,
              `Quiet: ${quiet ? "yes" : "no"}`,
            ].join("\n"),
            {
              currentBranch: currentBranch || null,
              initialBranch,
              initOutput,
              quiet,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Init",
        name: "git_init",
        parameters: GitInitToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitInitToolParameters>(args, [
            "quiet",
          ]),
        promptGuidelines: [
          "Use this to initialize the current worktree as a Git repository before staging or committing files.",
        ],
        promptSnippet: "Initialize Git in the current worktree",
      }),
    ),
  ];
}
