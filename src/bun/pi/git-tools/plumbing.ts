/**
 * @file src/bun/pi/git-tools/plumbing.ts
 * @description Pi-native Git plumbing and ref-resolution tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { runGitCommand } from "../../git";
import {
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

const GitRevParseToolParameters = Type.Object({
  revisions: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Revision expressions to resolve.",
      minItems: 1,
      maxItems: 20,
    },
  ),
});

const GitMergeBaseToolParameters = Type.Object({
  all: Type.Optional(
    Type.Boolean({
      description:
        "Return every merge base instead of only the best common ancestor.",
    }),
  ),
  leftRevision: Type.String({
    description: "Left revision to compare.",
    minLength: 1,
  }),
  rightRevision: Type.String({
    description: "Right revision to compare.",
    minLength: 1,
  }),
});

const GitRangeDiffToolParameters = Type.Object({
  baseRevision: Type.String({
    description: "Common base revision for the old and new series.",
    minLength: 1,
  }),
  oldTipRevision: Type.String({
    description: "Tip revision for the old series.",
    minLength: 1,
  }),
  newTipRevision: Type.String({
    description: "Tip revision for the new series.",
    minLength: 1,
  }),
  creationFactor: Type.Optional(
    Type.Integer({
      description:
        "Percentage by which creation is weighted when comparing the two series.",
      minimum: 0,
      maximum: 100,
    }),
  ),
  leftOnly: Type.Optional(
    Type.Boolean({
      description: "Show only output related to the first range.",
    }),
  ),
  rightOnly: Type.Optional(
    Type.Boolean({
      description: "Show only output related to the second range.",
    }),
  ),
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of range-diff output lines to show.",
      minimum: 1,
      maximum: 500,
    }),
  ),
});

const GitCheckRefFormatToolParameters = Type.Object({
  branch: Type.Optional(
    Type.Boolean({
      description: "Validate branch-style names instead of raw refnames.",
    }),
  ),
  names: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Ref names or branch names to validate.",
      minItems: 1,
      maxItems: 20,
    },
  ),
});

const GitCountObjectsToolParameters = Type.Object({});

function normalizeRevisionText(
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

function formatRevisionResolution(input: string, output: string): string {
  return `- ${input} -> ${output}`;
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

function normalizeRevisionList(values: readonly string[]): string[] {
  return values
    .map((value) => normalizeRevisionText(value))
    .filter((value): value is string => value !== null);
}

type GitCheckRefFormatResult = {
  error: string | null;
  input: string;
  normalized: string | null;
  valid: boolean;
};

type GitCountObjectsStats = {
  count: number | null;
  garbage: number | null;
  inPack: number | null;
  packs: number | null;
  prunePackable: number | null;
  size: number | null;
  sizeGarbage: number | null;
  sizePack: number | null;
};

function normalizeNameList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

type GitRangeDiffTruncation = {
  shownLines: string[];
  totalLineCount: number;
  truncatedLineCount: number | null;
};

function normalizeLineLimit(value: unknown, fallback: number): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !Number.isFinite(value) ||
    value <= 0
  ) {
    return fallback;
  }

  return Math.max(1, Math.min(500, value));
}

function truncateTextLines(
  lines: string[],
  maxLines: number,
): GitRangeDiffTruncation {
  const shownLines = lines.slice(0, maxLines);
  const totalLineCount = lines.length;
  return {
    shownLines,
    totalLineCount,
    truncatedLineCount:
      totalLineCount > shownLines.length
        ? totalLineCount - shownLines.length
        : null,
  };
}

function formatRangeDiffOptions(value: {
  creationFactor: number | null;
  leftOnly: boolean;
  rightOnly: boolean;
}): string {
  const parts = [
    value.creationFactor === null
      ? null
      : `creation-factor=${value.creationFactor}`,
    value.leftOnly ? "left-only" : null,
    value.rightOnly ? "right-only" : null,
  ].filter((part): part is string => typeof part === "string");
  return parts.length > 0 ? parts.join(", ") : "none";
}

function formatCheckRefFormatResult(result: GitCheckRefFormatResult): string {
  return result.valid
    ? `- ${result.input} -> ${result.normalized ?? "ok"}`
    : `- ${result.input} -> ERROR: ${result.error}`;
}

function parseCountObjectsOutput(raw: string): GitCountObjectsStats {
  const stats: GitCountObjectsStats = {
    count: null,
    garbage: null,
    inPack: null,
    packs: null,
    prunePackable: null,
    size: null,
    sizeGarbage: null,
    sizePack: null,
  };

  for (const line of splitTextLines(raw)) {
    const [keyPart = "", valuePart = ""] = line.split(":", 2);
    const key = keyPart.trim();
    const value = valuePart.trim();
    if (!key || !value) {
      continue;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (!Number.isFinite(parsedValue)) {
      continue;
    }

    if (key === "count") {
      stats.count = parsedValue;
    } else if (key === "size") {
      stats.size = parsedValue;
    } else if (key === "in-pack") {
      stats.inPack = parsedValue;
    } else if (key === "packs") {
      stats.packs = parsedValue;
    } else if (key === "size-pack") {
      stats.sizePack = parsedValue;
    } else if (key === "prune-packable") {
      stats.prunePackable = parsedValue;
    } else if (key === "garbage") {
      stats.garbage = parsedValue;
    } else if (key === "size-garbage") {
      stats.sizeGarbage = parsedValue;
    }
  }

  return stats;
}

function formatCountObjectsStats(stats: GitCountObjectsStats): string {
  const countText = stats.count === null ? "unknown" : String(stats.count);
  const sizeText = stats.size === null ? "unknown" : `${stats.size} KiB`;
  const inPackText = stats.inPack === null ? "unknown" : String(stats.inPack);
  const packsText = stats.packs === null ? "unknown" : String(stats.packs);
  const sizePackText =
    stats.sizePack === null ? "unknown" : `${stats.sizePack} KiB`;
  const prunePackableText =
    stats.prunePackable === null ? "unknown" : String(stats.prunePackable);
  const garbageText =
    stats.garbage === null ? "unknown" : String(stats.garbage);
  const sizeGarbageText =
    stats.sizeGarbage === null ? "unknown" : `${stats.sizeGarbage} KiB`;

  return [
    `count: ${countText}`,
    `size: ${sizeText}`,
    `in-pack: ${inPackText}`,
    `packs: ${packsText}`,
    `size-pack: ${sizePackText}`,
    `prune-packable: ${prunePackableText}`,
    `garbage: ${garbageText}`,
    `size-garbage: ${sizeGarbageText}`,
  ].join("\n");
}

function formatCountObjectsSummary(stats: GitCountObjectsStats): string {
  const countText = stats.count === null ? "unknown" : String(stats.count);
  const packText =
    stats.inPack === null || stats.packs === null
      ? "unknown"
      : `${stats.inPack} object(s) in ${stats.packs} pack(s)`;
  const garbageText =
    stats.garbage === null
      ? "unknown"
      : `${stats.garbage} loose garbage object(s)`;
  return `Loose objects: ${countText}; Packed objects: ${packText}; Garbage: ${garbageText}.`;
}

export function createPiGitPlumbingTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Resolve `revisions` to commit hashes inside the current worktree without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const revisions = normalizeRevisionList(params.revisions);
          if (revisions.length === 0) {
            throw new Error("At least one revision is required.");
          }

          const resolutions = await Promise.all(
            revisions.map(async (revision) => {
              try {
                const resolvedHash = await resolveGitRevision(
                  scope.worktreePathContext,
                  revision,
                  signal,
                );
                return {
                  error: null,
                  input: revision,
                  resolvedHash,
                };
              } catch (error) {
                return {
                  error: error instanceof Error ? error.message : String(error),
                  input: revision,
                  resolvedHash: null,
                };
              }
            }),
          );
          const resolvedCount = resolutions.filter(
            (result) => result.resolvedHash !== null,
          ).length;
          const failedCount = resolutions.length - resolvedCount;
          const textSections = [
            `Git rev-parse for ${scope.worktreePathContext}`,
            `Resolved ${resolvedCount} of ${resolutions.length} revision(s).`,
            resolutions.length > 0
              ? [
                  "Resolutions",
                  resolutions
                    .map((resolution) =>
                      resolution.resolvedHash
                        ? formatRevisionResolution(
                            resolution.input,
                            resolution.resolvedHash,
                          )
                        : `- ${resolution.input} -> ERROR: ${resolution.error}`,
                    )
                    .join("\n"),
                ].join("\n\n")
              : "Resolutions\n\n- none",
          ];
          if (failedCount > 0) {
            textSections.push(`Failed to resolve ${failedCount} revision(s).`);
          }

          return textToolResult(textSections.join("\n\n"), {
            failedCount,
            resultCount: resolutions.length,
            resolutions,
            resolvedCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Rev Parse",
        name: "git_rev_parse",
        parameters: GitRevParseToolParameters,
        promptGuidelines: [
          "Use this to resolve branch names, tags, HEAD expressions, or other revision syntax to concrete commit ids.",
        ],
        promptSnippet: "Resolve Git revisions in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Find the merge base for `leftRevision` and `rightRevision`, with `all` returning every merge base, inside the current worktree without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const leftRevision = normalizeRevisionText(params.leftRevision);
          if (!leftRevision) {
            throw new Error("Left revision cannot be blank.");
          }

          const rightRevision = normalizeRevisionText(params.rightRevision);
          if (!rightRevision) {
            throw new Error("Right revision cannot be blank.");
          }

          const resolvedLeftHash = await resolveGitRevision(
            scope.worktreePathContext,
            leftRevision,
            signal,
          );
          const resolvedRightHash = await resolveGitRevision(
            scope.worktreePathContext,
            rightRevision,
            signal,
          );
          const mergeBaseOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "merge-base",
              ...(params.all === true ? ["--all"] : []),
              resolvedLeftHash,
              resolvedRightHash,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const baseHashes = splitTextLines(mergeBaseOutput);
          const textSections = [
            `Git merge-base for ${scope.worktreePathContext}`,
            `Left: ${leftRevision} -> ${resolvedLeftHash}`,
            `Right: ${rightRevision} -> ${resolvedRightHash}`,
            `Showing ${baseHashes.length} merge base(s).`,
            baseHashes.length > 0
              ? [
                  "Merge bases",
                  baseHashes.map((hash) => `- ${hash}`).join("\n"),
                ].join("\n\n")
              : "Merge bases\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            all: params.all === true,
            baseCount: baseHashes.length,
            baseHashes,
            leftRevision,
            mergeBaseOutput,
            resolvedLeftHash,
            resolvedRightHash,
            rightRevision,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Merge Base",
        name: "git_merge_base",
        parameters: GitMergeBaseToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitMergeBaseToolParameters>(args, [
            "all",
          ]),
        promptGuidelines: [
          "Use this to find the best shared ancestor between two revisions before reasoning about ancestry or diffs.",
        ],
        promptSnippet: "Find the Git merge base for two revisions",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Compare `baseRevision`, `oldTipRevision`, and `newTipRevision` with `creationFactor`, `leftOnly`, `rightOnly`, and `maxLines` shaping the range-diff output inside the current worktree without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const baseRevision = normalizeRevisionText(params.baseRevision);
          if (!baseRevision) {
            throw new Error("Base revision cannot be blank.");
          }

          const oldTipRevision = normalizeRevisionText(params.oldTipRevision);
          if (!oldTipRevision) {
            throw new Error("Old tip revision cannot be blank.");
          }

          const newTipRevision = normalizeRevisionText(params.newTipRevision);
          if (!newTipRevision) {
            throw new Error("New tip revision cannot be blank.");
          }

          if (params.leftOnly === true && params.rightOnly === true) {
            throw new Error("leftOnly and rightOnly cannot both be true.");
          }

          const [resolvedBaseHash, resolvedOldTipHash, resolvedNewTipHash] =
            await Promise.all([
              resolveGitRevision(
                scope.worktreePathContext,
                baseRevision,
                signal,
              ),
              resolveGitRevision(
                scope.worktreePathContext,
                oldTipRevision,
                signal,
              ),
              resolveGitRevision(
                scope.worktreePathContext,
                newTipRevision,
                signal,
              ),
            ]);
          const rangeDiffOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "range-diff",
              "--no-color",
              ...(typeof params.creationFactor === "number"
                ? [`--creation-factor=${params.creationFactor}`]
                : []),
              ...(params.leftOnly === true ? ["--left-only"] : []),
              ...(params.rightOnly === true ? ["--right-only"] : []),
              resolvedBaseHash,
              resolvedOldTipHash,
              resolvedNewTipHash,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const rangeDiffLines = splitTextLines(rangeDiffOutput);
          const maxLines = normalizeLineLimit(params.maxLines, 200);
          const truncated = truncateTextLines(rangeDiffLines, maxLines);
          const optionsText = formatRangeDiffOptions({
            creationFactor:
              typeof params.creationFactor === "number"
                ? params.creationFactor
                : null,
            leftOnly: params.leftOnly === true,
            rightOnly: params.rightOnly === true,
          });
          const summaryLine =
            truncated.truncatedLineCount !== null
              ? `Showing ${truncated.shownLines.length} of ${truncated.totalLineCount} line(s).`
              : `Showing ${truncated.shownLines.length} line(s).`;
          const textSections = [
            `Git range-diff for ${scope.worktreePathContext}`,
            `Base: ${baseRevision} -> ${resolvedBaseHash}`,
            `Old tip: ${oldTipRevision} -> ${resolvedOldTipHash}`,
            `New tip: ${newTipRevision} -> ${resolvedNewTipHash}`,
            `Options: ${optionsText}`,
            summaryLine,
            truncated.shownLines.length > 0
              ? ["Range diff", truncated.shownLines.join("\n")].join("\n\n")
              : "Range diff\n\n- none",
          ];
          if (truncated.truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncated.truncatedLineCount} additional line(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            baseRevision,
            creationFactor:
              typeof params.creationFactor === "number"
                ? params.creationFactor
                : null,
            leftOnly: params.leftOnly === true,
            maxLines,
            newTipRevision,
            oldTipRevision,
            rangeDiffLines: truncated.shownLines,
            rangeDiffOutput,
            resolvedBaseHash,
            resolvedNewTipHash,
            resolvedOldTipHash,
            rightOnly: params.rightOnly === true,
            shownLineCount: truncated.shownLines.length,
            totalLineCount: truncated.totalLineCount,
            truncated: truncated.truncatedLineCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Range Diff",
        name: "git_range_diff",
        parameters: GitRangeDiffToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitRangeDiffToolParameters>(
            args,
            ["leftOnly", "rightOnly"],
            ["creationFactor", "maxLines"],
          ),
        promptGuidelines: [
          "Use this to compare two commit series that share a common base before rewriting or reviewing a patch stack.",
        ],
        promptSnippet: "Compare two Git commit series with range-diff",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Validate `names` as refs or branches, with `branch` switching between raw refname and branch-name validation inside the current worktree without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const branchMode = params.branch !== false;
          const names = normalizeNameList(params.names);
          const checks = await Promise.all(
            names.map(async (name) => {
              try {
                const normalized = await runGitCommand(
                  scope.worktreePathContext,
                  [
                    "check-ref-format",
                    ...(branchMode ? ["--branch"] : []),
                    name,
                  ],
                  typeof signal === "undefined" ? undefined : { signal },
                );
                return {
                  error: null,
                  input: name,
                  normalized: normalized.trim() || null,
                  valid: true,
                };
              } catch (error) {
                return {
                  error: error instanceof Error ? error.message : String(error),
                  input: name,
                  normalized: null,
                  valid: false,
                };
              }
            }),
          );
          const validCount = checks.filter((check) => check.valid).length;
          const invalidCount = checks.length - validCount;
          const textSections = [
            `Git check-ref-format for ${scope.worktreePathContext}`,
            `Mode: ${branchMode ? "branch" : "ref"}`,
            `Checked ${checks.length} name(s); ${validCount} valid, ${invalidCount} invalid.`,
            checks.length > 0
              ? [
                  "Results",
                  checks
                    .map((check) => formatCheckRefFormatResult(check))
                    .join("\n"),
                ].join("\n\n")
              : "Results\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            branch: branchMode,
            checkCount: checks.length,
            checks,
            invalidCount,
            validCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Check Ref Format",
        name: "git_check_ref_format",
        parameters: GitCheckRefFormatToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCheckRefFormatToolParameters>(
            args,
            ["branch"],
          ),
        promptGuidelines: [
          "Use this to validate branch names and ref names before creating them or writing references.",
        ],
        promptSnippet: "Check Git ref format in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Summarize repository object counts for the current worktree; this tool has no parameters and never uses bash.",
        execute: async (_toolCallId, _params, signal) => {
          const rawStats = await runGitCommand(
            scope.worktreePathContext,
            ["count-objects", "-v"],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const stats = parseCountObjectsOutput(rawStats);
          const textSections = [
            `Git count-objects for ${scope.worktreePathContext}`,
            formatCountObjectsSummary(stats),
            formatCountObjectsStats(stats),
          ];

          return textToolResult(textSections.join("\n\n"), {
            count: stats.count,
            garbage: stats.garbage,
            inPack: stats.inPack,
            packs: stats.packs,
            prunePackable: stats.prunePackable,
            rawOutput: rawStats,
            size: stats.size,
            sizeGarbage: stats.sizeGarbage,
            sizePack: stats.sizePack,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Count Objects",
        name: "git_count_objects",
        parameters: GitCountObjectsToolParameters,
        promptGuidelines: [
          "Use this to inspect how many loose and packed objects the repository currently has.",
        ],
        promptSnippet: "Count Git objects in the current worktree",
      }),
    ),
  ];
}
