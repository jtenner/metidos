/**
 * @file src/bun/pi/git-tools/inspection.ts
 * @description Pi-native Git verification and low-level inspection tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { runGitCommandResult } from "../../git";
import {
  normalizeGitPathArguments,
  type PiGitToolHost,
  type PiGitToolScope,
  prepareGitToolArguments,
  textToolResult,
  withGitToolTelemetry,
} from "./shared";

type GitVerificationOutcome = {
  input: string;
  output: string | null;
  exitCode: number;
  verified: boolean;
};

type GitCheckIgnoreOutcome = {
  ignored: boolean;
  lineNumber: number | null;
  pattern: string | null;
  path: string;
  source: string | null;
};

type GitCheckAttrValue = {
  name: string;
  value: string;
};

type GitCheckAttrOutcome = {
  attributes: GitCheckAttrValue[];
  path: string;
};

type GitLsFilesEntry = {
  path: string;
  statusTag: string | null;
};

type GitLsTreeEntry = {
  mode: string;
  objectHash: string;
  objectType: string;
  path: string;
  size: number | null;
};

const GitVerifyCommitToolParameters = Type.Object({
  commits: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Commit-ish revisions to verify.",
      minItems: 1,
      maxItems: 20,
    },
  ),
  raw: Type.Optional(
    Type.Boolean({
      description: "Include raw gpg status output in the verification output.",
    }),
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description: "Print the commit contents while verifying.",
    }),
  ),
});

const GitVerifyTagToolParameters = Type.Object({
  raw: Type.Optional(
    Type.Boolean({
      description: "Include raw gpg status output in the verification output.",
    }),
  ),
  tags: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Tag names or tag-ish revisions to verify.",
      minItems: 1,
      maxItems: 20,
    },
  ),
  verbose: Type.Optional(
    Type.Boolean({
      description: "Print the tag contents while verifying.",
    }),
  ),
});

const GitCheckIgnoreToolParameters = Type.Object({
  includeIndex: Type.Optional(
    Type.Boolean({
      description:
        "Also honor the index when checking ignore rules for the given paths.",
    }),
  ),
  paths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative paths to check against ignore rules.",
      minItems: 1,
      maxItems: 20,
    },
  ),
});

const GitCheckAttrToolParameters = Type.Object({
  all: Type.Optional(
    Type.Boolean({
      description: "Report all attributes instead of specific attribute names.",
    }),
  ),
  attributes: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description: "Attribute names to inspect on the given paths.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  cached: Type.Optional(
    Type.Boolean({
      description:
        "Read attributes from the index instead of the working tree.",
    }),
  ),
  paths: Type.Array(
    Type.String({
      minLength: 1,
    }),
    {
      description: "Worktree-relative paths whose attributes should be read.",
      minItems: 1,
      maxItems: 20,
    },
  ),
});

const GitLsFilesToolParameters = Type.Object({
  cached: Type.Optional(
    Type.Boolean({
      description: "Include cached entries from the index.",
    }),
  ),
  deleted: Type.Optional(
    Type.Boolean({
      description: "Include deleted tracked entries.",
    }),
  ),
  deduplicate: Type.Optional(
    Type.Boolean({
      description:
        "Suppress duplicate paths when Git reports the same file more than once.",
    }),
  ),
  excludeStandard: Type.Optional(
    Type.Boolean({
      description:
        "Apply the standard Git ignore rules to other and ignored entries.",
    }),
  ),
  includeDirectories: Type.Optional(
    Type.Boolean({
      description: "Collapse untracked directories to directory entries.",
    }),
  ),
  ignored: Type.Optional(
    Type.Boolean({
      description: "Include ignored files.",
    }),
  ),
  maxEntries: Type.Optional(
    Type.Integer({
      description: "Maximum number of file entries to return.",
      minimum: 1,
      maximum: 2_000,
    }),
  ),
  modified: Type.Optional(
    Type.Boolean({
      description: "Include modified tracked entries.",
    }),
  ),
  others: Type.Optional(
    Type.Boolean({
      description: "Include untracked entries.",
    }),
  ),
  paths: Type.Optional(
    Type.Array(
      Type.String({
        minLength: 1,
      }),
      {
        description:
          "Worktree-relative paths or directories to filter the listing.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  unmerged: Type.Optional(
    Type.Boolean({
      description: "Include unmerged index entries.",
    }),
  ),
});

const GitLsTreeToolParameters = Type.Object({
  long: Type.Optional(
    Type.Boolean({
      description: "Include blob sizes in the tree listing.",
    }),
  ),
  maxEntries: Type.Optional(
    Type.Integer({
      description: "Maximum number of tree entries to return.",
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
        description:
          "Worktree-relative tree paths to inspect within the treeish.",
        minItems: 1,
        maxItems: 20,
      },
    ),
  ),
  recursive: Type.Optional(
    Type.Boolean({
      description: "Recurse into subtrees while listing entries.",
    }),
  ),
  treeish: Type.String({
    description: "Commit-ish or tree-ish to inspect.",
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

function normalizeTextList(values: readonly string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => normalizeOptionalText(value))
        .filter((value): value is string => value !== null),
    ),
  ];
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

function splitNulRecords(value: string): string[] {
  if (!value) {
    return [];
  }

  return value.split("\0").filter((record) => record.length > 0);
}

function combineCommandOutput(stdout: string, stderr: string): string | null {
  const parts = [stderr.trim(), stdout.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join("\n") : null;
}

function truncateEntries<T>(
  entries: T[],
  maxEntries: number,
): {
  shownEntries: T[];
  shownEntryCount: number;
  totalEntryCount: number;
  truncatedEntryCount: number | null;
} {
  const shownEntries = entries.slice(0, maxEntries);
  const totalEntryCount = entries.length;
  return {
    shownEntries,
    shownEntryCount: shownEntries.length,
    totalEntryCount,
    truncatedEntryCount:
      totalEntryCount > shownEntries.length
        ? totalEntryCount - shownEntries.length
        : null,
  };
}

function previewOutputText(value: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const firstLine = trimmed.split(/\r?\n/u, 1)[0] ?? "";
  if (!firstLine) {
    return null;
  }

  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
}

function formatBooleanSummary(label: string, value: boolean): string {
  return `${label}: ${value ? "yes" : "no"}`;
}

function formatVerificationEntry(entry: GitVerificationOutcome): string {
  const statusText = entry.verified
    ? "verified"
    : `not verified (exit ${entry.exitCode})`;
  const outputText = previewOutputText(entry.output);
  return outputText
    ? `- ${entry.input}: ${statusText} — ${outputText}`
    : `- ${entry.input}: ${statusText}`;
}

function formatCheckIgnoreEntry(entry: GitCheckIgnoreOutcome): string {
  if (!entry.ignored) {
    return `- ${entry.path}: not ignored`;
  }

  const sourceText = entry.source
    ? `${entry.source}${entry.lineNumber === null ? "" : `:${entry.lineNumber}`}`
    : "unknown source";
  const patternText = entry.pattern ? ` (${entry.pattern})` : "";
  return `- ${entry.path}: ignored by ${sourceText}${patternText}`;
}

function formatCheckAttrEntry(entry: GitCheckAttrOutcome): string {
  const attributeLines =
    entry.attributes.length > 0
      ? entry.attributes.map(
          (attribute) => `  ${attribute.name}: ${attribute.value}`,
        )
      : ["  - none"];
  return [`- ${entry.path}`, ...attributeLines].join("\n");
}

function formatGitLsFilesEntry(entry: GitLsFilesEntry): string {
  const statusText = entry.statusTag ?? "?";
  return `${statusText} ${entry.path}`;
}

function formatGitLsTreeEntry(entry: GitLsTreeEntry): string {
  const sizeText = entry.size === null ? "" : ` ${entry.size}`;
  return `${entry.mode} ${entry.objectType} ${entry.objectHash}${sizeText} ${entry.path}`;
}

function parseGitCheckIgnoreLine(line: string): GitCheckIgnoreOutcome | null {
  const [left = "", path = ""] = line.split("\t", 2);
  if (!path) {
    return null;
  }

  if (left === "::" || left === "") {
    return {
      ignored: false,
      lineNumber: null,
      pattern: null,
      path,
      source: null,
    };
  }

  const firstColonIndex = left.indexOf(":");
  const secondColonIndex = left.indexOf(":", firstColonIndex + 1);
  if (firstColonIndex < 0 || secondColonIndex < 0) {
    return {
      ignored: false,
      lineNumber: null,
      pattern: null,
      path,
      source: null,
    };
  }

  const source = left.slice(0, firstColonIndex).trim();
  const lineNumberText = left
    .slice(firstColonIndex + 1, secondColonIndex)
    .trim();
  const pattern = left.slice(secondColonIndex + 1).trim();
  const parsedLineNumber = Number.parseInt(lineNumberText, 10);

  return {
    ignored: true,
    lineNumber: Number.isFinite(parsedLineNumber) ? parsedLineNumber : null,
    pattern: pattern.length > 0 ? pattern : null,
    path,
    source: source.length > 0 ? source : null,
  };
}

function parseGitCheckAttrLine(
  line: string,
): { attribute: string; path: string; value: string } | null {
  const firstSeparatorIndex = line.indexOf(": ");
  if (firstSeparatorIndex < 0) {
    return null;
  }

  const secondSeparatorIndex = line.indexOf(": ", firstSeparatorIndex + 2);
  if (secondSeparatorIndex < 0) {
    return null;
  }

  return {
    attribute: line.slice(firstSeparatorIndex + 2, secondSeparatorIndex).trim(),
    path: line.slice(0, firstSeparatorIndex).trim(),
    value: line.slice(secondSeparatorIndex + 2).trim(),
  };
}

function parseGitLsFilesRecord(record: string): GitLsFilesEntry | null {
  if (!record) {
    return null;
  }

  const statusTag = record.length > 1 ? record.slice(0, 1) : null;
  const path = record.length > 2 ? record.slice(2) : record.slice(1);
  return {
    path,
    statusTag,
  };
}

function parseGitLsTreeRecord(record: string): GitLsTreeEntry | null {
  const tabIndex = record.indexOf("\t");
  if (tabIndex < 0) {
    return null;
  }

  const metadata = record.slice(0, tabIndex).trim();
  const path = record.slice(tabIndex + 1);
  const metadataParts = metadata.split(/\s+/u).filter(Boolean);
  if (metadataParts.length < 3) {
    return null;
  }

  const [mode = "", objectType = "", objectHash = "", sizeText = ""] =
    metadataParts;
  const parsedSize = Number.parseInt(sizeText, 10);
  return {
    mode,
    objectHash,
    objectType,
    path,
    size:
      Number.isFinite(parsedSize) && sizeText.length > 0 ? parsedSize : null,
  };
}

async function runGitVerificationCommand(
  worktreePath: string,
  input: string,
  commandArgs: string[],
  signal?: AbortSignal,
): Promise<GitVerificationOutcome> {
  const result = await runGitCommandResult(
    worktreePath,
    commandArgs,
    typeof signal === "undefined" ? undefined : { signal },
  );
  const output = combineCommandOutput(result.stdout, result.stderr);
  return {
    input,
    output:
      output ??
      (result.exitCode === 0
        ? null
        : `${commandArgs[0] ?? "git"} exited with code ${result.exitCode}.`),
    exitCode: result.exitCode,
    verified: result.exitCode === 0,
  };
}

function normalizeCheckAttrEntries(
  parsedEntries: Array<{
    attribute: string;
    path: string;
    value: string;
  }>,
): GitCheckAttrOutcome[] {
  const entryMap = new Map<string, GitCheckAttrOutcome>();
  const orderedPaths: string[] = [];

  for (const parsedEntry of parsedEntries) {
    const existingEntry = entryMap.get(parsedEntry.path);
    if (existingEntry) {
      existingEntry.attributes.push({
        name: parsedEntry.attribute,
        value: parsedEntry.value,
      });
      continue;
    }

    entryMap.set(parsedEntry.path, {
      attributes: [
        {
          name: parsedEntry.attribute,
          value: parsedEntry.value,
        },
      ],
      path: parsedEntry.path,
    });
    orderedPaths.push(parsedEntry.path);
  }

  return orderedPaths
    .map((path) => entryMap.get(path))
    .filter((entry): entry is GitCheckAttrOutcome => entry !== undefined);
}

export function createPiGitInspectionTools(
  scope: PiGitToolScope,
  _host: PiGitToolHost,
): ToolDefinition[] {
  return [
    withGitToolTelemetry(
      defineTool({
        description:
          "Verify commit signatures with `commits`, `verbose`, and `raw` controls while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const commits = normalizeTextList(params.commits);
          const raw = params.raw === true;
          const verbose = params.verbose === true;
          const commitResults: GitVerificationOutcome[] = [];

          for (const commit of commits) {
            commitResults.push(
              await runGitVerificationCommand(
                scope.worktreePathContext,
                commit,
                [
                  "verify-commit",
                  ...(raw ? ["--raw"] : []),
                  ...(verbose ? ["--verbose"] : []),
                  commit,
                ],
                signal,
              ),
            );
          }

          const verifiedCount = commitResults.filter(
            (entry) => entry.verified,
          ).length;
          const failedCount = commitResults.length - verifiedCount;
          const textSections = [
            `Git commit verification for ${scope.worktreePathContext}`,
            `Commits: ${commits.join(", ")}`,
            `Verified: ${verifiedCount} of ${commitResults.length}`,
            `Raw: ${raw ? "yes" : "no"}`,
            `Verbose: ${verbose ? "yes" : "no"}`,
            commitResults.length > 0
              ? [
                  "Verification results",
                  commitResults
                    .map((entry) => formatVerificationEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Verification results\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            commitResults,
            commits,
            failedCount,
            raw,
            verifiedCount,
            verbose,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Verify Commit",
        name: "git_verify_commit",
        parameters: GitVerifyCommitToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitVerifyCommitToolParameters>(args, [
            "raw",
            "verbose",
          ]),
        promptGuidelines: [
          "Use this to confirm commit signatures before trusting a history tip.",
        ],
        promptSnippet: "Verify commit signatures",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Verify tag signatures with `tags`, `verbose`, and `raw` controls while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const raw = params.raw === true;
          const tags = normalizeTextList(params.tags);
          const verbose = params.verbose === true;
          const tagResults: GitVerificationOutcome[] = [];

          for (const tag of tags) {
            tagResults.push(
              await runGitVerificationCommand(
                scope.worktreePathContext,
                tag,
                [
                  "verify-tag",
                  ...(raw ? ["--raw"] : []),
                  ...(verbose ? ["--verbose"] : []),
                  tag,
                ],
                signal,
              ),
            );
          }

          const verifiedCount = tagResults.filter(
            (entry) => entry.verified,
          ).length;
          const failedCount = tagResults.length - verifiedCount;
          const textSections = [
            `Git tag verification for ${scope.worktreePathContext}`,
            `Tags: ${tags.join(", ")}`,
            `Verified: ${verifiedCount} of ${tagResults.length}`,
            `Raw: ${raw ? "yes" : "no"}`,
            `Verbose: ${verbose ? "yes" : "no"}`,
            tagResults.length > 0
              ? [
                  "Verification results",
                  tagResults
                    .map((entry) => formatVerificationEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Verification results\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            failedCount,
            raw,
            tagResults,
            tags,
            verifiedCount,
            verbose,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Verify Tag",
        name: "git_verify_tag",
        parameters: GitVerifyTagToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitVerifyTagToolParameters>(args, [
            "raw",
            "verbose",
          ]),
        promptGuidelines: [
          "Use this to confirm release or annotation signatures before trusting a tag.",
        ],
        promptSnippet: "Verify tag signatures",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Check ignore rules for `paths` with optional `includeIndex` control while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const includeIndex = params.includeIndex !== false;
          const paths = normalizeGitPathArguments(
            scope.worktreePathContext,
            params.paths,
          );
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            [
              "check-ignore",
              "-v",
              "-n",
              includeIndex ? "--index" : "--no-index",
              "--",
              ...paths,
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode > 1) {
            throw new Error(
              result.stderr ||
                `git check-ignore exited with code ${result.exitCode}`,
            );
          }

          const parsedResults = new Map<string, GitCheckIgnoreOutcome>();
          for (const line of splitTextLines(result.stdout)) {
            const parsedLine = parseGitCheckIgnoreLine(line);
            if (parsedLine) {
              parsedResults.set(parsedLine.path, parsedLine);
            }
          }

          const pathResults = paths.map(
            (path) =>
              parsedResults.get(path) ?? {
                ignored: false,
                lineNumber: null,
                pattern: null,
                path,
                source: null,
              },
          );
          const ignoredCount = pathResults.filter(
            (entry) => entry.ignored,
          ).length;
          const textSections = [
            `Git ignore check for ${scope.worktreePathContext}`,
            `Paths: ${paths.join(", ")}`,
            `Include index: ${includeIndex ? "yes" : "no"}`,
            `Ignored: ${ignoredCount} of ${pathResults.length}`,
            pathResults.length > 0
              ? [
                  "Ignore results",
                  pathResults
                    .map((entry) => formatCheckIgnoreEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Ignore results\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            ignoredCount,
            includeIndex,
            pathCount: pathResults.length,
            paths,
            results: pathResults,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Check Ignore",
        name: "git_check_ignore",
        parameters: GitCheckIgnoreToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCheckIgnoreToolParameters>(args, [
            "includeIndex",
          ]),
        promptGuidelines: [
          "Use this to explain whether a specific file or directory is ignored by Git.",
        ],
        promptSnippet: "Check ignore rules for paths",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "Check attributes for `paths` with `attributes`, `all`, and `cached` controls while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const attributes = normalizeTextList(params.attributes ?? []);
          const cached = params.cached === true;
          const useAll = params.all === true || attributes.length === 0;
          const args = [
            "check-attr",
            ...(cached ? ["--cached"] : []),
            ...(useAll ? ["--all"] : attributes),
            "--",
            ...normalizeGitPathArguments(
              scope.worktreePathContext,
              params.paths,
            ),
          ];
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            args,
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr ||
                `git check-attr exited with code ${result.exitCode}`,
            );
          }

          const parsedResults = normalizeCheckAttrEntries(
            splitTextLines(result.stdout)
              .map((line) => parseGitCheckAttrLine(line))
              .filter(
                (
                  value,
                ): value is {
                  attribute: string;
                  path: string;
                  value: string;
                } => value !== null,
              ),
          );
          const attributeCount = parsedResults.reduce(
            (count, entry) => count + entry.attributes.length,
            0,
          );
          const textSections = [
            `Git attribute check for ${scope.worktreePathContext}`,
            `Paths: ${normalizeGitPathArguments(
              scope.worktreePathContext,
              params.paths,
            ).join(", ")}`,
            `Cached: ${cached ? "yes" : "no"}`,
            `All attributes: ${useAll ? "yes" : "no"}`,
            `Attribute values: ${attributeCount}`,
            parsedResults.length > 0
              ? [
                  "Attribute results",
                  parsedResults
                    .map((entry) => formatCheckAttrEntry(entry))
                    .join("\n\n"),
                ].join("\n\n")
              : "Attribute results\n\n- none",
          ];

          return textToolResult(textSections.join("\n\n"), {
            all: useAll,
            attributeCount,
            attributes,
            cached,
            pathCount: parsedResults.length,
            paths: normalizeGitPathArguments(
              scope.worktreePathContext,
              params.paths,
            ),
            results: parsedResults,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Check Attr",
        name: "git_check_attr",
        parameters: GitCheckAttrToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitCheckAttrToolParameters>(args, [
            "all",
            "cached",
          ]),
        promptGuidelines: [
          "Use this to inspect attribute values before relying on line-ending, diff, or export behavior.",
        ],
        promptSnippet: "Check attributes for paths",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "List index and working-tree files with `cached`, `deleted`, `modified`, `others`, `ignored`, `unmerged`, `deduplicate`, and `includeDirectories` controls.",
        execute: async (_toolCallId, params, signal) => {
          const cached = params.cached !== false;
          const deleted = params.deleted === true;
          const deduplicate = params.deduplicate !== false;
          const includeDirectories = params.includeDirectories === true;
          const ignored = params.ignored === true;
          const modified = params.modified !== false;
          const others = params.others !== false;
          const unmerged = params.unmerged === true;
          const excludeStandard = params.excludeStandard ?? (others || ignored);
          const pathFilters = params.paths
            ? normalizeGitPathArguments(scope.worktreePathContext, params.paths)
            : [];
          const maxEntries = normalizePositiveInteger(
            params.maxEntries,
            200,
            1,
            2_000,
          );
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            [
              "ls-files",
              "-z",
              "-t",
              "--full-name",
              ...(cached ? ["--cached"] : []),
              ...(deleted ? ["--deleted"] : []),
              ...(deduplicate ? ["--deduplicate"] : []),
              ...(includeDirectories ? ["--directory"] : []),
              ...(ignored ? ["--ignored"] : []),
              ...(modified ? ["--modified"] : []),
              ...(others ? ["--others"] : []),
              ...(unmerged ? ["--unmerged"] : []),
              ...(excludeStandard ? ["--exclude-standard"] : []),
              ...(pathFilters.length > 0 ? ["--", ...pathFilters] : []),
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr ||
                `git ls-files exited with code ${result.exitCode}`,
            );
          }

          const parsedEntries = splitNulRecords(result.stdout)
            .map((record) => parseGitLsFilesRecord(record))
            .filter((entry): entry is GitLsFilesEntry => entry !== null);
          const {
            shownEntries,
            shownEntryCount,
            totalEntryCount,
            truncatedEntryCount,
          } = truncateEntries(parsedEntries, maxEntries);
          const enabledModes = [
            cached ? "cached" : null,
            deleted ? "deleted" : null,
            ignored ? "ignored" : null,
            includeDirectories ? "directories" : null,
            modified ? "modified" : null,
            others ? "others" : null,
            unmerged ? "unmerged" : null,
          ].filter((value): value is string => value !== null);
          const textSections = [
            `Git ls-files for ${scope.worktreePathContext}`,
            `Modes: ${enabledModes.join(", ")}`,
            `Path filters: ${pathFilters.length > 0 ? pathFilters.join(", ") : "none"}`,
            `Showing ${shownEntryCount} of ${totalEntryCount} entry(s) with limit ${maxEntries}.`,
            shownEntries.length > 0
              ? [
                  "Entries",
                  shownEntries
                    .map((entry) => formatGitLsFilesEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Entries\n\n- none",
          ];
          if (truncatedEntryCount !== null) {
            textSections.push(
              `Truncated: ${truncatedEntryCount} additional entry(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            cached,
            deleted,
            deduplicate,
            excludeStandard,
            includeDirectories,
            ignored,
            maxEntries,
            modified,
            others,
            pathCount: pathFilters.length,
            paths: pathFilters,
            results: shownEntries,
            shownEntryCount,
            totalEntryCount,
            truncatedEntryCount,
            unmerged,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Ls Files",
        name: "git_ls_files",
        parameters: GitLsFilesToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitLsFilesToolParameters>(
            args,
            [
              "cached",
              "deleted",
              "deduplicate",
              "excludeStandard",
              "includeDirectories",
              "ignored",
              "modified",
              "others",
              "unmerged",
            ],
            ["maxEntries"],
          ),
        promptGuidelines: [
          "Use this to inspect which files Git currently knows about before staging, cleaning, or diffing.",
        ],
        promptSnippet: "List index and worktree files",
      }),
    ),
    withGitToolTelemetry(
      defineTool({
        description:
          "List tree entries for `treeish` with `paths`, `recursive`, `long`, and `maxEntries` controls while staying bound to the active worktree.",
        execute: async (_toolCallId, params, signal) => {
          const pathFilters = params.paths
            ? normalizeGitPathArguments(scope.worktreePathContext, params.paths)
            : [];
          const recursive = params.recursive === true;
          const long = params.long === true;
          const maxEntries = normalizePositiveInteger(
            params.maxEntries,
            200,
            1,
            2_000,
          );
          const result = await runGitCommandResult(
            scope.worktreePathContext,
            [
              "ls-tree",
              "-z",
              ...(recursive ? ["-r", "-t"] : []),
              ...(long ? ["-l"] : []),
              "--full-name",
              params.treeish,
              ...(pathFilters.length > 0 ? pathFilters : []),
            ],
            typeof signal === "undefined" ? undefined : { signal },
          );

          if (result.exitCode !== 0) {
            throw new Error(
              result.stderr ||
                `git ls-tree exited with code ${result.exitCode}`,
            );
          }

          const parsedEntries = splitNulRecords(result.stdout)
            .map((record) => parseGitLsTreeRecord(record))
            .filter((entry): entry is GitLsTreeEntry => entry !== null);
          const {
            shownEntries,
            shownEntryCount,
            totalEntryCount,
            truncatedEntryCount,
          } = truncateEntries(parsedEntries, maxEntries);
          const textSections = [
            `Git tree listing for ${scope.worktreePathContext}`,
            `Treeish: ${params.treeish}`,
            formatBooleanSummary("Recursive", recursive),
            formatBooleanSummary("Long", long),
            `Path filters: ${pathFilters.length > 0 ? pathFilters.join(", ") : "none"}`,
            `Showing ${shownEntryCount} of ${totalEntryCount} entry(s) with limit ${maxEntries}.`,
            shownEntries.length > 0
              ? [
                  "Entries",
                  shownEntries
                    .map((entry) => formatGitLsTreeEntry(entry))
                    .join("\n"),
                ].join("\n\n")
              : "Entries\n\n- none",
          ];
          if (truncatedEntryCount !== null) {
            textSections.push(
              `Truncated: ${truncatedEntryCount} additional entry(s) not shown.`,
            );
          }

          return textToolResult(textSections.join("\n\n"), {
            long,
            maxEntries,
            pathCount: pathFilters.length,
            paths: pathFilters,
            recursive,
            results: shownEntries,
            shownEntryCount,
            totalEntryCount,
            truncatedEntryCount,
            treeish: params.treeish,
            worktreePath: scope.worktreePathContext,
          });
        },
        label: "Git Ls Tree",
        name: "git_ls_tree",
        parameters: GitLsTreeToolParameters,
        prepareArguments: (args) =>
          prepareGitToolArguments<typeof GitLsTreeToolParameters>(
            args,
            ["long", "recursive"],
            ["maxEntries"],
          ),
        promptGuidelines: [
          "Use this to inspect the contents of a commit or tree without checking it out.",
        ],
        promptSnippet: "List tree entries for a revision",
      }),
    ),
  ];
}
