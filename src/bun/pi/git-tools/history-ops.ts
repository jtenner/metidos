/**
 * @file src/bun/pi/git-tools/history-ops.ts
 * @description Pi-native Git merge, rebase, cherry-pick, and am tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { readGitHistoryFirstPage, runGitCommand } from "../../git";
import type { RpcGitHistoryEntry } from "../../rpc-schema";
import {
  normalizeGitPathArguments,
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

const GitMergeToolParameters = Type.Object({
  action: Type.Optional(
    Type.Union(
      [Type.Literal("merge"), Type.Literal("abort"), Type.Literal("continue")],
      {
        description:
          "Manage an in-progress merge instead of starting a new one.",
      },
    ),
  ),
  allowUnrelatedHistories: Type.Optional(
    Type.Boolean({
      description:
        "Allow merging histories that do not share a common ancestor.",
    }),
  ),
  ffMode: Type.Optional(
    Type.Union(
      [Type.Literal("allow"), Type.Literal("only"), Type.Literal("no")],
      {
        description:
          "Control whether the merge may fast-forward, must fast-forward, or must create a merge commit.",
      },
    ),
  ),
  message: Type.Optional(
    Type.String({
      description: "Merge commit message.",
      minLength: 1,
      maxLength: 10_000,
    }),
  ),
  revisions: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Commit-ish revisions to merge into the current branch.",
      minItems: 1,
      maxItems: 20,
    },
  ),
});

const GitRebaseToolParameters = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("rebase"),
        Type.Literal("abort"),
        Type.Literal("continue"),
        Type.Literal("skip"),
      ],
      {
        description:
          "Manage an in-progress rebase instead of starting a new one.",
      },
    ),
  ),
  forceRebase: Type.Optional(
    Type.Boolean({
      description:
        "Replay commits even when Git thinks the branch is already up to date.",
    }),
  ),
  keepBase: Type.Optional(
    Type.Boolean({
      description:
        "Keep the merge base instead of rebasing directly onto the upstream tip.",
    }),
  ),
  ontoRevision: Type.Optional(
    Type.String({
      description: "New base to rebase onto instead of the upstream revision.",
      minLength: 1,
    }),
  ),
  upstreamRevision: Type.Optional(
    Type.String({
      description: "Upstream revision to rebase the current branch onto.",
      minLength: 1,
    }),
  ),
});

const GitCherryPickToolParameters = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("pick"),
        Type.Literal("abort"),
        Type.Literal("continue"),
        Type.Literal("skip"),
        Type.Literal("quit"),
      ],
      {
        description:
          "Manage an in-progress cherry-pick instead of starting a new one.",
      },
    ),
  ),
  commits: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description:
        "Commit-ish revisions to cherry-pick onto the current branch.",
      minItems: 1,
      maxItems: 20,
    },
  ),
  mainline: Type.Optional(
    Type.Integer({
      description: "Parent number to use when cherry-picking a merge commit.",
      minimum: 1,
      maximum: 20,
    }),
  ),
  noCommit: Type.Optional(
    Type.Boolean({
      description: "Apply the changes without creating the cherry-pick commit.",
    }),
  ),
  signoff: Type.Optional(
    Type.Boolean({
      description: "Append a Signed-off-by trailer to the new commit.",
    }),
  ),
});

const GitAmToolParameters = Type.Object({
  action: Type.Optional(
    Type.Union(
      [
        Type.Literal("apply"),
        Type.Literal("abort"),
        Type.Literal("continue"),
        Type.Literal("quit"),
        Type.Literal("skip"),
      ],
      {
        description:
          "Manage an in-progress git am sequence instead of starting a new one.",
      },
    ),
  ),
  keepCr: Type.Optional(
    Type.Boolean({
      description: "Preserve carriage returns while applying patches.",
    }),
  ),
  noVerify: Type.Optional(
    Type.Boolean({
      description: "Skip the pre-applypatch and applypatch-msg hooks.",
    }),
  ),
  patchPaths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative patch or mbox files to apply.",
      minItems: 1,
      maxItems: 20,
    },
  ),
  signoff: Type.Optional(
    Type.Boolean({
      description: "Append a Signed-off-by trailer to applied commits.",
    }),
  ),
  threeWay: Type.Optional(
    Type.Boolean({
      description:
        "Allow 3-way merge fallback when a patch does not apply cleanly.",
    }),
  ),
});

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeRevisionText(
  value: string | null | undefined,
): string | null {
  return normalizeOptionalText(value);
}

function normalizeRevisionList(values: readonly string[]): string[] {
  return values
    .map((value) => normalizeRevisionText(value))
    .filter((value): value is string => value !== null);
}

function formatCommitSummary(commit: {
  authorName: string;
  committedAt: string;
  hash: string;
  shortHash: string;
  subject: string;
}): string {
  return `${commit.shortHash} ${commit.subject} — ${commit.authorName} @ ${commit.committedAt}`;
}

async function resolveGitRevision(
  worktreePath: string,
  revision: string,
  signal?: AbortSignal,
): Promise<string> {
  return runGitCommand(
    worktreePath,
    ["rev-parse", "--verify", revision],
    typeof signal === "undefined" ? undefined : { signal },
  );
}

async function readLatestCommitSummary(
  worktreePath: string,
  signal?: AbortSignal,
) {
  const { history } = await readGitHistoryFirstPage(
    0,
    worktreePath,
    1,
    typeof signal === "undefined" ? undefined : { signal },
  );
  return {
    branch: history.branch,
    commit: history.entries[0] ?? null,
  };
}

type GitMergeToolResultDetails = {
  action: "merge" | "abort" | "continue";
  allowUnrelatedHistories: boolean;
  branch: string | null;
  commit: RpcGitHistoryEntry | null;
  ffMode: "allow" | "no" | "only";
  message: string | null;
  mergeOutput: string;
  revisions: string[];
  resolvedRevisions: string[];
  worktreePath: string;
};

type GitRebaseToolResultDetails = {
  action: "rebase" | "abort" | "continue" | "skip";
  branch: string | null;
  commit: RpcGitHistoryEntry | null;
  forceRebase: boolean;
  keepBase: boolean;
  ontoRevision: string | null;
  rebaseOutput: string;
  resolvedOntoRevision: string | null;
  resolvedUpstreamRevision: string | null;
  upstreamRevision: string | null;
  worktreePath: string;
};

type GitCherryPickToolResultDetails = {
  action: "pick" | "abort" | "continue" | "skip" | "quit";
  branch: string | null;
  cherryPickOutput: string;
  commit: RpcGitHistoryEntry | null;
  commits: string[];
  mainline: number | null;
  noCommit: boolean;
  resolvedCommits: string[];
  signoff: boolean;
  worktreePath: string;
};

type GitAmToolResultDetails = {
  action: "apply" | "abort" | "continue" | "quit" | "skip";
  amOutput: string;
  branch: string | null;
  commit: RpcGitHistoryEntry | null;
  keepCr: boolean;
  noVerify: boolean;
  patchPaths: string[];
  signoff: boolean;
  threeWay: boolean;
  worktreePath: string;
};

export function createPiGitHistoryOperationTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Merge `revisions` into the current branch, or use `action` to `abort` or `continue` an in-progress merge. Optional `ffMode`, `message`, and `allowUnrelatedHistories` tune the merge command.",
        execute: async (_toolCallId, params, signal) => {
          const action = params.action ?? "merge";
          if (action !== "merge") {
            const mergeOutput = await runGitCommand(
              scope.worktreePathContext,
              ["merge", `--${action}`],
              typeof signal === "undefined" ? undefined : { signal },
            );
            const { branch, commit } = await readLatestCommitSummary(
              scope.worktreePathContext,
              signal,
            );
            return textToolResult<GitMergeToolResultDetails>(
              [
                `${action === "abort" ? "Aborted" : "Continued"} merge in ${scope.worktreePathContext}.`,
                `Branch: ${branch ?? "unknown"}`,
                commit
                  ? `Commit: ${formatCommitSummary(commit)}`
                  : "Commit: none",
              ].join("\n"),
              {
                action,
                allowUnrelatedHistories:
                  params.allowUnrelatedHistories === true,
                branch,
                commit,
                ffMode: params.ffMode ?? "allow",
                message: normalizeOptionalText(params.message),
                mergeOutput,
                revisions: [],
                resolvedRevisions: [],
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const revisions = normalizeRevisionList(params.revisions);
          if (revisions.length === 0) {
            throw new Error("At least one revision is required.");
          }

          const resolvedRevisions = await Promise.all(
            revisions.map((revision) =>
              resolveGitRevision(scope.worktreePathContext, revision, signal),
            ),
          );
          const ffMode = params.ffMode ?? "allow";
          const message = normalizeOptionalText(params.message);
          const mergeOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "merge",
              "--no-edit",
              ...(ffMode === "only"
                ? ["--ff-only"]
                : ffMode === "no"
                  ? ["--no-ff"]
                  : []),
              ...(params.allowUnrelatedHistories === true
                ? ["--allow-unrelated-histories"]
                : []),
              ...(message ? ["-m", message] : []),
              "--",
              ...resolvedRevisions,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { branch, commit } = await readLatestCommitSummary(
            scope.worktreePathContext,
            signal,
          );
          const textSections = [
            `Git merge for ${scope.worktreePathContext}`,
            `Revisions: ${revisions.join(", ")}`,
            `Resolved revisions: ${resolvedRevisions.join(", ")}`,
            `FF mode: ${ffMode}`,
            `Allow unrelated histories: ${params.allowUnrelatedHistories === true ? "yes" : "no"}`,
            message ? `Message: ${message}` : "Message: default",
            `Branch: ${branch ?? "unknown"}`,
            commit ? `Commit: ${formatCommitSummary(commit)}` : "Commit: none",
          ];

          return textToolResult<GitMergeToolResultDetails>(
            textSections.join("\n"),
            {
              action,
              allowUnrelatedHistories: params.allowUnrelatedHistories === true,
              branch,
              commit,
              ffMode,
              message,
              mergeOutput,
              revisions,
              resolvedRevisions,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Merge",
        name: "git_merge",
        parameters: GitMergeToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitMergeToolParameters>(args, [
            "allowUnrelatedHistories",
          ]),
        promptGuidelines: [
          "Use this to merge one or more commit-ish revisions into the current branch, or to abort or continue an in-progress merge.",
        ],
        promptSnippet: "Merge revisions into the current Git branch",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Rebase the current branch from `upstreamRevision`, optionally using `ontoRevision`, `keepBase`, `forceRebase`, or `action` to manage an in-progress rebase.",
        execute: async (_toolCallId, params, signal) => {
          const action = params.action ?? "rebase";
          if (action !== "rebase") {
            const rebaseOutput = await runGitCommand(
              scope.worktreePathContext,
              ["rebase", `--${action}`],
              typeof signal === "undefined" ? undefined : { signal },
            );
            const { branch, commit } = await readLatestCommitSummary(
              scope.worktreePathContext,
              signal,
            );
            return textToolResult<GitRebaseToolResultDetails>(
              [
                `${action === "abort" ? "Aborted" : action === "skip" ? "Skipped" : "Continued"} rebase in ${scope.worktreePathContext}.`,
                `Branch: ${branch ?? "unknown"}`,
                commit
                  ? `Commit: ${formatCommitSummary(commit)}`
                  : "Commit: none",
              ].join("\n"),
              {
                action,
                branch,
                commit,
                forceRebase: params.forceRebase === true,
                keepBase: params.keepBase === true,
                ontoRevision: normalizeOptionalText(params.ontoRevision),
                rebaseOutput,
                resolvedOntoRevision: null,
                resolvedUpstreamRevision: null,
                upstreamRevision: normalizeOptionalText(
                  params.upstreamRevision,
                ),
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const upstreamRevision = normalizeOptionalText(
            params.upstreamRevision,
          );
          if (!upstreamRevision) {
            throw new Error("Upstream revision cannot be blank.");
          }

          const resolvedUpstreamRevision = await resolveGitRevision(
            scope.worktreePathContext,
            upstreamRevision,
            signal,
          );
          const ontoRevision = normalizeOptionalText(params.ontoRevision);
          const resolvedOntoRevision = ontoRevision
            ? await resolveGitRevision(
                scope.worktreePathContext,
                ontoRevision,
                signal,
              )
            : null;
          const rebaseOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "rebase",
              ...(params.forceRebase === true ? ["--force-rebase"] : []),
              ...(params.keepBase === true ? ["--keep-base"] : []),
              ...(resolvedOntoRevision ? ["--onto", resolvedOntoRevision] : []),
              resolvedUpstreamRevision,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { branch, commit } = await readLatestCommitSummary(
            scope.worktreePathContext,
            signal,
          );
          const textSections = [
            `Git rebase for ${scope.worktreePathContext}`,
            `Upstream: ${upstreamRevision} -> ${resolvedUpstreamRevision}`,
            ontoRevision
              ? `Onto: ${ontoRevision} -> ${resolvedOntoRevision}`
              : "Onto: default",
            `Force rebase: ${params.forceRebase === true ? "yes" : "no"}`,
            `Keep base: ${params.keepBase === true ? "yes" : "no"}`,
            `Branch: ${branch ?? "unknown"}`,
            commit ? `Commit: ${formatCommitSummary(commit)}` : "Commit: none",
          ];

          return textToolResult<GitRebaseToolResultDetails>(
            textSections.join("\n"),
            {
              action,
              branch,
              commit,
              forceRebase: params.forceRebase === true,
              keepBase: params.keepBase === true,
              ontoRevision,
              rebaseOutput,
              resolvedOntoRevision,
              resolvedUpstreamRevision,
              upstreamRevision,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Rebase",
        name: "git_rebase",
        parameters: GitRebaseToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitRebaseToolParameters>(args, [
            "forceRebase",
            "keepBase",
          ]),
        promptGuidelines: [
          "Use this to replay the current branch on top of another revision, or to abort, continue, or skip an in-progress rebase.",
        ],
        promptSnippet: "Rebase the current Git branch",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Cherry-pick `commits` onto the current branch, or use `action` to `abort`, `continue`, `skip`, or `quit` an in-progress cherry-pick. Optional `mainline`, `noCommit`, and `signoff` refine the pick.",
        execute: async (_toolCallId, params, signal) => {
          const action = params.action ?? "pick";
          if (action !== "pick") {
            const cherryPickOutput = await runGitCommand(
              scope.worktreePathContext,
              ["cherry-pick", `--${action}`],
              typeof signal === "undefined" ? undefined : { signal },
            );
            const { branch, commit } = await readLatestCommitSummary(
              scope.worktreePathContext,
              signal,
            );
            return textToolResult<GitCherryPickToolResultDetails>(
              [
                `${action === "abort" ? "Aborted" : action === "skip" ? "Skipped" : action === "quit" ? "Quit" : "Continued"} cherry-pick in ${scope.worktreePathContext}.`,
                `Branch: ${branch ?? "unknown"}`,
                commit
                  ? `Commit: ${formatCommitSummary(commit)}`
                  : "Commit: none",
              ].join("\n"),
              {
                action,
                branch,
                cherryPickOutput,
                commit,
                commits: [],
                mainline:
                  typeof params.mainline === "number" ? params.mainline : null,
                noCommit: params.noCommit === true,
                resolvedCommits: [],
                signoff: params.signoff === true,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const commits = normalizeRevisionList(params.commits);
          if (commits.length === 0) {
            throw new Error("At least one commit is required.");
          }

          const resolvedCommits = await Promise.all(
            commits.map((commit) =>
              resolveGitRevision(scope.worktreePathContext, commit, signal),
            ),
          );
          const cherryPickOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "cherry-pick",
              ...(params.noCommit === true ? ["--no-commit"] : []),
              ...(params.signoff === true ? ["--signoff"] : []),
              ...(typeof params.mainline === "number"
                ? ["--mainline", String(params.mainline)]
                : []),
              ...resolvedCommits,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { branch, commit } = await readLatestCommitSummary(
            scope.worktreePathContext,
            signal,
          );
          const effectiveCommit = params.noCommit === true ? null : commit;
          const textSections = [
            `Git cherry-pick for ${scope.worktreePathContext}`,
            `Commits: ${commits.join(", ")}`,
            `Resolved commits: ${resolvedCommits.join(", ")}`,
            `Mainline: ${typeof params.mainline === "number" ? String(params.mainline) : "none"}`,
            `No commit: ${params.noCommit === true ? "yes" : "no"}`,
            `Signoff: ${params.signoff === true ? "yes" : "no"}`,
            `Branch: ${branch ?? "unknown"}`,
            effectiveCommit
              ? `Commit: ${formatCommitSummary(effectiveCommit)}`
              : "Commit: none",
          ];

          return textToolResult<GitCherryPickToolResultDetails>(
            textSections.join("\n"),
            {
              action,
              branch,
              cherryPickOutput,
              commit: effectiveCommit,
              commits,
              mainline:
                typeof params.mainline === "number" ? params.mainline : null,
              noCommit: params.noCommit === true,
              resolvedCommits,
              signoff: params.signoff === true,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Cherry Pick",
        name: "git_cherry_pick",
        parameters: GitCherryPickToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCherryPickToolParameters>(
            args,
            ["noCommit", "signoff"],
            ["mainline"],
          ),
        promptGuidelines: [
          "Use this to replay one or more commits onto the current branch, or to abort, continue, skip, or quit an in-progress cherry-pick.",
        ],
        promptSnippet: "Cherry-pick commits onto the current Git branch",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Apply `patchPaths` with git am, or use `action` to `abort`, `continue`, `quit`, or `skip` an in-progress sequence. Optional `threeWay`, `signoff`, `keepCr`, and `noVerify` tune the apply step.",
        execute: async (_toolCallId, params, signal) => {
          const action = params.action ?? "apply";
          if (action !== "apply") {
            const amOutput = await runGitCommand(
              scope.worktreePathContext,
              ["am", `--${action}`],
              typeof signal === "undefined" ? undefined : { signal },
            );
            const { branch, commit } = await readLatestCommitSummary(
              scope.worktreePathContext,
              signal,
            );
            return textToolResult<GitAmToolResultDetails>(
              [
                `${action === "abort" ? "Aborted" : action === "skip" ? "Skipped" : action === "quit" ? "Quit" : "Continued"} git am in ${scope.worktreePathContext}.`,
                `Branch: ${branch ?? "unknown"}`,
                commit
                  ? `Commit: ${formatCommitSummary(commit)}`
                  : "Commit: none",
              ].join("\n"),
              {
                action,
                amOutput,
                branch,
                commit,
                keepCr: params.keepCr === true,
                noVerify: params.noVerify === true,
                patchPaths: [],
                signoff: params.signoff === true,
                threeWay: params.threeWay === true,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const patchPaths =
            params.patchPaths && params.patchPaths.length > 0
              ? normalizeGitPathArguments(
                  scope.worktreePathContext,
                  params.patchPaths,
                )
              : [];
          if (patchPaths.length === 0) {
            throw new Error("At least one patch path is required.");
          }

          const amOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "am",
              ...(params.noVerify === true ? ["--no-verify"] : []),
              ...(params.signoff === true ? ["--signoff"] : []),
              ...(params.threeWay === true ? ["--3way"] : []),
              ...(params.keepCr === true ? ["--keep-cr"] : []),
              ...patchPaths,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { branch, commit } = await readLatestCommitSummary(
            scope.worktreePathContext,
            signal,
          );
          const textSections = [
            `Git am for ${scope.worktreePathContext}`,
            `Patch paths: ${patchPaths.join(", ")}`,
            `Three way: ${params.threeWay === true ? "yes" : "no"}`,
            `Signoff: ${params.signoff === true ? "yes" : "no"}`,
            `Keep CR: ${params.keepCr === true ? "yes" : "no"}`,
            `No verify: ${params.noVerify === true ? "yes" : "no"}`,
            `Branch: ${branch ?? "unknown"}`,
            commit ? `Commit: ${formatCommitSummary(commit)}` : "Commit: none",
          ];

          return textToolResult<GitAmToolResultDetails>(
            textSections.join("\n"),
            {
              action,
              amOutput,
              branch,
              commit,
              keepCr: params.keepCr === true,
              noVerify: params.noVerify === true,
              patchPaths,
              signoff: params.signoff === true,
              threeWay: params.threeWay === true,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Am",
        name: "git_am",
        parameters: GitAmToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitAmToolParameters>(args, [
            "keepCr",
            "noVerify",
            "signoff",
            "threeWay",
          ]),
        promptGuidelines: [
          "Use this to apply patch series from local patch or mbox files, or to abort, continue, quit, or skip an in-progress am sequence.",
        ],
        promptSnippet: "Apply local patch files with git am",
      }),
    ),
  ];
}
