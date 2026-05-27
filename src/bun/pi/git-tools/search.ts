/**
 * @file src/bun/pi/git-tools/search.ts
 * @description Pi-native Git search and blame tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { runGitCommand, runGitCommandResult } from "../../git";
import {
  normalizeGitPathArgument,
  normalizeGitPathArguments,
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

const GitGrepToolParameters = Type.Object({
  fixedStrings: Type.Optional(
    Type.Boolean({
      description:
        "Treat pattern as a fixed string instead of a regular expression.",
    }),
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({
      description: "Search case-insensitively.",
    }),
  ),
  maxMatches: Type.Optional(
    Type.Integer({
      description: "Maximum number of matches to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  paths: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Worktree-relative paths or directories to search.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  pattern: Type.String({
    description: "Pattern to search for.",
    minLength: 1,
  }),
  revision: Type.Optional(
    Type.String({
      description: "Commit-ish or revision to search instead of the worktree.",
      minLength: 1,
    }),
  ),
});

const GitBlameToolParameters = Type.Object({
  ignoreWhitespace: Type.Optional(
    Type.Boolean({
      description: "Ignore whitespace changes while blaming lines.",
    }),
  ),
  maxLines: Type.Optional(
    Type.Integer({
      description: "Maximum number of lines to blame.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  path: Type.String({
    description: "Worktree-relative file path to blame.",
    minLength: 1,
  }),
  revision: Type.Optional(
    Type.String({
      description: "Commit-ish or revision to blame instead of HEAD.",
      minLength: 1,
    }),
  ),
  startLine: Type.Optional(
    Type.Integer({
      description: "1-based line number to start blaming from.",
      minimum: 1,
      maximum: 1_000_000,
    }),
  ),
});

type GitGrepMatch = {
  lineNumber: number;
  path: string;
  text: string;
};

type GitBlameEntry = {
  authorName: string | null;
  commitHash: string;
  content: string;
  finalLineNumber: number;
  originalLineNumber: number;
  summary: string | null;
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

function splitTextLines(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.replace(/\r\n/g, "\n").split("\n");
}

function parseGitGrepOutput(
  raw: string,
  revisionPrefix: string | null,
): GitGrepMatch[] {
  if (!raw) {
    return [];
  }

  const matches: GitGrepMatch[] = [];
  for (let index = 0; index < raw.length; ) {
    const pathEnd = raw.indexOf("\0", index);
    if (pathEnd < 0) {
      break;
    }
    const rawPath = raw.slice(index, pathEnd).trim();
    index = pathEnd + 1;

    const lineEnd = raw.indexOf("\0", index);
    if (lineEnd < 0) {
      break;
    }
    const linePart = raw.slice(index, lineEnd).trim();
    index = lineEnd + 1;

    const textEnd = raw.indexOf("\n", index);
    const text = (
      textEnd < 0 ? raw.slice(index) : raw.slice(index, textEnd)
    ).replace(/\r?\n$/, "");
    index = textEnd < 0 ? raw.length : textEnd + 1;

    if (!rawPath || !linePart) {
      continue;
    }

    const path =
      revisionPrefix && rawPath.startsWith(`${revisionPrefix}:`)
        ? rawPath.slice(revisionPrefix.length + 1)
        : rawPath;
    const lineNumber = Number.parseInt(linePart, 10);
    if (!Number.isFinite(lineNumber)) {
      continue;
    }

    matches.push({
      lineNumber,
      path,
      text,
    });
  }

  return matches;
}

function formatGitGrepMatch(match: GitGrepMatch): string {
  return `${match.path}:${match.lineNumber}: ${match.text}`;
}

function parseGitBlameOutput(raw: string): GitBlameEntry[] {
  if (!raw) {
    return [];
  }

  const lines = splitTextLines(raw);
  const entries: GitBlameEntry[] = [];
  for (let index = 0; index < lines.length; ) {
    const header = lines[index] ?? "";
    if (!header.trim()) {
      index += 1;
      continue;
    }

    const headerMatch = header.match(/^(\S+)\s+(\d+)\s+(\d+)(?:\s+(\d+))?$/u);
    if (!headerMatch) {
      index += 1;
      continue;
    }

    const commitHash = headerMatch[1] ?? "unknown";
    const originalLineNumber = Number.parseInt(headerMatch[2] ?? "0", 10);
    const finalLineNumber = Number.parseInt(headerMatch[3] ?? "0", 10);
    index += 1;

    let authorName: string | null = null;
    let summary: string | null = null;
    let content = "";

    for (; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (line.startsWith("\t")) {
        content = line.slice(1);
        index += 1;
        break;
      }
      if (line.startsWith("author ")) {
        authorName = line.slice("author ".length).trim() || null;
        continue;
      }
      if (line.startsWith("summary ")) {
        summary = line.slice("summary ".length).trim() || null;
      }
    }

    entries.push({
      authorName,
      commitHash,
      content,
      finalLineNumber,
      originalLineNumber,
      summary,
    });
  }

  return entries;
}

function formatGitBlameEntry(entry: GitBlameEntry): string {
  const authorText = entry.authorName ?? "unknown";
  const summaryText = entry.summary ? ` — ${entry.summary}` : "";
  const contentText = entry.content || "(empty)";
  return `${entry.finalLineNumber}: ${entry.commitHash} ${authorText}${summaryText} | ${contentText}`;
}

export function createPiGitSearchTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Search the current worktree with `pattern`, optional `revision`, `paths`, `ignoreCase`, `fixedStrings`, and `maxMatches` controls. This tool stays inside the bound repository and returns a bounded match list.",
        execute: async (_toolCallId, params, signal) => {
          const pattern = normalizeOptionalText(params.pattern);
          if (!pattern) {
            throw new Error("Search pattern cannot be blank.");
          }

          const maxMatches = normalizePositiveInteger(
            params.maxMatches,
            50,
            1,
            2_000,
          );
          const revision = normalizeOptionalText(params.revision);
          const paths =
            params.paths && params.paths.length > 0
              ? normalizeGitPathArguments(
                  scope.worktreePathContext,
                  params.paths,
                )
              : [];
          const commandResult = await runGitCommandResult(
            scope.worktreePathContext,
            [
              "grep",
              "-z",
              "-n",
              "--full-name",
              "--no-color",
              ...(params.ignoreCase === true ? ["-i"] : []),
              ...(params.fixedStrings === true ? ["-F"] : []),
              pattern,
              ...(revision ? [revision] : []),
              ...(paths.length > 0 ? ["--", ...paths] : []),
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const rawOutput = commandResult.stdout.trimEnd();
          const noMatches =
            commandResult.exitCode === 1 &&
            !rawOutput &&
            !commandResult.stderr.trim();
          if (commandResult.exitCode !== 0 && !noMatches) {
            throw new Error(
              commandResult.stderr ||
                `git command failed with exit code ${commandResult.exitCode}`,
            );
          }

          const matches = noMatches
            ? []
            : parseGitGrepOutput(rawOutput, revision);
          const shownMatches = matches.slice(0, maxMatches);
          const truncated =
            matches.length > shownMatches.length
              ? matches.length - shownMatches.length
              : null;
          const textSections = [
            `Git grep for ${scope.worktreePathContext}`,
            `Pattern: ${pattern}`,
            `Revision: ${revision ?? "worktree"}`,
            `Paths: ${paths.length > 0 ? paths.join(", ") : "all tracked files"}`,
            `Ignore case: ${params.ignoreCase === true ? "yes" : "no"}`,
            `Fixed strings: ${params.fixedStrings === true ? "yes" : "no"}`,
            `Showing ${shownMatches.length} match(es) from ${matches.length} total with limit ${maxMatches}.`,
            shownMatches.length > 0
              ? [
                  "Matches",
                  shownMatches
                    .map((match) => formatGitGrepMatch(match))
                    .join("\n"),
                ].join("\n\n")
              : "Matches\n\n- none",
          ];
          if (truncated !== null) {
            textSections.push(
              `Truncated: ${truncated} additional match(es) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            fixedStrings: params.fixedStrings === true,
            ignoreCase: params.ignoreCase === true,
            matchCount: matches.length,
            matches: shownMatches,
            maxMatches,
            pattern,
            paths,
            revision,
            shownMatchCount: shownMatches.length,
            truncated,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Grep",
        name: "git_grep",
        parameters: GitGrepToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitGrepToolParameters>(
            args,
            ["fixedStrings", "ignoreCase"],
            ["maxMatches"],
          ),
        promptGuidelines: [
          "Use this to search text across the current worktree or a specific revision before opening files by hand.",
        ],
        promptSnippet: "Search the Git worktree with grep",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Blame `path` in the current worktree with optional `revision`, `startLine`, `maxLines`, and `ignoreWhitespace` controls. This tool stays within the bound repository and returns a bounded line-by-line annotation.",
        execute: async (_toolCallId, params, signal) => {
          const path = normalizeGitPathArgument(
            scope.worktreePathContext,
            params.path,
          );
          const startLine = normalizePositiveInteger(
            params.startLine,
            1,
            1,
            1_000_000,
          );
          const maxLines = normalizePositiveInteger(
            params.maxLines,
            20,
            1,
            2_000,
          );
          const endLine = startLine + maxLines - 1;
          const revisionInput =
            normalizeOptionalText(params.revision) ?? "HEAD";
          const resolvedRevision = await runGitCommand(
            scope.worktreePathContext,
            ["rev-parse", "--verify", revisionInput],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const blameOutput = await runGitCommand(
            scope.worktreePathContext,
            [
              "blame",
              "--line-porcelain",
              ...(params.ignoreWhitespace === true ? ["-w"] : []),
              "-L",
              `${startLine},${endLine}`,
              resolvedRevision,
              "--",
              path,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );
          const entries = parseGitBlameOutput(blameOutput);
          const textSections = [
            `Git blame for ${scope.worktreePathContext}`,
            `Revision: ${revisionInput} -> ${resolvedRevision}`,
            `Path: ${path}`,
            `Lines: ${startLine}-${endLine}`,
            `Ignore whitespace: ${params.ignoreWhitespace === true ? "yes" : "no"}`,
            `Showing ${entries.length} line(s).`,
            entries.length > 0
              ? [
                  "Blame",
                  entries.map((entry) => formatGitBlameEntry(entry)).join("\n"),
                ].join("\n\n")
              : "Blame\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            entries,
            ignoreWhitespace: params.ignoreWhitespace === true,
            lineCount: entries.length,
            maxLines,
            path,
            resolvedRevision,
            revision: revisionInput,
            startLine,
            endLine,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Blame",
        name: "git_blame",
        parameters: GitBlameToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitBlameToolParameters>(
            args,
            ["ignoreWhitespace"],
            ["maxLines", "startLine"],
          ),
        promptGuidelines: [
          "Use this to trace individual lines in a file back to the commits that last touched them.",
        ],
        promptSnippet: "Blame a file in the current Git worktree",
      }),
    ),
  ];
}
