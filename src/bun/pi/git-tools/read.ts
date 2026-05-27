/**
 * @file src/bun/pi/git-tools/read.ts
 * @description Pi-native Git read-only tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  normalizeGitHistoryPageLimit,
  readGitCommitDiffResult,
  readGitHistoryFirstPage,
  readGitHistoryPageEntries,
  readGitHistorySummary,
  readWorktreeSnapshot,
  runGitCommand,
} from "../../git";
import type {
  RpcGitHistoryEntry,
  RpcWorktreeChange,
  RpcWorktreeChangeStatus,
} from "../../rpc-schema";
import {
  buildGitNotesRefPath,
  formatGitNoteRefEntry,
  normalizeGitNotesRefName,
  readGitNoteRefListing,
  readGitNoteText,
} from "./notes";
import {
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";
import { formatGitTagEntry, readGitTagListing } from "./tags";

const GitStatusToolParameters = Type.Object({
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of status lines to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitDiffToolParameters = Type.Object({
  maxItems: Type.Optional(
    Type.Integer({
      description:
        "Maximum number of change, diff, and status lines to include.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitLogToolParameters = Type.Object({
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum number of commit entries to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  offset: Type.Optional(
    Type.Integer({
      description:
        "Number of commit entries to skip before collecting results.",
      minimum: 0,
      maximum: 100_000,
    }),
  ),
});

const GitBranchToolParameters = Type.Object({
  maxBranches: Type.Optional(
    Type.Integer({
      description: "Maximum number of local branches to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitTagListToolParameters = Type.Object({
  maxTags: Type.Optional(
    Type.Integer({
      description: "Maximum number of local tags to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitNotesListToolParameters = Type.Object({
  maxRefs: Type.Optional(
    Type.Integer({
      description: "Maximum number of local notes refs to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitNotesShowToolParameters = Type.Object({
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of note lines to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  ref: Type.Optional(
    Type.String({
      description: "Notes ref to read from.",
      minLength: 1,
    }),
  ),
  target: Type.Optional(
    Type.String({
      description: "Commit-ish or other object to inspect.",
      minLength: 1,
    }),
  ),
});

const GitShowToolParameters = Type.Object({
  commitHash: Type.String({
    description: "Commit hash, ref, or other commit-ish to inspect.",
    minLength: 1,
  }),
  maxDiffLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of diff lines to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

const GitStashListToolParameters = Type.Object({
  maxStashes: Type.Optional(
    Type.Integer({
      description: "Maximum number of stash entries to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
});

function normalizePreviewLimit(value: unknown, fallback: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return fallback;
  }

  return Math.max(1, Math.min(2_000, value));
}

function splitStatusOutput(raw: string): {
  branchLine: string | null;
  fileLines: string[];
} {
  const lines = raw.trimEnd().split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return {
      branchLine: null,
      fileLines: [],
    };
  }

  if (lines[0]?.startsWith("##")) {
    return {
      branchLine: lines[0],
      fileLines: lines.slice(1),
    };
  }

  return {
    branchLine: null,
    fileLines: lines,
  };
}

function truncateLines(
  lines: string[],
  maxLines: number,
): {
  shownLines: string[];
  shownLineCount: number;
  totalLineCount: number;
  truncated: boolean;
} {
  const totalLineCount = lines.length;
  const shownLines = lines.slice(0, maxLines);
  return {
    shownLines,
    shownLineCount: shownLines.length,
    totalLineCount,
    truncated: totalLineCount > shownLines.length,
  };
}

function formatWorktreeChange(change: RpcWorktreeChange): string {
  const statuses = [change.stagedStatus, change.unstagedStatus].filter(
    (status): status is RpcWorktreeChangeStatus => status !== null,
  );
  const statusText = statuses.length > 0 ? statuses.join(" / ") : "clean";
  const pathText =
    change.previousPath && change.previousPath !== change.path
      ? `${change.previousPath} -> ${change.path}`
      : change.path;
  return `${statusText} ${pathText}`;
}

function summarizeTruncation(
  changeCount: number,
  shownChangeCount: number,
  diffLineCount: number,
  shownDiffLineCount: number,
  fileCount: number,
  shownFileCount: number,
): string | null {
  const parts: string[] = [];
  if (changeCount > shownChangeCount) {
    parts.push(`${changeCount - shownChangeCount} change(s)`);
  }
  if (diffLineCount > shownDiffLineCount) {
    parts.push(`${diffLineCount - shownDiffLineCount} diff line(s)`);
  }
  if (fileCount > shownFileCount) {
    parts.push(`${fileCount - shownFileCount} status line(s)`);
  }

  return parts.length > 0 ? parts.join(", ") : null;
}

function normalizeHistoryOffset(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value < 0
  ) {
    return 0;
  }

  return Math.max(0, value);
}

function formatGitHistoryEntry(entry: RpcGitHistoryEntry): string {
  return `${entry.shortHash} ${entry.subject} — ${entry.authorName} @ ${entry.committedAt}`;
}

type GitBranchEntry = {
  current: boolean;
  hash: string;
  name: string;
  upstream: string | null;
};

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.replace(/\r\n/g, "\n").split("\n");
}

type GitStashEntry = {
  committedAt: string | null;
  hash: string;
  ref: string;
  subject: string;
};

function parseGitStashListing(raw: string): GitStashEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: GitStashEntry[] = [];
  for (const line of splitTextLines(raw)) {
    if (!line.trim()) {
      continue;
    }

    const [ref = "", hash = "", subject = "", committedAt = ""] =
      line.split("\u001f");
    if (!ref) {
      continue;
    }

    entries.push({
      committedAt: committedAt || null,
      hash: hash || "unknown",
      ref,
      subject: subject || "unknown",
    });
  }

  return entries;
}

function formatGitStashEntry(entry: GitStashEntry): string {
  return `${entry.ref} ${entry.hash} ${entry.subject}${
    entry.committedAt ? ` @ ${entry.committedAt}` : ""
  }`;
}

function parseGitBranchListing(raw: string): GitBranchEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const branches: GitBranchEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    const [currentMarker = "", name = "", hash = "", upstream = ""] =
      line.split("\t");
    if (!name) {
      continue;
    }

    branches.push({
      current: currentMarker.trim() === "*",
      hash: hash || "unknown",
      name,
      upstream: upstream || null,
    });
  }

  return branches;
}

function formatGitBranchEntry(entry: GitBranchEntry): string {
  const marker = entry.current ? "*" : " ";
  const upstreamText = entry.upstream ? ` -> ${entry.upstream}` : "";
  return `${marker} ${entry.name} ${entry.hash}${upstreamText}`;
}

export function createPiGitReadTools(
  scope: PiGitToolScope,
  host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect the current Git worktree status with `maxLines` bounding the returned status lines. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const rawStatus = await host.getStatus(signal);
          const { branchLine, fileLines } = splitStatusOutput(rawStatus);
          const maxLines =
            typeof params.maxLines === "number"
              ? normalizePreviewLimit(params.maxLines, 200)
              : 200;
          const allLines = [...(branchLine ? [branchLine] : []), ...fileLines];
          const truncated = truncateLines(allLines, maxLines);
          const summaryLine = truncated.truncated
            ? `Showing ${truncated.shownLineCount} of ${truncated.totalLineCount} status line(s).`
            : `Showing ${truncated.shownLineCount} status line(s).`;
          const textLines = [
            `Git status for ${scope.worktreePathContext}`,
            branchLine
              ? `Branch: ${branchLine.slice(3).trim() || "unknown"}`
              : "Branch: unknown",
            summaryLine,
            truncated.shownLines.length > 0
              ? truncated.shownLines.join("\n")
              : "Working tree is clean.",
          ];
          if (truncated.truncated) {
            textLines.push(
              `... truncated ${truncated.totalLineCount - truncated.shownLineCount} additional line(s).`,
            );
          }
          return textToolResult(textLines.join("\n\n"), {
            branchLine,
            shownLineCount: truncated.shownLineCount,
            statusLines: truncated.shownLines,
            totalLineCount: truncated.totalLineCount,
            truncated: truncated.truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Status",
        name: "git_status",
        parameters: GitStatusToolParameters,
        promptGuidelines: [
          "Use this to inspect the current repository state before staging, committing, or branching.",
        ],
        promptSnippet: "Inspect the current Git status for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect the current worktree diff with `maxItems` bounding the change, diff, and status lines. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const snapshot = await readWorktreeSnapshot(
            scope.worktreePathContext,
            signal ? { signal } : undefined,
          );
          const maxItems =
            typeof params.maxItems === "number"
              ? normalizePreviewLimit(params.maxItems, 200)
              : 200;
          const shownChanges = snapshot.changes.slice(0, maxItems);
          const shownDiffLines = snapshot.diff.slice(0, maxItems);
          const shownFileLines = snapshot.files.slice(0, maxItems);
          const truncated = summarizeTruncation(
            snapshot.changes.length,
            shownChanges.length,
            snapshot.diff.length,
            shownDiffLines.length,
            snapshot.files.length,
            shownFileLines.length,
          );

          const textSections = [
            `Git diff snapshot for ${scope.worktreePathContext}`,
            `Summary: ${snapshot.changes.length} change(s), ${snapshot.diff.length} diff line(s), and ${snapshot.files.length} status line(s).`,
            shownChanges.length > 0
              ? [
                  "Changes",
                  shownChanges
                    .map((change) => `- ${formatWorktreeChange(change)}`)
                    .join("\n"),
                ].join("\n\n")
              : "Changes\n\n- none",
            shownDiffLines.length > 0
              ? ["Diff", shownDiffLines.join("\n")].join("\n\n")
              : "Diff\n\n- none",
            shownFileLines.length > 0
              ? ["Status lines", shownFileLines.join("\n")].join("\n\n")
              : "Status lines\n\n- none",
          ];
          if (truncated) {
            textSections.push(`Truncated: ${truncated}.`);
          }
          return textToolResult(textSections.join("\n\n"), {
            changeCount: snapshot.changes.length,
            changes: shownChanges,
            diffLineCount: snapshot.diff.length,
            diffLines: shownDiffLines,
            fileCount: snapshot.files.length,
            fileLines: shownFileLines,
            shownChangeCount: shownChanges.length,
            shownDiffLineCount: shownDiffLines.length,
            shownFileCount: shownFileLines.length,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Diff",
        name: "git_diff",
        parameters: GitDiffToolParameters,
        promptGuidelines: [
          "Use this to inspect the current worktree diff before reading history or making a commit.",
        ],
        promptSnippet: "Inspect the current Git diff for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect commit history with `limit` and `offset` controlling pagination. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const limit = normalizeGitHistoryPageLimit(params.limit);
          const offset = normalizeHistoryOffset(params.offset);
          const gitOptions = signal ? { signal } : undefined;

          const loadGitHistory = async () => {
            if (offset === 0) {
              const { history, summary } = await readGitHistoryFirstPage(
                0,
                scope.worktreePathContext,
                limit,
                gitOptions,
              );
              return { history, summary };
            }

            const [summaryResult, entriesResult] = await Promise.all([
              readGitHistorySummary(0, scope.worktreePathContext, gitOptions),
              readGitHistoryPageEntries(
                scope.worktreePathContext,
                offset,
                limit,
                gitOptions,
              ),
            ]);

            return {
              history: {
                ...summaryResult.history,
                entries: entriesResult.entries,
                limit,
                nextOffset: entriesResult.nextOffset,
              },
              summary: summaryResult.history,
            };
          };

          const { history, summary } = await loadGitHistory();
          const shownEntries = history.entries;
          const textSections = [
            `Git log for ${scope.worktreePathContext}`,
            `Branch: ${summary.branch ?? "unknown"}`,
            `Head: ${summary.headShortHash ?? summary.headHash ?? "unknown"}`,
            `Showing ${shownEntries.length} commit(s) from offset ${offset} with limit ${limit}.`,
            shownEntries.length > 0
              ? [
                  "Commits",
                  shownEntries
                    .map((entry) => `- ${formatGitHistoryEntry(entry)}`)
                    .join("\n"),
                ].join("\n\n")
              : "Commits\n\n- none",
          ];
          if (history.nextOffset !== null) {
            textSections.push(
              `More commits are available starting at offset ${history.nextOffset}.`,
            );
          }
          return textToolResult(textSections.join("\n\n"), {
            branch: summary.branch,
            entryCount: shownEntries.length,
            entries: shownEntries,
            headHash: summary.headHash,
            headShortHash: summary.headShortHash,
            limit,
            nextOffset: history.nextOffset,
            offset,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Log",
        name: "git_log",
        parameters: GitLogToolParameters,
        promptGuidelines: [
          "Use this to inspect history before showing a specific commit or writing a commit message.",
        ],
        promptSnippet: "Inspect the current Git log for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "List local branches with `maxBranches` bounding the returned branches and the checked-out branch highlighted.",
        execute: async (_toolCallId, params, signal) => {
          const maxBranches =
            typeof params.maxBranches === "number"
              ? normalizePreviewLimit(params.maxBranches, 200)
              : 200;
          const rawBranches = await runGitCommand(
            scope.worktreePathContext,
            [
              "for-each-ref",
              "--sort=refname",
              "--format=%(HEAD)\t%(refname:short)\t%(objectname:short)\t%(upstream:short)",
              "refs/heads",
            ],
            signal ? { signal } : undefined,
          );
          const branches = parseGitBranchListing(rawBranches);
          const shownBranches = branches.slice(0, maxBranches);
          const currentBranch =
            branches.find((branch) => branch.current)?.name ?? null;
          const truncatedLineCount =
            branches.length > shownBranches.length
              ? branches.length - shownBranches.length
              : null;
          const textSections = [
            `Git branches for ${scope.worktreePathContext}`,
            `Current branch: ${currentBranch ?? "detached HEAD"}`,
            `Showing ${shownBranches.length} branch(es) from ${branches.length} total.`,
            shownBranches.length > 0
              ? [
                  "Branches",
                  shownBranches
                    .map((branch) => formatGitBranchEntry(branch))
                    .join("\n"),
                ].join("\n\n")
              : "Branches\n\n- none",
          ];
          if (truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncatedLineCount} additional branch(es) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            branchCount: branches.length,
            branches: shownBranches,
            currentBranch,
            shownBranchCount: shownBranches.length,
            truncated: truncatedLineCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Branch",
        name: "git_branch",
        parameters: GitBranchToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitBranchToolParameters>(
            args,
            [],
            ["maxBranches"],
          ),
        promptGuidelines: [
          "Use this to inspect which local branches exist and which branch is currently checked out.",
        ],
        promptSnippet: "List local Git branches for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect the local stash list with `maxStashes` bounding the returned entries. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const maxStashes =
            typeof params.maxStashes === "number"
              ? normalizePreviewLimit(params.maxStashes, 20)
              : 20;
          const rawStashes = await runGitCommand(
            scope.worktreePathContext,
            [
              "stash",
              "list",
              "-n",
              String(maxStashes),
              "--format=%gd%x1f%H%x1f%gs%x1f%cI",
            ],
            signal ? { signal } : undefined,
          );
          const stashes = parseGitStashListing(rawStashes);
          const textSections = [
            `Git stash list for ${scope.worktreePathContext}`,
            `Showing ${stashes.length} stash entr${
              stashes.length === 1 ? "y" : "ies"
            } with limit ${maxStashes}.`,
            stashes.length > 0
              ? [
                  "Stashes",
                  stashes
                    .map((stash) => `- ${formatGitStashEntry(stash)}`)
                    .join("\n"),
                ].join("\n\n")
              : "No stash entries found.",
          ];

          return textToolResult(textSections.join("\n\n"), {
            entryCount: stashes.length,
            entries: stashes,
            maxStashes,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Stash List",
        name: "git_stash_list",
        parameters: GitStashListToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitStashListToolParameters>(
            args,
            [],
            ["maxStashes"],
          ),
        promptGuidelines: [
          "Use this to inspect the current local stash stack before applying, dropping, or creating a new stash.",
        ],
        promptSnippet: "Inspect the Git stash stack for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect the local tag list with `maxTags` bounding the returned entries. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const maxTags =
            typeof params.maxTags === "number"
              ? normalizePreviewLimit(params.maxTags, 200)
              : 200;
          const tags = await readGitTagListing(
            scope.worktreePathContext,
            maxTags + 1,
            signal,
          );
          const shownTags = tags.slice(0, maxTags);
          const truncated = tags.length > shownTags.length ? true : null;
          const textSections = [
            `Git tags for ${scope.worktreePathContext}`,
            `Showing ${shownTags.length} tag(s) with limit ${maxTags}.`,
            shownTags.length > 0
              ? [
                  "Tags",
                  shownTags
                    .map((tag) => `- ${formatGitTagEntry(tag)}`)
                    .join("\n"),
                ].join("\n\n")
              : "No tags found.",
          ];
          if (truncated) {
            textSections.push("Truncated: additional tag(s) not shown.");
          }

          return textToolResult(textSections.join("\n\n"), {
            shownTagCount: shownTags.length,
            tagCount: shownTags.length,
            tags: shownTags,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Tag List",
        name: "git_tag_list",
        parameters: GitTagListToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitTagListToolParameters>(
            args,
            [],
            ["maxTags"],
          ),
        promptGuidelines: [
          "Use this to inspect the local tag stack before creating, moving, or referencing a tag.",
        ],
        promptSnippet: "Inspect the Git tag list for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect notes refs with `maxRefs` bounding the returned refs. This tool reads the active repository only and never shells out through bash.",
        execute: async (_toolCallId, params, signal) => {
          const maxRefs =
            typeof params.maxRefs === "number"
              ? normalizePreviewLimit(params.maxRefs, 200)
              : 200;
          const refs = await readGitNoteRefListing(
            scope.worktreePathContext,
            maxRefs + 1,
            signal,
          );
          const shownRefs = refs.slice(0, maxRefs);
          const truncated =
            refs.length > shownRefs.length
              ? refs.length - shownRefs.length
              : null;
          const textSections = [
            `Git notes refs for ${scope.worktreePathContext}`,
            `Showing ${shownRefs.length} note ref(s) with limit ${maxRefs}.`,
            shownRefs.length > 0
              ? [
                  "Notes refs",
                  shownRefs
                    .map((ref) => `- ${formatGitNoteRefEntry(ref)}`)
                    .join("\n"),
                ].join("\n\n")
              : "Notes refs\n\n- none",
          ];
          if (truncated !== null) {
            textSections.push(
              `Truncated: ${truncated} additional note ref(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            noteRefCount: refs.length,
            noteRefs: shownRefs,
            shownNoteRefCount: shownRefs.length,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Notes List",
        name: "git_notes_list",
        parameters: GitNotesListToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitNotesListToolParameters>(
            args,
            [],
            ["maxRefs"],
          ),
        promptGuidelines: [
          "Use this to inspect which note refs exist before reading or writing notes on commits or other objects.",
        ],
        promptSnippet: "Inspect the Git notes refs for the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect a note with `ref`, `target`, and `maxLines` controlling which note is shown and how much of it is returned.",
        execute: async (_toolCallId, params, signal) => {
          const refName = normalizeGitNotesRefName(params.ref) ?? "commits";
          const refPath = buildGitNotesRefPath(refName);
          const targetInput =
            typeof params.target === "string" ? params.target.trim() : "";
          const target = targetInput.length > 0 ? targetInput : "HEAD";
          const resolvedTargetHash = await runGitCommand(
            scope.worktreePathContext,
            ["rev-parse", "--verify", target],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const noteText = await readGitNoteText(
            scope.worktreePathContext,
            resolvedTargetHash,
            refName,
            signal,
          );
          if (noteText === null) {
            return textToolResult(
              `No note found for ${target} in ${refPath}.`,
              {
                found: false,
                lineCount: 0,
                lines: [],
                refName,
                refPath,
                resolvedTargetHash,
                target,
                truncated: null,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const maxLines =
            typeof params.maxLines === "number"
              ? normalizePreviewLimit(params.maxLines, 200)
              : 200;
          const lines = splitTextLines(noteText);
          const shownLines = lines.slice(0, maxLines);
          const truncatedLineCount =
            lines.length > shownLines.length
              ? lines.length - shownLines.length
              : null;
          const textSections = [
            `Git note for ${scope.worktreePathContext}`,
            `Ref: ${refPath}`,
            `Target: ${target} -> ${resolvedTargetHash}`,
            `Showing ${shownLines.length} of ${lines.length} note line(s).`,
            shownLines.length > 0
              ? ["Note", shownLines.join("\n")].join("\n\n")
              : "Note\n\n- none",
          ];
          if (truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncatedLineCount} additional note line(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            found: true,
            lineCount: lines.length,
            lines: shownLines,
            refName,
            refPath,
            resolvedTargetHash,
            target,
            truncated: truncatedLineCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Notes Show",
        name: "git_notes_show",
        parameters: GitNotesShowToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitNotesShowToolParameters>(
            args,
            [],
            ["maxLines"],
          ),
        promptGuidelines: [
          "Use this to inspect an existing note before deciding whether to replace or extend it.",
        ],
        promptSnippet: "Show a Git note for an object in the worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect `commitHash` with `maxDiffLines` bounding the returned diff snapshot without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const maxDiffLines =
            typeof params.maxDiffLines === "number"
              ? normalizePreviewLimit(params.maxDiffLines, 200)
              : 200;
          const commitDiff = await readGitCommitDiffResult(
            0,
            scope.worktreePathContext,
            params.commitHash,
            signal ? { signal } : undefined,
          );
          const diffLines = splitTextLines(commitDiff.diffText);
          const shownDiffLines = diffLines.slice(0, maxDiffLines);
          const truncatedLineCount =
            diffLines.length > shownDiffLines.length
              ? diffLines.length - shownDiffLines.length
              : null;
          const commitSummary = formatGitHistoryEntry(commitDiff.commit);
          const textSections = [
            `Git show for ${scope.worktreePathContext}`,
            `Commit: ${commitSummary}`,
            `Hash: ${commitDiff.commit.hash}`,
            `Showing ${shownDiffLines.length} of ${diffLines.length} diff line(s).`,
            shownDiffLines.length > 0
              ? ["Diff", shownDiffLines.join("\n")].join("\n\n")
              : "Diff\n\n- none",
          ];
          if (truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncatedLineCount} additional diff line(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            commit: commitDiff.commit,
            commitHash: params.commitHash,
            diffLineCount: diffLines.length,
            diffLines: shownDiffLines,
            maxDiffLines,
            shownDiffLineCount: shownDiffLines.length,
            truncated: truncatedLineCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Show",
        name: "git_show",
        parameters: GitShowToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitShowToolParameters>(
            args,
            [],
            ["maxDiffLines"],
          ),
        promptGuidelines: [
          "Use this to inspect the details of a specific commit before reading or discussing its patch.",
        ],
        promptSnippet: "Show a specific Git commit from the worktree",
      }),
    ),
  ];
}
