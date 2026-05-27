/**
 * @file src/bun/pi/git-tools/history.ts
 * @description Pi-native Git history and ref-inspection tool definitions.
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

const GitShowRefToolParameters = Type.Object({
  dereference: Type.Optional(
    Type.Boolean({
      description: "Include peeled tag targets in the ref listing.",
    }),
  ),
  includeHead: Type.Optional(
    Type.Boolean({
      description: "Include HEAD in the ref listing.",
    }),
  ),
  maxRefs: Type.Optional(
    Type.Integer({
      description: "Maximum number of refs to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  patterns: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Ref name patterns to match.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
});

const GitShortlogToolParameters = Type.Object({
  maxAuthors: Type.Optional(
    Type.Integer({
      description: "Maximum number of author groups to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  noMerges: Type.Optional(
    Type.Boolean({
      description: "Exclude merge commits from the summary.",
    }),
  ),
  range: Type.Optional(
    Type.String({
      description: "Revision range or commit-ish to summarize.",
      minLength: 1,
    }),
  ),
});

const GitDescribeToolParameters = Type.Object({
  all: Type.Optional(
    Type.Boolean({
      description:
        "Allow any ref name instead of only annotated and lightweight tags.",
    }),
  ),
  commit: Type.Optional(
    Type.String({
      description: "Commit-ish to describe.",
      minLength: 1,
    }),
  ),
  long: Type.Optional(
    Type.Boolean({
      description: "Include the matched distance and abbreviated hash.",
    }),
  ),
  tags: Type.Optional(
    Type.Boolean({
      description: "Include lightweight tags in the search.",
    }),
  ),
});

type GitShowRefEntry = {
  hash: string;
  namespace: string;
  peeled: boolean;
  ref: string;
};

type GitShortlogEntry = {
  authorText: string;
  count: number;
};

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

function normalizePatternList(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.replace(/\r\n/g, "\n").split("\n");
}

function normalizeRevisionText(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function classifyGitRefNamespace(ref: string): string {
  const baseRef = ref.endsWith("^{}") ? ref.slice(0, -3) : ref;
  if (baseRef === "HEAD") {
    return "HEAD";
  }
  if (baseRef.startsWith("refs/heads/")) {
    return "heads";
  }
  if (baseRef.startsWith("refs/tags/")) {
    return "tags";
  }
  if (baseRef.startsWith("refs/remotes/")) {
    return "remotes";
  }
  if (baseRef.startsWith("refs/notes/")) {
    return "notes";
  }
  if (baseRef.startsWith("refs/stash")) {
    return "stash";
  }
  if (baseRef.startsWith("refs/")) {
    return "refs";
  }
  return "other";
}

function parseGitShowRefListing(raw: string): GitShowRefEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: GitShowRefEntry[] = [];
  for (const line of splitTextLines(raw)) {
    if (!line.trim()) {
      continue;
    }

    const [hash = "", ref = ""] = line.trim().split(/\s+/u, 2);
    if (!hash || !ref) {
      continue;
    }

    const peeled = ref.endsWith("^{}");
    const baseRef = peeled ? ref.slice(0, -3) : ref;
    entries.push({
      hash,
      namespace: classifyGitRefNamespace(baseRef),
      peeled,
      ref,
    });
  }

  return entries;
}

function formatGitShowRefEntry(entry: GitShowRefEntry): string {
  return `${entry.ref} ${entry.hash}${entry.peeled ? " (peeled)" : ""}`;
}

function parseGitShortlogListing(raw: string): GitShortlogEntry[] {
  if (!raw.trim()) {
    return [];
  }

  const entries: GitShortlogEntry[] = [];
  for (const line of splitTextLines(raw)) {
    if (!line.trim()) {
      continue;
    }

    const match = line.match(/^\s*(\d+)\s+(.+)$/u);
    if (!match) {
      continue;
    }

    entries.push({
      authorText: match[2] ?? "unknown",
      count: Number.parseInt(match[1] ?? "0", 10),
    });
  }

  return entries;
}

function formatGitShortlogEntry(entry: GitShortlogEntry): string {
  return `${entry.count} ${entry.authorText}`;
}

function formatDescribeOptions(options: {
  all: boolean;
  long: boolean;
  tags: boolean;
}): string {
  const parts = [
    options.all ? "all refs" : null,
    options.tags ? "tags" : null,
    options.long ? "long" : null,
    "always",
  ].filter((part): part is string => typeof part === "string");

  return parts.join(", ");
}

export function createPiGitHistoryTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "List refs with `patterns`, `includeHead`, `dereference`, and `maxRefs` controlling the returned ref set without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const includeHead = params.includeHead !== false;
          const dereference = params.dereference !== false;
          const maxRefs =
            typeof params.maxRefs === "number"
              ? normalizePreviewLimit(params.maxRefs, 200)
              : 200;
          const patterns = normalizePatternList(params.patterns);
          const args = [
            "show-ref",
            ...(includeHead ? ["--head"] : []),
            ...(dereference ? ["--dereference"] : []),
            ...patterns,
          ];
          const rawRefs = await runGitCommand(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );
          const refs = parseGitShowRefListing(rawRefs);
          const shownRefs = refs.slice(0, maxRefs);
          const truncated =
            refs.length > shownRefs.length
              ? refs.length - shownRefs.length
              : null;
          const textSections = [
            `Git show-ref for ${scope.worktreePathContext}`,
            `Showing ${shownRefs.length} ref(s) from ${refs.length} total with limit ${maxRefs}.`,
            `Include HEAD: ${includeHead ? "yes" : "no"}`,
            `Dereference: ${dereference ? "yes" : "no"}`,
            patterns.length > 0
              ? `Patterns: ${patterns.join(", ")}`
              : "Patterns: none",
            shownRefs.length > 0
              ? [
                  "Refs",
                  shownRefs
                    .map((ref) => `- ${formatGitShowRefEntry(ref)}`)
                    .join("\n"),
                ].join("\n\n")
              : "Refs\n\n- none",
          ];
          if (truncated !== null) {
            textSections.push(
              `Truncated: ${truncated} additional ref(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            dereference,
            includeHead,
            patterns,
            refCount: refs.length,
            refs: shownRefs,
            shownRefCount: shownRefs.length,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Show Ref",
        name: "git_show_ref",
        parameters: GitShowRefToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitShowRefToolParameters>(
            args,
            ["dereference", "includeHead"],
            ["maxRefs"],
          ),
        promptGuidelines: [
          "Use this to inspect refs, tags, branches, notes, and HEAD in one bounded listing before reasoning about repository state.",
        ],
        promptSnippet: "Show Git refs in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Summarize commit authors with `range`, `maxAuthors`, and `noMerges` controlling the returned author groups without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const maxAuthors =
            typeof params.maxAuthors === "number"
              ? normalizePreviewLimit(params.maxAuthors, 200)
              : 200;
          const range = normalizeRevisionText(params.range) ?? "HEAD";
          const noMerges = params.noMerges !== false;
          const rawShortlog = await runGitCommand(
            scope.worktreePathContext,
            ["shortlog", "-sne", ...(noMerges ? ["--no-merges"] : []), range],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const authors = parseGitShortlogListing(rawShortlog);
          const shownAuthors = authors.slice(0, maxAuthors);
          const commitCount = authors.reduce(
            (total, entry) => total + entry.count,
            0,
          );
          const truncated =
            authors.length > shownAuthors.length
              ? authors.length - shownAuthors.length
              : null;
          const textSections = [
            `Git shortlog for ${scope.worktreePathContext}`,
            `Range: ${range}`,
            `Showing ${shownAuthors.length} author group(s) across ${commitCount} commit(s).`,
            `Exclude merges: ${noMerges ? "yes" : "no"}`,
            shownAuthors.length > 0
              ? [
                  "Authors",
                  shownAuthors
                    .map((author) => `- ${formatGitShortlogEntry(author)}`)
                    .join("\n"),
                ].join("\n\n")
              : "Authors\n\n- none",
          ];
          if (truncated !== null) {
            textSections.push(
              `Truncated: ${truncated} additional author group(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            authorCount: authors.length,
            authors: shownAuthors,
            commitCount,
            noMerges,
            range,
            shownAuthorCount: shownAuthors.length,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Shortlog",
        name: "git_shortlog",
        parameters: GitShortlogToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitShortlogToolParameters>(
            args,
            ["noMerges"],
            ["maxAuthors"],
          ),
        promptGuidelines: [
          "Use this to inspect who contributed to a range before discussing authorship or commit concentration.",
        ],
        promptSnippet: "Summarize Git commit authors in the current worktree",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Describe `commit` with `all`, `tags`, and `long` controlling the ref search and distance summary without using bash.",
        execute: async (_toolCallId, params, signal) => {
          const commit = normalizeRevisionText(params.commit) ?? "HEAD";
          const resolvedCommitHash = await resolveGitRevision(
            scope.worktreePathContext,
            commit,
            signal,
          );
          const all = params.all === true;
          const tags = params.tags !== false;
          const long = params.long !== false;
          const describeOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "describe",
              ...(all ? ["--all"] : []),
              ...(tags ? ["--tags"] : []),
              ...(long ? ["--long"] : []),
              "--always",
              resolvedCommitHash,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );

          return textToolResult(
            [
              `Git describe for ${scope.worktreePathContext}`,
              `Target: ${commit} -> ${resolvedCommitHash}`,
              `Description: ${describeOutput}`,
              `Options: ${formatDescribeOptions({ all, long, tags })}`,
            ].join("\n\n"),
            {
              all,
              commit,
              description: describeOutput,
              long,
              resolvedCommitHash,
              tags,
              worktreePath: scope.worktreePathContext,
            },
          );
        },
        label: "Git Describe",
        name: "git_describe",
        parameters: GitDescribeToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitDescribeToolParameters>(args, [
            "all",
            "long",
            "tags",
          ]),
        promptGuidelines: [
          "Use this to describe a commit by its nearest tag before discussing how far it is from a release point.",
        ],
        promptSnippet: "Describe a Git commit in the current worktree",
      }),
    ),
  ];
}
