/**
 * @file src/bun/pi/git-tools/low-level.ts
 * @description Pi-native Git low-level helper tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { runGitCommandResult } from "../../git";
import {
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

const GIT_FOR_EACH_REF_FIELD_SEPARATOR = "\u001f";
const GIT_FOR_EACH_REF_FORMAT = [
  "%(refname)",
  "%(refname:short)",
  "%(objectname)",
  "%(objecttype)",
  "%(creatordate:iso-strict)",
  "%(subject)",
  "%(upstream:short)",
  "%(symref)",
].join(GIT_FOR_EACH_REF_FIELD_SEPARATOR);

export type GitForEachRefEntry = {
  createdAt: string | null;
  objectHash: string;
  objectType: string;
  ref: string;
  shortRef: string;
  subject: string | null;
  symrefTarget: string | null;
  upstream: string | null;
};

export type GitCherryEntry = {
  ahead: boolean;
  commitHash: string;
  subject: string | null;
};

export type GitFsckMessage = {
  category: string;
  text: string;
};

const GitForEachRefToolParameters = Type.Object({
  containsRevision: Type.Optional(
    Type.String({
      description: "Only include refs that contain this revision.",
      minLength: 1,
    }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({
      description: "Match patterns and sort keys case-insensitively.",
    }),
  ),
  includeRootRefs: Type.Optional(
    Type.Boolean({
      description: "Include HEAD and other root refs in the listing.",
    }),
  ),
  mergedRevision: Type.Optional(
    Type.String({
      description: "Only include refs merged into this revision.",
      minLength: 1,
    }),
  ),
  maxRefs: Type.Optional(
    Type.Integer({
      description: "Maximum number of refs to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  noContainsRevision: Type.Optional(
    Type.String({
      description: "Exclude refs that contain this revision.",
      minLength: 1,
    }),
  ),
  noMergedRevision: Type.Optional(
    Type.String({
      description: "Exclude refs merged into this revision.",
      minLength: 1,
    }),
  ),
  patterns: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Ref patterns to match.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  pointsAt: Type.Optional(
    Type.String({
      description: "Only include refs pointing at this object.",
      minLength: 1,
    }),
  ),
  sort: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Sort keys to apply in order.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
});

const GitCherryToolParameters = Type.Object({
  abbrevDigits: Type.Optional(
    Type.Integer({
      description: "Number of abbreviated hash digits to display.",
      minimum: 4,
      maximum: 40,
    }),
  ),
  headRevision: Type.Optional(
    Type.String({
      description: "Head revision to compare against the upstream revision.",
      minLength: 1,
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      description: "Maximum number of commits to compare.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  upstreamRevision: Type.String({
    description: "Upstream revision to compare against.",
    minLength: 1,
  }),
  verbose: Type.Optional(
    Type.Boolean({
      description: "Include commit subjects in the cherry output.",
    }),
  ),
});

const GitShowBranchToolParameters = Type.Object({
  all: Type.Optional(
    Type.Boolean({
      description: "Include remote-tracking and local branches.",
    }),
  ),
  current: Type.Optional(
    Type.Boolean({
      description: "Include the current branch in the comparison.",
    }),
  ),
  dateOrder: Type.Optional(
    Type.Boolean({
      description: "Sort commits by date when possible.",
    }),
  ),
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of show-branch lines to return.",
      minimum: 1,
      maximum: 500,
    }),
  ),
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("show"),
        Type.Literal("list"),
        Type.Literal("merge-base"),
        Type.Literal("independent"),
        Type.Literal("reflog"),
      ],
      {
        description: "Select a show-branch operating mode.",
      },
    ),
  ),
  more: Type.Optional(
    Type.Integer({
      description: "Show additional commits beyond the common ancestor.",
      minimum: 0,
      maximum: 500,
    }),
  ),
  noName: Type.Optional(
    Type.Boolean({
      description: "Suppress branch naming labels in the output.",
    }),
  ),
  reflogBase: Type.Optional(
    Type.String({
      description: "Base reference for reflog traversal.",
      minLength: 1,
    }),
  ),
  reflogCount: Type.Optional(
    Type.Integer({
      description: "Number of reflog entries to show in reflog mode.",
      minimum: 1,
      maximum: 500,
    }),
  ),
  remotes: Type.Optional(
    Type.Boolean({
      description: "Include remote-tracking branches.",
    }),
  ),
  revisions: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Branches, revision names, or globs to compare.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  sha1Name: Type.Optional(
    Type.Boolean({
      description: "Print commit object names instead of branch labels.",
    }),
  ),
  sparse: Type.Optional(
    Type.Boolean({
      description: "Show merges reachable from only one tip.",
    }),
  ),
  topoOrder: Type.Optional(
    Type.Boolean({
      description: "Use topological ordering for the displayed commits.",
    }),
  ),
  topics: Type.Optional(
    Type.Boolean({
      description: "Show only commits not on the first branch.",
    }),
  ),
});

const GitFsckToolParameters = Type.Object({
  cache: Type.Optional(
    Type.Boolean({
      description: "Treat index objects as head nodes during verification.",
    }),
  ),
  connectivityOnly: Type.Optional(
    Type.Boolean({
      description: "Check object connectivity without full content validation.",
    }),
  ),
  dangling: Type.Optional(
    Type.Boolean({
      description: "Report dangling objects.",
    }),
  ),
  full: Type.Optional(
    Type.Boolean({
      description: "Inspect packs and alternates in addition to loose objects.",
    }),
  ),
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of fsck output lines to return.",
      minimum: 1,
      maximum: 500,
    }),
  ),
  nameObjects: Type.Optional(
    Type.Boolean({
      description: "Include verbose names for reachable objects.",
    }),
  ),
  noReflogs: Type.Optional(
    Type.Boolean({
      description: "Ignore reflogs when determining root reachability.",
    }),
  ),
  objects: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Specific object ids or revision names to inspect.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  progress: Type.Optional(
    Type.Boolean({
      description: "Allow fsck progress output.",
    }),
  ),
  root: Type.Optional(
    Type.Boolean({
      description: "Treat root nodes as fsck heads.",
    }),
  ),
  strict: Type.Optional(
    Type.Boolean({
      description: "Enable stricter fsck checks.",
    }),
  ),
  tags: Type.Optional(
    Type.Boolean({
      description: "Include tags in the fsck traversal.",
    }),
  ),
  unreachable: Type.Optional(
    Type.Boolean({
      description: "Report unreachable objects.",
    }),
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description: "Include verbose fsck output.",
    }),
  ),
});

type GitCatFileToolResultDetails = {
  content: string | null;
  error: string | null;
  exists: boolean;
  exitCode: number;
  mode: "exists" | "pretty" | "size" | "type";
  object: string;
  objectSize: number | null;
  objectType: string | null;
  shownLineCount: number | null;
  totalByteLength: number | null;
  totalLineCount: number | null;
  truncatedByBytes: boolean;
  truncatedLineCount: number | null;
  worktreePath: string;
};

const GitCatFileToolParameters = Type.Object({
  maxBytes: Type.Optional(
    Type.Integer({
      description: "Maximum number of preview bytes to return in pretty mode.",
      minimum: 1,
      maximum: 262_144,
    }),
  ),
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of preview lines to return in pretty mode.",
      minimum: 1,
      maximum: 500,
    }),
  ),
  mode: Type.Optional(
    Type.Union(
      [
        Type.Literal("exists"),
        Type.Literal("pretty"),
        Type.Literal("size"),
        Type.Literal("type"),
      ],
      {
        description:
          "Choose whether to check existence, show type, show size, or preview object contents.",
      },
    ),
  ),
  object: Type.String({
    description: "Object id, commit-ish, or tree-ish to inspect.",
    minLength: 1,
  }),
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

function normalizeTextList(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.replace(/\r\n/g, "\n").split("\n");
}

function truncateTextLines(
  lines: string[],
  maxLines: number,
): {
  shownLines: string[];
  shownLineCount: number;
  totalLineCount: number;
  truncatedLineCount: number | null;
} {
  const shownLines = lines.slice(0, maxLines);
  return {
    shownLines,
    shownLineCount: shownLines.length,
    totalLineCount: lines.length,
    truncatedLineCount:
      lines.length > shownLines.length
        ? lines.length - shownLines.length
        : null,
  };
}

function combineCommandOutput(stdout: string, stderr: string): string | null {
  const parts = [stderr.trim(), stdout.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function _formatBooleanSummary(label: string, value: boolean): string {
  return `${label}: ${value ? "yes" : "no"}`;
}

function parseGitForEachRefLine(line: string): GitForEachRefEntry | null {
  const fields = line.split(GIT_FOR_EACH_REF_FIELD_SEPARATOR);
  if (fields.length < 8) {
    return null;
  }

  const [
    ref = "",
    shortRef = "",
    objectHash = "",
    objectType = "",
    createdAt = "",
    subject = "",
    upstream = "",
    symrefTarget = "",
  ] = fields;

  if (!ref || !shortRef || !objectHash) {
    return null;
  }

  return {
    createdAt: normalizeOptionalText(createdAt),
    objectHash,
    objectType: objectType || "unknown",
    ref,
    shortRef,
    subject: normalizeOptionalText(subject),
    symrefTarget: normalizeOptionalText(symrefTarget),
    upstream: normalizeOptionalText(upstream),
  };
}

function formatGitForEachRefEntry(entry: GitForEachRefEntry): string {
  const dateText = entry.createdAt ? ` @ ${entry.createdAt}` : "";
  const subjectText = entry.subject ? ` — ${entry.subject}` : "";
  const upstreamText = entry.upstream ? ` upstream=${entry.upstream}` : "";
  const symrefText = entry.symrefTarget ? ` symref=${entry.symrefTarget}` : "";
  return `${entry.ref} (${entry.shortRef}) ${entry.objectType} ${entry.objectHash}${dateText}${subjectText}${upstreamText}${symrefText}`;
}

function parseGitCherryLine(line: string): GitCherryEntry | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const marker = trimmed.slice(0, 1);
  if (marker !== "+" && marker !== "-") {
    return null;
  }

  const [commitHash = "", ...subjectParts] = trimmed
    .slice(1)
    .trim()
    .split(/\s+/u);
  if (!commitHash) {
    return null;
  }

  return {
    ahead: marker === "+",
    commitHash,
    subject: subjectParts.length > 0 ? subjectParts.join(" ") : null,
  };
}

function formatGitCherryEntry(entry: GitCherryEntry): string {
  const marker = entry.ahead ? "+" : "-";
  return entry.subject
    ? `${marker} ${entry.commitHash} ${entry.subject}`
    : `${marker} ${entry.commitHash}`;
}

function parseGitFsckMessage(line: string): GitFsckMessage {
  const trimmed = line.trim();
  if (!trimmed) {
    return {
      category: "info",
      text: line,
    };
  }

  const category = trimmed.startsWith("error:")
    ? "error"
    : trimmed.startsWith("warning:")
      ? "warning"
      : trimmed.startsWith("dangling ")
        ? "dangling"
        : trimmed.startsWith("unreachable ")
          ? "unreachable"
          : trimmed.startsWith("missing ")
            ? "missing"
            : (trimmed.split(/\s+/u, 1)[0] ?? "info");
  return {
    category,
    text: trimmed,
  };
}

function formatGitFsckMessage(message: GitFsckMessage): string {
  return `- [${message.category}] ${message.text}`;
}

function parseGitCatFileSize(raw: string): number | null {
  const parsedSize = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsedSize) ? parsedSize : null;
}

function truncatePreviewText(
  rawText: string,
  maxLines: number,
  maxBytes: number,
): {
  shownLineCount: number;
  text: string;
  totalByteLength: number;
  totalLineCount: number;
  truncatedByBytes: boolean;
  truncatedLineCount: number | null;
} {
  const totalByteLength = Buffer.byteLength(rawText, "utf8");
  const totalLines = splitTextLines(rawText);
  const shownLines = totalLines.slice(0, maxLines);
  let previewText = shownLines.join("\n");
  let truncatedByBytes = false;

  if (Buffer.byteLength(previewText, "utf8") > maxBytes) {
    const encoded = Buffer.from(previewText, "utf8");
    previewText = new TextDecoder().decode(encoded.subarray(0, maxBytes));
    truncatedByBytes = true;
  }

  return {
    shownLineCount: shownLines.length,
    text: previewText,
    totalByteLength,
    totalLineCount: totalLines.length,
    truncatedByBytes,
    truncatedLineCount:
      totalLines.length > shownLines.length
        ? totalLines.length - shownLines.length
        : null,
  };
}

function buildGitForEachRefArgs(params: {
  containsRevision?: string | null;
  ignoreCase?: boolean;
  includeRootRefs?: boolean;
  mergedRevision?: string | null;
  maxRefs: number;
  noContainsRevision?: string | null;
  noMergedRevision?: string | null;
  patterns: string[];
  pointsAt?: string | null;
  sort: string[];
}): string[] {
  const args = [
    "for-each-ref",
    ...(params.ignoreCase ? ["--ignore-case"] : []),
    ...(params.includeRootRefs ? ["--include-root-refs"] : []),
    `--count=${params.maxRefs}`,
    ...params.sort.map((sortKey) => `--sort=${sortKey}`),
    ...(params.pointsAt ? ["--points-at", params.pointsAt] : []),
    ...(params.mergedRevision ? ["--merged", params.mergedRevision] : []),
    ...(params.noMergedRevision
      ? ["--no-merged", params.noMergedRevision]
      : []),
    ...(params.containsRevision ? ["--contains", params.containsRevision] : []),
    ...(params.noContainsRevision
      ? ["--no-contains", params.noContainsRevision]
      : []),
    "--format",
    GIT_FOR_EACH_REF_FORMAT,
    ...(params.patterns.length > 0 ? params.patterns : ["refs"]),
  ];

  return args;
}

function buildGitShowBranchArgs(params: {
  all: boolean;
  current: boolean;
  dateOrder: boolean;
  mode: string;
  more: number | null;
  noName: boolean;
  reflogBase: string | null;
  reflogCount: number | null;
  remotes: boolean;
  revisions: string[];
  sha1Name: boolean;
  sparse: boolean;
  topoOrder: boolean;
  topics: boolean;
}): string[] {
  const args = ["show-branch", "--no-color"];
  if (params.mode === "list") {
    args.push("--list");
  } else if (params.mode === "merge-base") {
    args.push("--merge-base");
  } else if (params.mode === "independent") {
    args.push("--independent");
  } else if (params.mode === "reflog") {
    if (params.reflogCount !== null || params.reflogBase !== null) {
      const countText =
        params.reflogCount === null ? "1" : String(params.reflogCount);
      const baseText =
        params.reflogBase === null ? "" : `,${params.reflogBase}`;
      args.push(`-g=${countText}${baseText}`);
    } else {
      args.push("-g");
    }
  }

  if (params.all) {
    args.push("--all");
  }
  if (params.current) {
    args.push("--current");
  }
  if (params.dateOrder) {
    args.push("--date-order");
  }
  if (params.more !== null) {
    args.push(`--more=${params.more}`);
  }
  if (params.noName) {
    args.push("--no-name");
  }
  if (params.remotes) {
    args.push("--remotes");
  }
  if (params.sha1Name) {
    args.push("--sha1-name");
  }
  if (params.sparse) {
    args.push("--sparse");
  }
  if (params.topoOrder) {
    args.push("--topo-order");
  }
  if (params.topics) {
    args.push("--topics");
  }
  args.push(...params.revisions);
  return args;
}

function buildGitFsckArgs(params: {
  cache: boolean;
  connectivityOnly: boolean;
  dangling: boolean;
  full: boolean;
  nameObjects: boolean;
  noReflogs: boolean;
  objects: string[];
  progress: boolean;
  root: boolean;
  strict: boolean;
  tags: boolean;
  unreachable: boolean;
  verbose: boolean;
}): string[] {
  return [
    "fsck",
    ...(params.dangling ? ["--dangling"] : []),
    ...(params.unreachable ? ["--unreachable"] : []),
    ...(params.tags ? ["--tags"] : []),
    ...(params.root ? ["--root"] : []),
    ...(params.cache ? ["--cache"] : []),
    ...(params.noReflogs ? ["--no-reflogs"] : []),
    ...(params.full ? ["--full"] : []),
    ...(params.strict ? ["--strict"] : []),
    ...(params.verbose ? ["--verbose"] : []),
    ...(params.connectivityOnly ? ["--connectivity-only"] : []),
    ...(params.nameObjects ? ["--name-objects"] : []),
    ...(params.progress ? ["--progress"] : ["--no-progress"]),
    ...params.objects,
  ];
}

function _buildGitCatFileArgs(params: {
  mode: "exists" | "pretty" | "size" | "type";
  object: string;
}): string[] {
  if (params.mode === "exists") {
    return ["cat-file", "-e", params.object];
  }
  if (params.mode === "type") {
    return ["cat-file", "-t", params.object];
  }
  if (params.mode === "size") {
    return ["cat-file", "-s", params.object];
  }
  return ["cat-file", "-p", params.object];
}

export function createPiGitLowLevelTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "List refs with `patterns`, `sort`, `pointsAt`, `mergedRevision`, `noMergedRevision`, `containsRevision`, `noContainsRevision`, and `maxRefs` controls.",
        execute: async (_toolCallId, params, signal) => {
          const patterns = normalizeTextList(params.patterns);
          const sortKeys = normalizeTextList(params.sort);
          const sort = sortKeys.length > 0 ? sortKeys : ["refname"];
          const maxRefs = normalizePositiveInteger(
            params.maxRefs,
            100,
            1,
            2_000,
          );
          const pointsAt = normalizeOptionalText(params.pointsAt);
          const mergedRevision = normalizeOptionalText(params.mergedRevision);
          const noMergedRevision = normalizeOptionalText(
            params.noMergedRevision,
          );
          const containsRevision = normalizeOptionalText(
            params.containsRevision,
          );
          const noContainsRevision = normalizeOptionalText(
            params.noContainsRevision,
          );
          const args = buildGitForEachRefArgs({
            containsRevision,
            ignoreCase: params.ignoreCase === true,
            includeRootRefs: params.includeRootRefs === true,
            mergedRevision,
            maxRefs,
            noContainsRevision,
            noMergedRevision,
            patterns,
            pointsAt,
            sort,
          });
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr ||
                `git for-each-ref exited with code ${result.exitCode}`,
            );
          }

          const entries = splitTextLines(result.stdout)
            .map((line) => parseGitForEachRefLine(line))
            .filter((entry): entry is GitForEachRefEntry => entry !== null);
          const shownEntries = entries.slice(0, maxRefs);
          const truncatedRefCount =
            entries.length > shownEntries.length
              ? entries.length - shownEntries.length
              : null;
          const textSections = [
            `Git refs for ${scope.worktreePathContext}`,
            `Showing ${shownEntries.length} of ${entries.length} ref(s) with limit ${maxRefs}.`,
            `Patterns: ${patterns.length > 0 ? patterns.join(", ") : "refs"}`,
            `Sort: ${sort.join(", ")}`,
            `Include root refs: ${params.includeRootRefs === true ? "yes" : "no"}`,
            `Ignore case: ${params.ignoreCase === true ? "yes" : "no"}`,
            shownEntries.length > 0
              ? [
                  "Refs",
                  shownEntries
                    .map((entry) => formatGitForEachRefEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Refs\n\n- none",
          ];
          if (truncatedRefCount !== null) {
            textSections.push(
              `Truncated: ${truncatedRefCount} additional ref(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            containsRevision,
            entries: shownEntries,
            ignoreCase: params.ignoreCase === true,
            includeRootRefs: params.includeRootRefs === true,
            mergedRevision,
            maxRefs,
            noContainsRevision,
            noMergedRevision,
            patternCount: patterns.length,
            patterns,
            pointsAt,
            shownRefCount: shownEntries.length,
            sort,
            totalRefCount: entries.length,
            truncatedRefCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git For Each Ref",
        name: "git_for_each_ref",
        parameters: GitForEachRefToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitForEachRefToolParameters>(
            args,
            ["ignoreCase", "includeRootRefs"],
            ["maxRefs"],
          ),
        promptGuidelines: [
          "Use this to inspect refs, tags, and branches with structured filters before choosing a revision target.",
        ],
        promptSnippet: "List refs with filters",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Compare `upstreamRevision` and `headRevision` with `verbose`, `limit`, and `abbrevDigits` controls.",
        execute: async (_toolCallId, params, signal) => {
          const upstreamRevision = normalizeOptionalText(
            params.upstreamRevision,
          );
          if (!upstreamRevision) {
            throw new Error(
              "git_cherry requires a non-empty upstreamRevision value.",
            );
          }
          const headRevision =
            normalizeOptionalText(params.headRevision) ?? "HEAD";
          const limit = normalizePositiveInteger(params.limit, 200, 1, 2_000);
          const verbose = params.verbose === true;
          const abbrevDigits = normalizePositiveInteger(
            params.abbrevDigits,
            12,
            4,
            40,
          );
          const args = [
            "cherry",
            ...(verbose ? ["-v"] : []),
            `--abbrev=${abbrevDigits}`,
            upstreamRevision,
            headRevision,
          ];
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr || `git cherry exited with code ${result.exitCode}`,
            );
          }

          const entries = splitTextLines(result.stdout)
            .map((line) => parseGitCherryLine(line))
            .filter((entry): entry is GitCherryEntry => entry !== null);
          const shownEntries = entries.slice(0, limit);
          const aheadCount = entries.filter((entry) => entry.ahead).length;
          const equivalentCount = entries.length - aheadCount;
          const truncatedEntryCount =
            entries.length > shownEntries.length
              ? entries.length - shownEntries.length
              : null;
          const textSections = [
            `Git cherry for ${scope.worktreePathContext}`,
            `Upstream: ${upstreamRevision}`,
            `Head: ${headRevision}`,
            `Limit: ${limit}`,
            `Verbose: ${verbose ? "yes" : "no"}`,
            `Abbrev digits: ${abbrevDigits}`,
            `Showing ${shownEntries.length} of ${entries.length} result(s) with limit ${limit}.`,
            `Ahead: ${aheadCount} of ${entries.length}`,
            `Equivalent: ${equivalentCount}`,
            shownEntries.length > 0
              ? [
                  "Cherry results",
                  shownEntries
                    .map((entry) => formatGitCherryEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Cherry results\n\n- none",
          ];
          if (truncatedEntryCount !== null) {
            textSections.push(
              `Truncated: ${truncatedEntryCount} additional result(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            abbrevDigits,
            aheadCount,
            entries: shownEntries,
            equivalentCount,
            headRevision,
            limit,
            shownEntryCount: shownEntries.length,
            totalEntryCount: entries.length,
            truncatedEntryCount,
            upstreamRevision,
            verbose,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Cherry",
        name: "git_cherry",
        parameters: GitCherryToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCherryToolParameters>(
            args,
            ["verbose"],
            ["abbrevDigits", "limit"],
          ),
        promptGuidelines: [
          "Use this to compare a topic branch against its upstream and identify commits that are new or equivalent.",
        ],
        promptSnippet: "Compare commits with git cherry",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect branch relationships with `mode`, `revisions`, `all`, `remotes`, `current`, `topics`, `sparse`, `topoOrder`, `dateOrder`, `more`, and `maxLines` controls.",
        execute: async (_toolCallId, params, signal) => {
          const mode = params.mode ?? "show";
          const revisions = normalizeTextList(params.revisions);
          const more =
            typeof params.more === "number"
              ? normalizePositiveInteger(params.more, params.more, 0, 500)
              : null;
          const reflogCount =
            typeof params.reflogCount === "number"
              ? normalizePositiveInteger(
                  params.reflogCount,
                  params.reflogCount,
                  1,
                  500,
                )
              : null;
          const reflogBase = normalizeOptionalText(params.reflogBase);
          const maxLines = normalizePositiveInteger(
            params.maxLines,
            200,
            1,
            500,
          );
          const args = buildGitShowBranchArgs({
            all: params.all === true,
            current: params.current === true,
            dateOrder: params.dateOrder === true,
            mode,
            more,
            noName: params.noName === true,
            reflogBase,
            reflogCount,
            remotes: params.remotes === true,
            revisions,
            sha1Name: params.sha1Name === true,
            sparse: params.sparse === true,
            topoOrder: params.topoOrder === true,
            topics: params.topics === true,
          });
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr ||
                `git show-branch exited with code ${result.exitCode}`,
            );
          }

          const lines = splitTextLines(result.stdout);
          const {
            shownLines,
            shownLineCount,
            totalLineCount,
            truncatedLineCount,
          } = truncateTextLines(lines, maxLines);
          const textSections = [
            `Git show-branch for ${scope.worktreePathContext}`,
            `Mode: ${mode}`,
            `Revisions: ${revisions.length > 0 ? revisions.join(", ") : "none"}`,
            `All: ${params.all === true ? "yes" : "no"}`,
            `Remotes: ${params.remotes === true ? "yes" : "no"}`,
            `Current: ${params.current === true ? "yes" : "no"}`,
            `Topics: ${params.topics === true ? "yes" : "no"}`,
            `Sparse: ${params.sparse === true ? "yes" : "no"}`,
            `Topo order: ${params.topoOrder === true ? "yes" : "no"}`,
            `Date order: ${params.dateOrder === true ? "yes" : "no"}`,
            `No name: ${params.noName === true ? "yes" : "no"}`,
            `Sha1 name: ${params.sha1Name === true ? "yes" : "no"}`,
            `More: ${more === null ? "none" : more}`,
            `Reflog: ${
              reflogCount === null && reflogBase === null
                ? "none"
                : `${reflogCount ?? 1}${reflogBase ? `,${reflogBase}` : ""}`
            }`,
            `Showing ${shownLineCount} of ${totalLineCount} line(s) with limit ${maxLines}.`,
            shownLines.length > 0
              ? ["Output", shownLines.join("\n")].join("\n\n")
              : "Output\n\n- none",
          ];
          if (truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncatedLineCount} additional line(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            all: params.all === true,
            current: params.current === true,
            dateOrder: params.dateOrder === true,
            lines: shownLines,
            maxLines,
            mode,
            more,
            noName: params.noName === true,
            reflogBase,
            reflogCount,
            remotes: params.remotes === true,
            revisions,
            sha1Name: params.sha1Name === true,
            shownLineCount,
            sparse: params.sparse === true,
            topoOrder: params.topoOrder === true,
            topics: params.topics === true,
            totalLineCount,
            truncatedLineCount,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Show Branch",
        name: "git_show_branch",
        parameters: GitShowBranchToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitShowBranchToolParameters>(
            args,
            [
              "all",
              "current",
              "dateOrder",
              "noName",
              "remotes",
              "sha1Name",
              "sparse",
              "topoOrder",
              "topics",
            ],
            ["maxLines", "more", "reflogCount"],
          ),
        promptGuidelines: [
          "Use this to inspect how branches relate to one another before merging or rebasing.",
        ],
        promptSnippet: "Show branch relationships",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Run fsck with `dangling`, `unreachable`, `tags`, `root`, `cache`, `noReflogs`, `full`, `strict`, `verbose`, `connectivityOnly`, `nameObjects`, and `objects` controls.",
        execute: async (_toolCallId, params, signal) => {
          const objects = normalizeTextList(params.objects);
          const maxLines = normalizePositiveInteger(
            params.maxLines,
            200,
            1,
            500,
          );
          const args = buildGitFsckArgs({
            cache: params.cache === true,
            connectivityOnly: params.connectivityOnly === true,
            dangling: params.dangling === true,
            full: params.full === true,
            nameObjects: params.nameObjects === true,
            noReflogs: params.noReflogs === true,
            objects,
            progress: params.progress === true,
            root: params.root === true,
            strict: params.strict === true,
            tags: params.tags === true,
            unreachable: params.unreachable === true,
            verbose: params.verbose === true,
          });
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const combinedOutput = combineCommandOutput(
            result.stdout,
            result.stderr,
          );
          const messages = (
            combinedOutput ? splitTextLines(combinedOutput) : []
          )
            .map((line) => parseGitFsckMessage(line))
            .filter((message) => message.text.length > 0);
          const {
            shownLines,
            shownLineCount,
            totalLineCount,
            truncatedLineCount,
          } = truncateTextLines(
            messages.map((message) => formatGitFsckMessage(message)),
            maxLines,
          );
          const textSections = [
            `Git fsck for ${scope.worktreePathContext}`,
            `Exit code: ${result.exitCode}`,
            `Objects: ${objects.length > 0 ? objects.join(", ") : "none"}`,
            `Dangling: ${params.dangling === true ? "yes" : "no"}`,
            `Unreachable: ${params.unreachable === true ? "yes" : "no"}`,
            `Tags: ${params.tags === true ? "yes" : "no"}`,
            `Root: ${params.root === true ? "yes" : "no"}`,
            `Cache: ${params.cache === true ? "yes" : "no"}`,
            `No reflogs: ${params.noReflogs === true ? "yes" : "no"}`,
            `Full: ${params.full === true ? "yes" : "no"}`,
            `Strict: ${params.strict === true ? "yes" : "no"}`,
            `Verbose: ${params.verbose === true ? "yes" : "no"}`,
            `Connectivity only: ${params.connectivityOnly === true ? "yes" : "no"}`,
            `Name objects: ${params.nameObjects === true ? "yes" : "no"}`,
            `Messages: ${messages.length}`,
            `Showing ${shownLineCount} of ${totalLineCount} line(s) with limit ${maxLines}.`,
            shownLines.length > 0
              ? ["Output", shownLines.join("\n")].join("\n\n")
              : "Output\n\n- none",
          ];
          if (truncatedLineCount !== null) {
            textSections.push(
              `Truncated: ${truncatedLineCount} additional line(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            cache: params.cache === true,
            connectivityOnly: params.connectivityOnly === true,
            dangling: params.dangling === true,
            exitCode: result.exitCode,
            full: params.full === true,
            messages,
            messageCount: messages.length,
            maxLines,
            nameObjects: params.nameObjects === true,
            noReflogs: params.noReflogs === true,
            objects,
            progress: params.progress === true,
            root: params.root === true,
            strict: params.strict === true,
            tags: params.tags === true,
            totalLineCount,
            truncatedLineCount,
            unreachable: params.unreachable === true,
            verbose: params.verbose === true,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Fsck",
        name: "git_fsck",
        parameters: GitFsckToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitFsckToolParameters>(
            args,
            [
              "cache",
              "connectivityOnly",
              "dangling",
              "full",
              "nameObjects",
              "noReflogs",
              "progress",
              "root",
              "strict",
              "tags",
              "unreachable",
              "verbose",
            ],
            ["maxLines"],
          ),
        promptGuidelines: [
          "Use this to diagnose repository integrity problems without writing any recovery files.",
        ],
        promptSnippet: "Run git fsck",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Inspect an object with `mode`, `maxLines`, and `maxBytes` controls while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const mode = params.mode ?? "pretty";
          const object = normalizeOptionalText(params.object);
          if (!object) {
            throw new Error("git_cat_file requires a non-empty object value.");
          }

          const existsResult = await runGitCommandResult(
            scope.worktreePathContext,
            ["cat-file", "-e", object],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const exists = existsResult.exitCode === 0;
          const errorText = exists
            ? null
            : (combineCommandOutput(existsResult.stdout, existsResult.stderr) ??
              `git cat-file exited with code ${existsResult.exitCode}`);

          if (mode === "exists") {
            return textToolResult<GitCatFileToolResultDetails>(
              [
                `Git cat-file for ${scope.worktreePathContext}`,
                `Object: ${object}`,
                `Exists: ${exists ? "yes" : "no"}`,
              ].join("\n"),
              {
                error: errorText,
                exists,
                exitCode: existsResult.exitCode,
                mode,
                object,
                objectSize: null,
                objectType: null,
                content: null,
                shownLineCount: null,
                totalByteLength: null,
                totalLineCount: null,
                truncatedByBytes: false,
                truncatedLineCount: null,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          if (!exists) {
            return textToolResult<GitCatFileToolResultDetails>(
              [
                `Git cat-file for ${scope.worktreePathContext}`,
                `Object: ${object}`,
                `Mode: ${mode}`,
                `Exists: no`,
                errorText ? `Error: ${errorText}` : "Error: unknown",
              ].join("\n"),
              {
                error: errorText,
                exists: false,
                exitCode: existsResult.exitCode,
                mode,
                object,
                objectSize: null,
                objectType: null,
                content: null,
                shownLineCount: null,
                totalByteLength: null,
                totalLineCount: null,
                truncatedByBytes: false,
                truncatedLineCount: null,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          if (mode === "type") {
            const typeResult = await runGitCommandResult(
              scope.worktreePathContext,
              ["cat-file", "-t", object],
              typeof signal === "undefined" ? undefined : { signal },
            );
            if (typeResult.exitCode !== 0) {
              throw new Error(
                typeResult.stderr ||
                  `git cat-file exited with code ${typeResult.exitCode}`,
              );
            }

            const objectType =
              normalizeOptionalText(typeResult.stdout) ?? "unknown";
            return textToolResult<GitCatFileToolResultDetails>(
              [
                `Git cat-file for ${scope.worktreePathContext}`,
                `Object: ${object}`,
                `Mode: ${mode}`,
                `Exists: yes`,
                `Type: ${objectType}`,
              ].join("\n"),
              {
                content: null,
                error: null,
                exists: true,
                exitCode: typeResult.exitCode,
                mode,
                object,
                objectSize: null,
                objectType,
                shownLineCount: null,
                totalByteLength: null,
                totalLineCount: null,
                truncatedByBytes: false,
                truncatedLineCount: null,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          if (mode === "size") {
            const sizeResult = await runGitCommandResult(
              scope.worktreePathContext,
              ["cat-file", "-s", object],
              typeof signal === "undefined" ? undefined : { signal },
            );
            if (sizeResult.exitCode !== 0) {
              throw new Error(
                sizeResult.stderr ||
                  `git cat-file exited with code ${sizeResult.exitCode}`,
              );
            }

            const objectSize = parseGitCatFileSize(sizeResult.stdout);
            return textToolResult<GitCatFileToolResultDetails>(
              [
                `Git cat-file for ${scope.worktreePathContext}`,
                `Object: ${object}`,
                `Mode: ${mode}`,
                `Exists: yes`,
                `Size: ${objectSize === null ? "unknown" : `${objectSize} bytes`}`,
              ].join("\n"),
              {
                content: null,
                error: null,
                exists: true,
                exitCode: sizeResult.exitCode,
                mode,
                object,
                objectSize,
                objectType: null,
                shownLineCount: null,
                totalByteLength: null,
                totalLineCount: null,
                truncatedByBytes: false,
                truncatedLineCount: null,
                worktreePath: scope.worktreePathContext,
              },
            );
          }

          const typeResult = await runGitCommandResult(
            scope.worktreePathContext,
            ["cat-file", "-t", object],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const sizeResult = await runGitCommandResult(
            scope.worktreePathContext,
            ["cat-file", "-s", object],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const prettyResult = await runGitCommandResult(
            scope.worktreePathContext,
            ["cat-file", "-p", object],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const objectType =
            typeResult.exitCode === 0
              ? (normalizeOptionalText(typeResult.stdout) ?? "unknown")
              : null;
          const objectSize =
            sizeResult.exitCode === 0
              ? parseGitCatFileSize(sizeResult.stdout)
              : null;
          const maxLines = normalizePositiveInteger(
            params.maxLines,
            200,
            1,
            500,
          );
          const maxBytes = normalizePositiveInteger(
            params.maxBytes,
            16_384,
            1,
            262_144,
          );
          const preview = truncatePreviewText(
            prettyResult.stdout,
            maxLines,
            maxBytes,
          );
          const textSections = [
            `Git cat-file for ${scope.worktreePathContext}`,
            `Object: ${object}`,
            `Mode: ${mode}`,
            `Exists: yes`,
            `Type: ${objectType ?? "unknown"}`,
            `Size: ${objectSize === null ? "unknown" : `${objectSize} bytes`}`,
            `Showing ${preview.shownLineCount} of ${preview.totalLineCount} line(s) with limit ${maxLines} and ${maxBytes} bytes.`,
            preview.text
              ? ["Content", preview.text].join("\n\n")
              : "Content\n\n- none",
          ];
          if (preview.truncatedLineCount !== null || preview.truncatedByBytes) {
            textSections.push(
              `Truncated: ${preview.truncatedLineCount ?? 0} line(s) omitted${preview.truncatedByBytes ? "; byte limit reached" : ""}.`,
            );
          }

          return textToolResult<GitCatFileToolResultDetails>(
            textSections.join("\n\n"),
            {
              content: preview.text,
              error:
                prettyResult.exitCode === 0
                  ? null
                  : combineCommandOutput(
                      prettyResult.stdout,
                      prettyResult.stderr,
                    ),
              exists: true,
              exitCode: prettyResult.exitCode,
              mode,
              object,
              objectSize,
              objectType,
              shownLineCount: preview.shownLineCount,
              totalByteLength: preview.totalByteLength,
              totalLineCount: preview.totalLineCount,
              truncatedByBytes: preview.truncatedByBytes,
              truncatedLineCount: preview.truncatedLineCount,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Cat File",
        name: "git_cat_file",
        parameters: GitCatFileToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCatFileToolParameters>(
            args,
            [],
            ["maxBytes", "maxLines"],
          ),
        promptGuidelines: [
          "Use this to inspect object metadata or preview object contents without shell access.",
        ],
        promptSnippet: "Inspect a Git object",
      }),
    ),
  ];
}
