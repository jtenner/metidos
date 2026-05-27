/**
 * @file src/bun/pi/git-tools/write.ts
 * @description Pi-native Git write tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { readGitHistoryFirstPage, runGitCommand } from "../../git";
import {
  buildGitNotesRefPath,
  normalizeGitNotesRefName,
  readGitNoteText,
} from "./notes";
import {
  normalizeGitPathArgument,
  normalizeGitPathArguments,
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";
import {
  formatGitTagEntry,
  normalizeGitTagName,
  readGitTagEntry,
} from "./tags";

const GitAddToolParameters = Type.Object({
  paths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative paths to stage.",
      minItems: 1,
    },
  ),
  update: Type.Optional(
    Type.Boolean({
      description: "Stage tracked changes only.",
    }),
  ),
});

const GitRestoreToolParameters = Type.Object({
  paths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative paths to restore.",
      minItems: 1,
    },
  ),
  source: Type.Optional(
    Type.String({
      description: "Commit-ish or tree-ish to restore from.",
      minLength: 1,
    }),
  ),
  staged: Type.Optional(
    Type.Boolean({
      description: "Restore the index instead of only the working tree.",
    }),
  ),
  worktree: Type.Optional(
    Type.Boolean({
      description: "Restore the working tree copy of each path.",
    }),
  ),
});

const GitRmToolParameters = Type.Object({
  cached: Type.Optional(
    Type.Boolean({
      description: "Remove paths from the index only.",
    }),
  ),
  force: Type.Optional(
    Type.Boolean({
      description: "Force the removal when Git would normally refuse it.",
    }),
  ),
  paths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative paths to remove.",
      minItems: 1,
    },
  ),
  recursive: Type.Optional(
    Type.Boolean({
      description: "Allow recursive removal of directories.",
    }),
  ),
});

const GitMoveToolParameters = Type.Object({
  destinationPath: Type.String({
    description: "Destination path for the tracked rename or move.",
    minLength: 1,
  }),
  force: Type.Optional(
    Type.Boolean({
      description: "Force the move when Git would normally refuse it.",
    }),
  ),
  sourcePath: Type.String({
    description: "Source path for the tracked rename or move.",
    minLength: 1,
  }),
});

const GitResetToolParameters = Type.Object({
  mode: Type.Optional(
    Type.Union([Type.Literal("soft"), Type.Literal("mixed")], {
      description:
        "Reset mode: soft keeps the index and worktree, mixed resets the index.",
    }),
  ),
  target: Type.Optional(
    Type.String({
      description: "Commit-ish to reset HEAD to.",
      minLength: 1,
    }),
  ),
});

const GitRevertToolParameters = Type.Object({
  commitHash: Type.String({
    description: "Commit hash or commit-ish to revert.",
    minLength: 1,
  }),
});

const GitStashToolParameters = Type.Object({
  includeUntracked: Type.Optional(
    Type.Boolean({
      description: "Include untracked files in the stash.",
    }),
  ),
  keepIndex: Type.Optional(
    Type.Boolean({
      description: "Keep staged changes in the worktree after stashing.",
    }),
  ),
  message: Type.Optional(
    Type.String({
      description: "Optional stash message.",
      minLength: 1,
      maxLength: 10_000,
    }),
  ),
});

const GitNotesToolParameters = Type.Object({
  force: Type.Optional(
    Type.Boolean({
      description: "Force replacement of an existing note.",
    }),
  ),
  message: Type.String({
    description: "Note message text.",
    minLength: 1,
    maxLength: 10_000,
  }),
  ref: Type.Optional(
    Type.String({
      description: "Notes ref to write to.",
      minLength: 1,
    }),
  ),
  target: Type.Optional(
    Type.String({
      description: "Commit-ish or other object to note.",
      minLength: 1,
    }),
  ),
});

const GitTagToolParameters = Type.Object({
  force: Type.Optional(
    Type.Boolean({
      description: "Force replacement of an existing tag.",
    }),
  ),
  message: Type.Optional(
    Type.String({
      description: "Annotated tag message.",
      minLength: 1,
      maxLength: 10_000,
    }),
  ),
  tagName: Type.String({
    description: "Tag name to create.",
    minLength: 1,
  }),
  target: Type.Optional(
    Type.String({
      description: "Commit-ish or other object to tag.",
      minLength: 1,
    }),
  ),
});

const GitCommitToolParameters = Type.Object({
  all: Type.Optional(
    Type.Boolean({
      description: "Stage tracked changes before committing.",
    }),
  ),
  allowEmpty: Type.Optional(
    Type.Boolean({
      description: "Allow creating an empty commit.",
    }),
  ),
  amend: Type.Optional(
    Type.Boolean({
      description: "Amend the most recent commit.",
    }),
  ),
  message: Type.String({
    description: "Commit message text.",
    minLength: 1,
    maxLength: 10_000,
  }),
});

const GitSwitchToolParameters = Type.Object({
  branchName: Type.String({
    description: "Branch name to switch to or create.",
    minLength: 1,
  }),
  create: Type.Optional(
    Type.Boolean({
      description: "Create the target branch before switching.",
    }),
  ),
  startPoint: Type.Optional(
    Type.String({
      description: "Start point for a newly created branch.",
      minLength: 1,
    }),
  ),
});

function formatPathList(paths: string[]): string {
  return paths.length > 0 ? paths.join(", ") : "(none)";
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

function formatPathMove(sourcePath: string, destinationPath: string): string {
  return `${sourcePath} -> ${destinationPath}`;
}

function normalizeOptionalText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.replace(/\r\n/g, "\n").split("\n");
}

function formatRestoreMode(staged: boolean, worktree: boolean): string {
  const parts = [staged ? "staged" : null, worktree ? "worktree" : null].filter(
    (part): part is string => typeof part === "string",
  );
  return parts.length > 0 ? parts.join(" / ") : "none";
}

function formatRemovalMode(
  cached: boolean,
  recursive: boolean,
  force: boolean,
): string {
  const parts = [
    cached ? "index only" : "index and worktree",
    recursive ? "recursive" : "non-recursive",
    force ? "force" : null,
  ].filter((part): part is string => typeof part === "string");
  return parts.join(", ");
}

function formatStashMode(
  includeUntracked: boolean,
  keepIndex: boolean,
): string {
  const parts = [
    includeUntracked ? "include untracked" : null,
    keepIndex ? "keep index" : null,
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(", ") : "standard";
}

function normalizeResetMode(
  value: string | null | undefined,
): "soft" | "mixed" {
  return value === "soft" ? "soft" : "mixed";
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

type GitStashEntry = {
  committedAt: string | null;
  hash: string;
  ref: string;
  subject: string;
};

function parseGitStashEntry(raw: string): GitStashEntry | null {
  const [ref = "", hash = "", subject = "", committedAt = ""] =
    raw.split("\u001f");
  if (!ref) {
    return null;
  }

  return {
    committedAt: committedAt || null,
    hash: hash || "unknown",
    ref,
    subject: subject || "unknown",
  };
}

function formatGitStashEntry(entry: GitStashEntry): string {
  return `${entry.ref} ${entry.hash} ${entry.subject}${
    entry.committedAt ? ` @ ${entry.committedAt}` : ""
  }`;
}

async function readLatestGitStashEntry(
  worktreePath: string,
  signal?: AbortSignal,
): Promise<GitStashEntry | null> {
  const raw = await runGitCommand(
    worktreePath,
    ["stash", "list", "-n", "1", "--format=%gd%x1f%H%x1f%gs%x1f%cI"],
    typeof signal === "undefined" ? undefined : { signal },
  );
  const line = raw.trim();
  return line ? parseGitStashEntry(line) : null;
}

export function createPiGitWriteTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Stage `paths` in the current worktree, with `update` limiting staging to tracked changes only, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const paths = normalizeGitPathArguments(
            scope.worktreePathContext,
            params.paths,
          );
          const args = [
            "add",
            ...(params.update === true ? ["--update"] : []),
            "--",
            ...paths,
          ];
          await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          const modeText =
            params.update === true
              ? "tracked changes only"
              : "tracked and new files";
          return textToolResult(
            [
              `Staged ${paths.length} path(s) in ${scope.worktreePathContext}.`,
              `Mode: ${modeText}`,
              `Paths: ${formatPathList(paths)}`,
            ].join("\n"),
            {
              pathCount: paths.length,
              paths,
              update: params.update === true,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Add",
        name: "git_add",
        parameters: GitAddToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitAddToolParameters>(args, [
            "update",
          ]),
        promptGuidelines: [
          "Use this to stage specific files or directories before committing.",
        ],
        promptSnippet: "Stage files in the current Git worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Restore `paths` from `source`, with `staged` and `worktree` choosing the index and/or worktree, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const paths = normalizeGitPathArguments(
            scope.worktreePathContext,
            params.paths,
          );
          const staged = params.staged === true;
          const worktree =
            params.worktree === true || (!staged && params.worktree !== false);
          if (!staged && !worktree) {
            throw new Error(
              "git_restore must target the staged index, the worktree, or both.",
            );
          }

          const source = normalizeOptionalText(params.source);
          const args = ["restore"];
          if (staged) {
            args.push("--staged");
          }
          if (worktree) {
            args.push("--worktree");
          }
          if (source) {
            args.push("--source", source);
          }
          args.push("--", ...paths);

          await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              `Restored ${paths.length} path(s) in ${scope.worktreePathContext}.`,
              `Mode: ${formatRestoreMode(staged, worktree)}`,
              `Source: ${source ?? "default"}`,
              `Paths: ${formatPathList(paths)}`,
            ].join("\n"),
            {
              pathCount: paths.length,
              paths,
              source,
              staged,
              worktree,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Restore",
        name: "git_restore",
        parameters: GitRestoreToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitRestoreToolParameters>(args, [
            "staged",
            "worktree",
          ]),
        promptGuidelines: [
          "Use this to discard working tree changes or move tracked content back from a commit-ish source.",
        ],
        promptSnippet: "Restore Git paths in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Remove `paths` from the current worktree or index, with `cached`, `force`, and `recursive` shaping the removal, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const paths = normalizeGitPathArguments(
            scope.worktreePathContext,
            params.paths,
          );
          const cached = params.cached === true;
          const force = params.force === true;
          const recursive = params.recursive !== false;
          const args = ["rm"];
          if (cached) {
            args.push("--cached");
          }
          if (force) {
            args.push("--force");
          }
          if (recursive) {
            args.push("-r");
          }
          args.push("--", ...paths);

          await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              `Removed ${paths.length} path(s) from ${scope.worktreePathContext}.`,
              `Mode: ${formatRemovalMode(cached, recursive, force)}`,
              `Paths: ${formatPathList(paths)}`,
            ].join("\n"),
            {
              cached,
              force,
              pathCount: paths.length,
              paths,
              recursive,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Remove",
        name: "git_rm",
        parameters: GitRmToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitRmToolParameters>(args, [
            "cached",
            "force",
            "recursive",
          ]),
        promptGuidelines: [
          "Use this to remove tracked files from the worktree or just from the index.",
        ],
        promptSnippet: "Remove Git paths in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Move `sourcePath` to `destinationPath` within the current worktree, with `force` overriding Git's rename checks, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const sourcePath = normalizeGitPathArgument(
            scope.worktreePathContext,
            params.sourcePath,
          );
          const destinationPath = normalizeGitPathArgument(
            scope.worktreePathContext,
            params.destinationPath,
          );
          if (sourcePath === destinationPath) {
            throw new Error("Source and destination paths must differ.");
          }

          const args = ["mv"];
          if (params.force === true) {
            args.push("--force");
          }
          args.push("--", sourcePath, destinationPath);

          await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              `Moved ${formatPathMove(sourcePath, destinationPath)} in ${scope.worktreePathContext}.`,
              `Mode: ${params.force === true ? "force" : "standard"}`,
            ].join("\n"),
            {
              destinationPath,
              force: params.force === true,
              sourcePath,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Move",
        name: "git_mv",
        parameters: GitMoveToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitMoveToolParameters>(args, [
            "force",
          ]),
        promptGuidelines: [
          "Use this to rename or move a tracked file while keeping the change within the current worktree.",
        ],
        promptSnippet: "Move a tracked file in the current Git worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Reset `target` in the current worktree, with `mode` choosing soft or mixed reset behavior, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const mode = normalizeResetMode(params.mode);
          const target = normalizeOptionalText(params.target) ?? "HEAD";
          const resolvedTarget = await resolveGitRevision(
            scope.worktreePathContext,
            target,
            signal,
          );
          const resetOutput = await runGitCommand(
            scope.worktreePathContext,
            ["reset", `--${mode}`, resolvedTarget],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { history } = await readGitHistoryFirstPage(
            0,
            scope.worktreePathContext,
            1,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const latestCommit = history.entries[0] ?? null;
          if (!latestCommit) {
            throw new Error("Unable to read the current commit after reset.");
          }

          return textToolResult(
            [
              `Reset ${scope.worktreePathContext} to ${target}.`,
              `Mode: ${mode}`,
              `Resolved target: ${resolvedTarget}`,
              `Branch: ${history.branch ?? "unknown"}`,
              `Commit: ${formatCommitSummary(latestCommit)}`,
            ].join("\n"),
            {
              branch: history.branch,
              commit: latestCommit,
              mode,
              resetOutput,
              resolvedTarget,
              target,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Reset",
        name: "git_reset",
        parameters: GitResetToolParameters,
        promptGuidelines: [
          "Use this to move the current branch to an earlier commit while keeping the operation scoped to the active worktree.",
        ],
        promptSnippet: "Reset the current Git branch to a commit",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Revert `commitHash` in the current worktree by creating a new revert commit without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const revertedCommitHash = normalizeOptionalText(params.commitHash);
          if (!revertedCommitHash) {
            throw new Error("Commit hash cannot be blank.");
          }

          const resolvedCommitHash = await resolveGitRevision(
            scope.worktreePathContext,
            revertedCommitHash,
            signal,
          );
          const revertOutput = await runGitCommand(
            scope.worktreePathContext,
            ["revert", "--no-edit", resolvedCommitHash],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { history } = await readGitHistoryFirstPage(
            0,
            scope.worktreePathContext,
            1,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const latestCommit = history.entries[0] ?? null;
          if (!latestCommit) {
            throw new Error("Unable to read the latest commit after revert.");
          }

          return textToolResult(
            [
              `Reverted commit ${revertedCommitHash} in ${scope.worktreePathContext}.`,
              `Resolved commit: ${resolvedCommitHash}`,
              `Branch: ${history.branch ?? "unknown"}`,
              `Commit: ${formatCommitSummary(latestCommit)}`,
            ].join("\n"),
            {
              branch: history.branch,
              commit: latestCommit,
              commitHash: revertedCommitHash,
              revertOutput,
              resolvedCommitHash,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Revert",
        name: "git_revert",
        parameters: GitRevertToolParameters,
        promptGuidelines: [
          "Use this to create a new commit that reverses an earlier commit in the current repository.",
        ],
        promptSnippet: "Revert a Git commit in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Create a stash with `includeUntracked`, `keepIndex`, and `message` controlling the saved state without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const message = normalizeOptionalText(params.message);
          const includeUntracked = params.includeUntracked === true;
          const keepIndex = params.keepIndex === true;
          const beforeStash = await readLatestGitStashEntry(
            scope.worktreePathContext,
            signal,
          );
          const args = ["stash", "push"];
          if (includeUntracked) {
            args.push("--include-untracked");
          }
          if (keepIndex) {
            args.push("--keep-index");
          }
          if (message) {
            args.push("-m", message);
          }

          const pushOutput = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const latestStash = await readLatestGitStashEntry(
            scope.worktreePathContext,
            signal,
          );
          const created =
            latestStash !== null &&
            (beforeStash === null || latestStash.hash !== beforeStash.hash);

          return textToolResult(
            [
              `Stashed changes in ${scope.worktreePathContext}.`,
              `Created stash entry: ${created ? "yes" : "no"}`,
              `Mode: ${formatStashMode(includeUntracked, keepIndex)}`,
              `Message: ${message ?? "default"}`,
              latestStash
                ? `Latest stash: ${formatGitStashEntry(latestStash)}`
                : "Latest stash: none",
            ].join("\n"),
            {
              created,
              includeUntracked,
              keepIndex,
              message,
              previousStash: beforeStash,
              pushOutput,
              stashEntry: latestStash,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Stash",
        name: "git_stash",
        parameters: GitStashToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitStashToolParameters>(args, [
            "includeUntracked",
            "keepIndex",
          ]),
        promptGuidelines: [
          "Use this to save the current worktree changes into a local stash before switching tasks or branches.",
        ],
        promptSnippet: "Stash the current Git worktree changes",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Create `tagName` at `target`, with `message` and `force` controlling annotated and replacement behavior, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const tagName = normalizeGitTagName(params.tagName);
          if (!tagName) {
            throw new Error("Tag name cannot be blank.");
          }

          await runGitCommand(
            scope.worktreePathContext,
            ["check-ref-format", "--allow-onelevel", `refs/tags/${tagName}`],
            typeof signal === "undefined" ? undefined : { signal },
          );

          const target = normalizeOptionalText(params.target) ?? "HEAD";
          const resolvedTargetHash = await resolveGitRevision(
            scope.worktreePathContext,
            target,
            signal,
          );
          const message = normalizeOptionalText(params.message);
          const annotated = message !== null;
          const args = ["tag"];
          if (params.force === true) {
            args.push("--force");
          }
          if (annotated) {
            args.push("-a", "-m", message);
          }
          args.push(tagName, resolvedTargetHash);

          const tagOutput = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const tag = await readGitTagEntry(
            scope.worktreePathContext,
            tagName,
            signal,
          );
          if (!tag) {
            throw new Error("Unable to read the created tag details.");
          }

          return textToolResult(
            [
              `Tagged ${tagName} in ${scope.worktreePathContext}.`,
              `Mode: ${annotated ? "annotated" : "lightweight"}`,
              `Target: ${target} -> ${resolvedTargetHash}`,
              `Tag: ${formatGitTagEntry(tag)}`,
              `Message: ${message ?? "none"}`,
            ].join("\n"),
            {
              annotated,
              force: params.force === true,
              message,
              resolvedTargetHash,
              tag,
              tagName,
              tagOutput,
              target,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Tag",
        name: "git_tag",
        parameters: GitTagToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitTagToolParameters>(args, ["force"]),
        promptGuidelines: [
          "Use this to mark a commit or object with a local tag while keeping the operation scoped to the active repository.",
        ],
        promptSnippet: "Create a Git tag in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Create a note for `target` in `ref`, with `message` and `force` controlling the note contents and replacement behavior, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const refName = normalizeGitNotesRefName(params.ref) ?? "commits";
          const refPath = buildGitNotesRefPath(refName);
          const target = normalizeOptionalText(params.target) ?? "HEAD";
          const message = params.message.trim();
          if (!message) {
            throw new Error("Note message cannot be blank.");
          }

          await runGitCommand(
            scope.worktreePathContext,
            ["check-ref-format", refPath],
            typeof signal === "undefined" ? undefined : { signal },
          );

          const resolvedTargetHash = await resolveGitRevision(
            scope.worktreePathContext,
            target,
            signal,
          );
          const previousNoteText = await readGitNoteText(
            scope.worktreePathContext,
            resolvedTargetHash,
            refName,
            signal,
          );
          if (previousNoteText !== null && params.force !== true) {
            throw new Error(
              `A note already exists for ${target} in ${refPath}. Use force to replace it.`,
            );
          }

          const args = ["notes", "--ref", refName, "add"];
          if (params.force === true) {
            args.push("--force");
          }
          args.push("-m", message, resolvedTargetHash);

          const noteOutput = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const noteText = await readGitNoteText(
            scope.worktreePathContext,
            resolvedTargetHash,
            refName,
            signal,
          );
          if (noteText === null) {
            throw new Error("Unable to read the created note.");
          }

          const noteLines = splitTextLines(noteText);
          const created = previousNoteText === null;
          return textToolResult(
            [
              `Added note to ${target} in ${scope.worktreePathContext}.`,
              `Ref: ${refPath}`,
              `Target: ${target} -> ${resolvedTargetHash}`,
              `Mode: ${created ? "created" : "replaced"}`,
              `Note lines: ${noteLines.length}`,
              noteLines.length > 0
                ? ["Note", noteLines.join("\n")].join("\n\n")
                : "Note\n\n- none",
            ].join("\n\n"),
            {
              created,
              force: params.force === true,
              message,
              noteOutput,
              noteText,
              previousNoteText,
              refName,
              refPath,
              resolvedTargetHash,
              target,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Notes",
        name: "git_notes",
        parameters: GitNotesToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitNotesToolParameters>(args, [
            "force",
          ]),
        promptGuidelines: [
          "Use this to attach a short note to a commit or object inside the current repository without using bash.",
        ],
        promptSnippet: "Create a Git note in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Create a commit with `message`, `all`, `allowEmpty`, and `amend` controlling how the new commit is created, without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const message = params.message.trim();
          if (!message) {
            throw new Error("Commit message cannot be blank.");
          }

          const args = ["commit"];
          if (params.all === true) {
            args.push("--all");
          }
          if (params.amend === true) {
            args.push("--amend");
          }
          if (params.allowEmpty === true) {
            args.push("--allow-empty");
          }
          args.push("-m", message);

          const commitOutput = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const { history } = await readGitHistoryFirstPage(
            0,
            scope.worktreePathContext,
            1,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const latestCommit = history.entries[0] ?? null;
          if (!latestCommit) {
            throw new Error("Unable to read the latest commit after commit.");
          }

          return textToolResult(
            [
              `Committed changes in ${scope.worktreePathContext}.`,
              `Branch: ${history.branch ?? "unknown"}`,
              `Commit: ${formatCommitSummary(latestCommit)}`,
            ].join("\n"),
            {
              all: params.all === true,
              allowEmpty: params.allowEmpty === true,
              amend: params.amend === true,
              branch: history.branch,
              commit: latestCommit,
              commandOutput: commitOutput,
              message,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Commit",
        name: "git_commit",
        parameters: GitCommitToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCommitToolParameters>(args, [
            "all",
            "allowEmpty",
            "amend",
          ]),
        promptGuidelines: [
          "Use this to create a commit after the desired paths have been staged.",
        ],
        promptSnippet: "Create a Git commit in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Switch to `branchName`, with `create` and `startPoint` creating a new branch when requested, all within the current worktree.",
        execute: async (_toolCallId, params, signal) => {
          const branchName = params.branchName.trim();
          if (!branchName) {
            throw new Error("Branch name cannot be blank.");
          }
          if (params.startPoint && params.create !== true) {
            throw new Error(
              "startPoint can only be provided when creating a new branch.",
            );
          }

          await runGitCommand(
            scope.worktreePathContext,
            ["check-ref-format", "--branch", branchName],
            typeof signal === "undefined" ? undefined : { signal },
          );

          const args = ["switch"];
          if (params.create === true) {
            args.push("--create", branchName);
            if (params.startPoint) {
              args.push(params.startPoint.trim());
            }
          } else {
            args.push(branchName);
          }

          const switchOutput = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const currentBranch = await runGitCommand(
            scope.worktreePathContext,
            ["branch", "--show-current"],
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              params.create === true
                ? `Created and switched to branch ${branchName}.`
                : `Switched to branch ${branchName}.`,
              `Current branch: ${currentBranch || branchName}`,
            ].join("\n"),
            {
              branchName,
              create: params.create === true,
              currentBranch: currentBranch || null,
              startPoint: params.startPoint?.trim() ?? null,
              switchOutput,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Switch",
        name: "git_switch",
        parameters: GitSwitchToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitSwitchToolParameters>(args, [
            "create",
          ]),
        promptGuidelines: [
          "Use this to move the worktree onto a specific branch, or create a new branch and switch to it.",
        ],
        promptSnippet: "Switch the current Git worktree to a branch",
      }),
    ),
  ];
}
