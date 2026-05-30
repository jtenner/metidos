/**
 * @file src/bun/pi/github-tools.ts
 * @description Pi-native GitHub tool definitions backed by the local GitHub CLI.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";

import { buildGitSpawnEnv } from "../git";
import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { type Static, type TSchema, Type } from "@sinclair/typebox";

type GitHubRepoContext = {
  defaultBranch: string | null;
  description: string | null;
  isPrivate: boolean;
  repoFullName: string;
  url: string;
  viewerPermission: string | null;
};

type GitHubComment = {
  authorLogin: string | null;
  body: string;
  createdAt: string | null;
  id: number;
  kind: "issue_comment" | "review_comment";
  path: string | null;
  url: string;
};

type GitHubReview = {
  authorLogin: string | null;
  body: string;
  id: number;
  state: string;
  submittedAt: string | null;
  url: string;
};

type GitHubIssueView = GitHubRepoContext & {
  assigneeLogins: string[];
  authorLogin: string | null;
  body: string;
  closedAt: string | null;
  comments: GitHubComment[];
  issueUrl: string;
  isPullRequest: boolean;
  issueNumber: number;
  labelNames: string[];
  state: string;
  title: string;
  totalCommentCount: number;
  updatedAt: string | null;
};

type GitHubPullRequestFile = {
  additions: number;
  deletions: number;
  path: string;
  status: string;
};

type GitHubPullRequestView = GitHubRepoContext & {
  additions: number;
  authorLogin: string | null;
  baseRefName: string;
  body: string;
  changedFiles: GitHubPullRequestFile[];
  closedAt: string | null;
  comments: GitHubComment[];
  commitsCount: number;
  deletions: number;
  headRefName: string;
  headSha: string;
  isDraft: boolean;
  labelNames: string[];
  mergeableState: string | null;
  prNumber: number;
  prUrl: string;
  requestedReviewerLogins: string[];
  reviewComments: GitHubComment[];
  reviewDecision: string | null;
  reviews: GitHubReview[];
  state: string;
  title: string;
  totalChangedFileCount: number;
  totalCommentCount: number;
  totalReviewCommentCount: number;
  totalReviewCount: number;
  updatedAt: string | null;
};

type GitHubStatusContext = {
  context: string;
  description: string | null;
  state: string;
  targetUrl: string | null;
};

type GitHubCheckRun = {
  appName: string | null;
  completedAt: string | null;
  conclusion: string | null;
  detailsUrl: string | null;
  name: string;
  startedAt: string | null;
  status: string;
};

type GitHubPullRequestChecks = GitHubRepoContext & {
  checkRuns: GitHubCheckRun[];
  headSha: string;
  overallState: string;
  prNumber: number;
  statusContexts: GitHubStatusContext[];
};

type GitHubPullRequestDiff = GitHubRepoContext & {
  diff: string;
  prNumber: number;
};

export type PiGitHubToolScope = {
  worktreePathContext: string;
};

export type PiGitHubToolHost = {
  getIssue: (
    issueNumber: number,
    options?: {
      commentsLimit?: number;
      includeComments?: boolean;
    },
    signal?: AbortSignal,
  ) => Promise<GitHubIssueView>;
  getPullRequest: (
    prNumber: number,
    options?: {
      commentsLimit?: number;
      filesLimit?: number;
      includeComments?: boolean;
      includeFiles?: boolean;
      includeReviews?: boolean;
      reviewsLimit?: number;
    },
    signal?: AbortSignal,
  ) => Promise<GitHubPullRequestView>;
  getPullRequestChecks: (
    prNumber: number,
    signal?: AbortSignal,
  ) => Promise<GitHubPullRequestChecks>;
  getPullRequestDiff: (
    prNumber: number,
    signal?: AbortSignal,
  ) => Promise<GitHubPullRequestDiff>;
  getRepositoryContext: (signal?: AbortSignal) => Promise<GitHubRepoContext>;
};

type GitHubApiUser = {
  login?: string | null;
};

type GitHubApiLabel = {
  name?: string | null;
};

type GitHubApiIssue = {
  assignees?: GitHubApiUser[] | null;
  body?: string | null;
  closed_at?: string | null;
  comments?: number | null;
  html_url?: string | null;
  labels?: GitHubApiLabel[] | null;
  number?: number | null;
  pull_request?: object | null;
  state?: string | null;
  title?: string | null;
  updated_at?: string | null;
  user?: GitHubApiUser | null;
};

type GitHubApiComment = {
  body?: string | null;
  created_at?: string | null;
  html_url?: string | null;
  id?: number | null;
  path?: string | null;
  user?: GitHubApiUser | null;
};

type GitHubApiRepoView = {
  defaultBranchRef?: {
    name?: string | null;
  } | null;
  description?: string | null;
  isPrivate?: boolean | null;
  nameWithOwner?: string | null;
  url?: string | null;
  viewerPermission?: string | null;
};

type GitHubApiPullRequest = {
  additions?: number | null;
  base?: {
    ref?: string | null;
  } | null;
  body?: string | null;
  changed_files?: number | null;
  closed_at?: string | null;
  comments?: number | null;
  commits?: number | null;
  deletions?: number | null;
  draft?: boolean | null;
  head?: {
    ref?: string | null;
    sha?: string | null;
  } | null;
  html_url?: string | null;
  labels?: GitHubApiLabel[] | null;
  mergeable_state?: string | null;
  number?: number | null;
  requested_reviewers?: GitHubApiUser[] | null;
  review_comments?: number | null;
  review_decision?: string | null;
  state?: string | null;
  title?: string | null;
  updated_at?: string | null;
  user?: GitHubApiUser | null;
};

type GitHubApiPullRequestFile = {
  additions?: number | null;
  deletions?: number | null;
  filename?: string | null;
  status?: string | null;
};

type GitHubApiPullRequestReview = {
  body?: string | null;
  html_url?: string | null;
  id?: number | null;
  state?: string | null;
  submitted_at?: string | null;
  user?: GitHubApiUser | null;
};

type GitHubApiCombinedStatus = {
  state?: string | null;
  statuses?: Array<{
    context?: string | null;
    description?: string | null;
    state?: string | null;
    target_url?: string | null;
  }> | null;
};

type GitHubApiCheckRuns = {
  check_runs?: Array<{
    app?: {
      name?: string | null;
    } | null;
    completed_at?: string | null;
    conclusion?: string | null;
    details_url?: string | null;
    name?: string | null;
    started_at?: string | null;
    status?: string | null;
  }> | null;
};

const GH_EXECUTABLE_FALLBACK_DIRECTORIES =
  process.platform === "darwin"
    ? ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"]
    : process.platform === "win32"
      ? ["C:\\Program Files\\GitHub CLI", "C:\\Program Files (x86)\\GitHub CLI"]
      : ["/usr/local/bin", "/usr/bin", "/bin"];

const PositiveInteger = Type.Integer({
  minimum: 1,
});
const LimitedPositiveInteger = Type.Integer({
  maximum: 100,
  minimum: 1,
});
const GitHubIssueParameters = Type.Object({
  commentsLimit: Type.Optional(
    Type.Union([
      LimitedPositiveInteger,
      Type.Null({
        description:
          "Optional maximum number of issue comments to include when includeComments=true.",
      }),
    ]),
  ),
  includeComments: Type.Optional(
    Type.Boolean({
      description: "When true, include recent issue comments in the result.",
    }),
  ),
  issueNumber: PositiveInteger,
});
const GitHubPullRequestParameters = Type.Object({
  commentsLimit: Type.Optional(
    Type.Union([
      LimitedPositiveInteger,
      Type.Null({
        description:
          "Optional maximum number of issue-thread comments to include when includeComments=true.",
      }),
    ]),
  ),
  filesLimit: Type.Optional(
    Type.Union([
      LimitedPositiveInteger,
      Type.Null({
        description:
          "Optional maximum number of changed files to include when includeFiles=true.",
      }),
    ]),
  ),
  includeComments: Type.Optional(
    Type.Boolean({
      description:
        "When true, include recent pull-request issue comments and review comments.",
    }),
  ),
  includeFiles: Type.Optional(
    Type.Boolean({
      description: "When true, include changed-file summaries.",
    }),
  ),
  includeReviews: Type.Optional(
    Type.Boolean({
      description: "When true, include recent review summaries.",
    }),
  ),
  prNumber: PositiveInteger,
  reviewsLimit: Type.Optional(
    Type.Union([
      LimitedPositiveInteger,
      Type.Null({
        description:
          "Optional maximum number of reviews to include when includeReviews=true.",
      }),
    ]),
  ),
});
const GitHubPullRequestChecksParameters = Type.Object({
  prNumber: PositiveInteger,
});
const GitHubPullRequestDiffParameters = Type.Object({
  maxLines: Type.Optional(
    Type.Union([
      Type.Integer({
        maximum: 1000,
        minimum: 1,
      }),
      Type.Null({
        description:
          "Optional maximum number of diff lines to include in the tool output.",
      }),
    ]),
  ),
  prNumber: PositiveInteger,
});

function safeIsExecutableFile(path: string): boolean {
  try {
    const stats = statSync(path);
    if (!stats.isFile()) {
      return false;
    }
    return process.platform === "win32" || (stats.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function resolveGitHubCliPath(): string {
  const discoveredPath = Bun.which("gh");
  if (discoveredPath && safeIsExecutableFile(discoveredPath)) {
    return discoveredPath;
  }

  for (const directory of GH_EXECUTABLE_FALLBACK_DIRECTORIES) {
    const executableName = process.platform === "win32" ? "gh.exe" : "gh";
    const candidatePath = resolve(directory, executableName);
    if (safeIsExecutableFile(candidatePath)) {
      return candidatePath;
    }
  }

  throw new Error(
    "Could not locate the GitHub CLI. Install `gh` and ensure it is available on PATH.",
  );
}

function createGitHubCliFailureMessage(result: {
  exitCode: number;
  stderr: string;
  stdout: string;
}): string {
  const rawMessage = result.stderr.trim() || result.stdout.trim();
  if (!rawMessage) {
    return `GitHub CLI command failed with exit code ${result.exitCode}.`;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      message?: string;
      status?: number;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return typeof parsed.status === "number"
        ? `${parsed.message.trim()} (GitHub API status ${parsed.status})`
        : parsed.message.trim();
    }
  } catch {
    // Fall through to the raw stderr/stdout text.
  }

  return rawMessage;
}

async function runGitHubCliCommand(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<string> {
  const proc = Bun.spawn({
    cmd: [resolveGitHubCliPath(), ...args],
    cwd,
    env: buildGitSpawnEnv(process.env),
    stderr: "pipe",
    stdout: "pipe",
    ...(signal ? { signal } : {}),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      createGitHubCliFailureMessage({
        exitCode,
        stderr,
        stdout,
      }),
    );
  }

  return stdout;
}

async function runGitHubCliJson<T>(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
): Promise<T> {
  const raw = await runGitHubCliCommand(cwd, args, signal);
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `GitHub CLI returned invalid JSON for ${args.join(" ")}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function buildGitHubApiPath(
  path: string,
  query?: Record<string, boolean | number | string | null | undefined>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || typeof value === "undefined") {
      continue;
    }
    searchParams.set(key, String(value));
  }

  const encodedPath = path.replace(/^\/+/u, "");
  const queryString = searchParams.toString();
  return queryString ? `${encodedPath}?${queryString}` : encodedPath;
}

function normalizeLogin(user?: GitHubApiUser | null): string | null {
  return typeof user?.login === "string" && user.login.trim()
    ? user.login.trim()
    : null;
}

function normalizeLabels(labels?: GitHubApiLabel[] | null): string[] {
  return (labels ?? [])
    .map((label) =>
      typeof label.name === "string" && label.name.trim()
        ? label.name.trim()
        : null,
    )
    .filter((value): value is string => value !== null);
}

function normalizeComment(
  raw: GitHubApiComment,
  kind: GitHubComment["kind"],
): GitHubComment {
  return {
    authorLogin: normalizeLogin(raw.user),
    body: typeof raw.body === "string" ? raw.body : "",
    createdAt:
      typeof raw.created_at === "string" && raw.created_at.trim()
        ? raw.created_at
        : null,
    id: typeof raw.id === "number" ? raw.id : 0,
    kind,
    path:
      typeof raw.path === "string" && raw.path.trim() ? raw.path.trim() : null,
    url:
      typeof raw.html_url === "string" && raw.html_url.trim()
        ? raw.html_url
        : "",
  };
}

function normalizeReview(raw: GitHubApiPullRequestReview): GitHubReview {
  return {
    authorLogin: normalizeLogin(raw.user),
    body: typeof raw.body === "string" ? raw.body : "",
    id: typeof raw.id === "number" ? raw.id : 0,
    state:
      typeof raw.state === "string" && raw.state.trim()
        ? raw.state.trim()
        : "UNKNOWN",
    submittedAt:
      typeof raw.submitted_at === "string" && raw.submitted_at.trim()
        ? raw.submitted_at
        : null,
    url:
      typeof raw.html_url === "string" && raw.html_url.trim()
        ? raw.html_url
        : "",
  };
}

function normalizeRepositoryContext(raw: GitHubApiRepoView): GitHubRepoContext {
  if (
    typeof raw.nameWithOwner !== "string" ||
    !raw.nameWithOwner.trim() ||
    typeof raw.url !== "string" ||
    !raw.url.trim()
  ) {
    throw new Error(
      "GitHub CLI could not resolve the repository owning the current workspace.",
    );
  }

  return {
    defaultBranch:
      typeof raw.defaultBranchRef?.name === "string" &&
      raw.defaultBranchRef.name.trim()
        ? raw.defaultBranchRef.name.trim()
        : null,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description
        : null,
    isPrivate: raw.isPrivate === true,
    repoFullName: raw.nameWithOwner.trim(),
    url: raw.url.trim(),
    viewerPermission:
      typeof raw.viewerPermission === "string" && raw.viewerPermission.trim()
        ? raw.viewerPermission.trim()
        : null,
  };
}

function textToolResult<TDetails>(
  text: string,
  details: TDetails,
): AgentToolResult<TDetails> {
  return {
    content: [{ text, type: "text" as const }],
    details,
  };
}

function coerceBooleanLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return value;
}

function coercePositiveIntegerLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d+$/u.test(normalized)) {
    return value;
  }
  return Number.parseInt(normalized, 10);
}

function prepareToolArguments<TParams extends TSchema>(
  value: unknown,
  booleanKeys: readonly string[],
  integerKeys: readonly string[],
): Static<TParams> {
  if (!value || typeof value !== "object") {
    return value as Static<TParams>;
  }

  const record = { ...(value as Record<string, unknown>) };
  for (const key of booleanKeys) {
    record[key] = coerceBooleanLikeInput(record[key]);
  }
  for (const key of integerKeys) {
    record[key] = coercePositiveIntegerLikeInput(record[key]);
  }
  return record as Static<TParams>;
}

function formatList(label: string, values: string[]): string {
  return `${label}: ${values.length ? values.join(", ") : "(none)"}`;
}

function formatBody(body: string): string[] {
  const normalizedBody = body.trim() || "(empty)";
  return [
    "Body:",
    ...normalizedBody.split(/\r?\n/u).map((line) => `  ${line}`),
  ];
}

function formatCommentsSection(
  title: string,
  comments: GitHubComment[],
  totalCount: number,
): string[] {
  if (comments.length === 0) {
    return [`${title}: (none)`];
  }

  const lines = [`${title}: showing ${comments.length} of ${totalCount}`];
  for (const comment of comments) {
    lines.push(
      `- [${comment.kind} ${comment.id}] ${comment.authorLogin ?? "unknown"} at ${comment.createdAt ?? "unknown"}`,
    );
    if (comment.path) {
      lines.push(`  Path: ${comment.path}`);
    }
    if (comment.url) {
      lines.push(`  URL: ${comment.url}`);
    }
    for (const bodyLine of (comment.body.trim() || "(empty)").split(/\r?\n/u)) {
      lines.push(`  ${bodyLine}`);
    }
  }
  return lines;
}

function formatReviewsSection(
  reviews: GitHubReview[],
  totalCount: number,
): string[] {
  if (reviews.length === 0) {
    return ["Reviews: (none)"];
  }

  const lines = [`Reviews: showing ${reviews.length} of ${totalCount}`];
  for (const review of reviews) {
    lines.push(
      `- [${review.id}] ${review.state} by ${review.authorLogin ?? "unknown"} at ${review.submittedAt ?? "unknown"}`,
    );
    if (review.url) {
      lines.push(`  URL: ${review.url}`);
    }
    for (const bodyLine of (review.body.trim() || "(empty)").split(/\r?\n/u)) {
      lines.push(`  ${bodyLine}`);
    }
  }
  return lines;
}

function formatFilesSection(
  files: GitHubPullRequestFile[],
  totalCount: number,
): string[] {
  if (files.length === 0) {
    return ["Files: (none)"];
  }

  return [
    `Files: showing ${files.length} of ${totalCount}`,
    ...files.map(
      (file) =>
        `- ${file.path} (${file.status}, +${file.additions} -${file.deletions})`,
    ),
  ];
}

function truncateTextLines(
  text: string,
  maxLines: number,
): {
  shownLineCount: number;
  totalLineCount: number;
  truncated: boolean;
  truncatedText: string;
} {
  const normalized = text.replace(/\r\n/gu, "\n");
  const lines = normalized.split("\n");
  const shownLines = lines.slice(0, maxLines);
  return {
    shownLineCount: shownLines.length,
    totalLineCount: lines.length,
    truncated: lines.length > maxLines,
    truncatedText: shownLines.join("\n"),
  };
}

export function createPiGitHubCliHost(worktreePath: string): PiGitHubToolHost {
  async function getRepositoryContext(
    signal?: AbortSignal,
  ): Promise<GitHubRepoContext> {
    const raw = await runGitHubCliJson<GitHubApiRepoView>(
      worktreePath,
      [
        "repo",
        "view",
        "--json",
        "nameWithOwner,url,description,defaultBranchRef,isPrivate,viewerPermission",
      ],
      signal,
    );
    return normalizeRepositoryContext(raw);
  }

  async function getIssueView(
    issueNumber: number,
    options?: {
      commentsLimit?: number;
      includeComments?: boolean;
    },
    signal?: AbortSignal,
  ): Promise<GitHubIssueView> {
    const repo = await getRepositoryContext(signal);
    const issue = await runGitHubCliJson<GitHubApiIssue>(
      worktreePath,
      [
        "api",
        buildGitHubApiPath(`repos/${repo.repoFullName}/issues/${issueNumber}`),
      ],
      signal,
    );
    const includeComments = options?.includeComments === true;
    const commentsLimit =
      typeof options?.commentsLimit === "number" ? options.commentsLimit : 10;
    const comments = includeComments
      ? await runGitHubCliJson<GitHubApiComment[]>(
          worktreePath,
          [
            "api",
            buildGitHubApiPath(
              `repos/${repo.repoFullName}/issues/${issueNumber}/comments`,
              {
                per_page: commentsLimit,
              },
            ),
          ],
          signal,
        )
      : [];

    return {
      ...repo,
      assigneeLogins: (issue.assignees ?? [])
        .map((assignee) => normalizeLogin(assignee))
        .filter((value): value is string => value !== null),
      authorLogin: normalizeLogin(issue.user),
      body: typeof issue.body === "string" ? issue.body : "",
      closedAt:
        typeof issue.closed_at === "string" && issue.closed_at.trim()
          ? issue.closed_at
          : null,
      comments: comments.map((comment) =>
        normalizeComment(comment, "issue_comment"),
      ),
      isPullRequest: issue.pull_request !== null && !!issue.pull_request,
      issueNumber:
        typeof issue.number === "number" ? issue.number : issueNumber,
      issueUrl:
        typeof issue.html_url === "string" && issue.html_url.trim()
          ? issue.html_url.trim()
          : `${repo.url}/issues/${issueNumber}`,
      labelNames: normalizeLabels(issue.labels),
      state:
        typeof issue.state === "string" && issue.state.trim()
          ? issue.state.trim()
          : "unknown",
      title:
        typeof issue.title === "string" && issue.title.trim()
          ? issue.title
          : `Issue #${issueNumber}`,
      totalCommentCount:
        typeof issue.comments === "number" && issue.comments >= 0
          ? issue.comments
          : comments.length,
      updatedAt:
        typeof issue.updated_at === "string" && issue.updated_at.trim()
          ? issue.updated_at
          : null,
    };
  }

  async function getPullRequestView(
    prNumber: number,
    options?: {
      commentsLimit?: number;
      filesLimit?: number;
      includeComments?: boolean;
      includeFiles?: boolean;
      includeReviews?: boolean;
      reviewsLimit?: number;
    },
    signal?: AbortSignal,
  ): Promise<GitHubPullRequestView> {
    const repo = await getRepositoryContext(signal);
    const pullRequest = await runGitHubCliJson<GitHubApiPullRequest>(
      worktreePath,
      [
        "api",
        buildGitHubApiPath(`repos/${repo.repoFullName}/pulls/${prNumber}`),
      ],
      signal,
    );
    const includeComments = options?.includeComments === true;
    const includeFiles = options?.includeFiles === true;
    const includeReviews = options?.includeReviews === true;
    const commentsLimit =
      typeof options?.commentsLimit === "number" ? options.commentsLimit : 10;
    const filesLimit =
      typeof options?.filesLimit === "number" ? options.filesLimit : 25;
    const reviewsLimit =
      typeof options?.reviewsLimit === "number" ? options.reviewsLimit : 10;
    const [issueComments, reviewComments, files, reviews] = await Promise.all([
      includeComments
        ? runGitHubCliJson<GitHubApiComment[]>(
            worktreePath,
            [
              "api",
              buildGitHubApiPath(
                `repos/${repo.repoFullName}/issues/${prNumber}/comments`,
                {
                  per_page: commentsLimit,
                },
              ),
            ],
            signal,
          )
        : Promise.resolve([] as GitHubApiComment[]),
      includeComments
        ? runGitHubCliJson<GitHubApiComment[]>(
            worktreePath,
            [
              "api",
              buildGitHubApiPath(
                `repos/${repo.repoFullName}/pulls/${prNumber}/comments`,
                {
                  per_page: commentsLimit,
                },
              ),
            ],
            signal,
          )
        : Promise.resolve([] as GitHubApiComment[]),
      includeFiles
        ? runGitHubCliJson<GitHubApiPullRequestFile[]>(
            worktreePath,
            [
              "api",
              buildGitHubApiPath(
                `repos/${repo.repoFullName}/pulls/${prNumber}/files`,
                {
                  per_page: filesLimit,
                },
              ),
            ],
            signal,
          )
        : Promise.resolve([] as GitHubApiPullRequestFile[]),
      includeReviews
        ? runGitHubCliJson<GitHubApiPullRequestReview[]>(
            worktreePath,
            [
              "api",
              buildGitHubApiPath(
                `repos/${repo.repoFullName}/pulls/${prNumber}/reviews`,
                {
                  per_page: reviewsLimit,
                },
              ),
            ],
            signal,
          )
        : Promise.resolve([] as GitHubApiPullRequestReview[]),
    ]);

    return {
      ...repo,
      additions:
        typeof pullRequest.additions === "number" ? pullRequest.additions : 0,
      authorLogin: normalizeLogin(pullRequest.user),
      baseRefName:
        typeof pullRequest.base?.ref === "string" && pullRequest.base.ref.trim()
          ? pullRequest.base.ref.trim()
          : "unknown",
      body: typeof pullRequest.body === "string" ? pullRequest.body : "",
      changedFiles: files.map((file) => ({
        additions: typeof file.additions === "number" ? file.additions : 0,
        deletions: typeof file.deletions === "number" ? file.deletions : 0,
        path:
          typeof file.filename === "string" && file.filename.trim()
            ? file.filename.trim()
            : "(unknown)",
        status:
          typeof file.status === "string" && file.status.trim()
            ? file.status.trim()
            : "unknown",
      })),
      closedAt:
        typeof pullRequest.closed_at === "string" &&
        pullRequest.closed_at.trim()
          ? pullRequest.closed_at
          : null,
      comments: issueComments.map((comment) =>
        normalizeComment(comment, "issue_comment"),
      ),
      commitsCount:
        typeof pullRequest.commits === "number" ? pullRequest.commits : 0,
      deletions:
        typeof pullRequest.deletions === "number" ? pullRequest.deletions : 0,
      headRefName:
        typeof pullRequest.head?.ref === "string" && pullRequest.head.ref.trim()
          ? pullRequest.head.ref.trim()
          : "unknown",
      headSha:
        typeof pullRequest.head?.sha === "string" && pullRequest.head.sha.trim()
          ? pullRequest.head.sha.trim()
          : "",
      isDraft: pullRequest.draft === true,
      labelNames: normalizeLabels(pullRequest.labels),
      mergeableState:
        typeof pullRequest.mergeable_state === "string" &&
        pullRequest.mergeable_state.trim()
          ? pullRequest.mergeable_state.trim()
          : null,
      prNumber:
        typeof pullRequest.number === "number" ? pullRequest.number : prNumber,
      prUrl:
        typeof pullRequest.html_url === "string" && pullRequest.html_url.trim()
          ? pullRequest.html_url.trim()
          : `${repo.url}/pull/${prNumber}`,
      requestedReviewerLogins: (pullRequest.requested_reviewers ?? [])
        .map((reviewer) => normalizeLogin(reviewer))
        .filter((value): value is string => value !== null),
      reviewComments: reviewComments.map((comment) =>
        normalizeComment(comment, "review_comment"),
      ),
      reviewDecision:
        typeof pullRequest.review_decision === "string" &&
        pullRequest.review_decision.trim()
          ? pullRequest.review_decision.trim()
          : null,
      reviews: reviews.map((review) => normalizeReview(review)),
      state:
        typeof pullRequest.state === "string" && pullRequest.state.trim()
          ? pullRequest.state.trim()
          : "unknown",
      title:
        typeof pullRequest.title === "string" && pullRequest.title.trim()
          ? pullRequest.title
          : `PR #${prNumber}`,
      totalChangedFileCount:
        typeof pullRequest.changed_files === "number"
          ? pullRequest.changed_files
          : files.length,
      totalCommentCount:
        typeof pullRequest.comments === "number"
          ? pullRequest.comments
          : issueComments.length,
      totalReviewCommentCount:
        typeof pullRequest.review_comments === "number"
          ? pullRequest.review_comments
          : reviewComments.length,
      totalReviewCount: reviews.length,
      updatedAt:
        typeof pullRequest.updated_at === "string" &&
        pullRequest.updated_at.trim()
          ? pullRequest.updated_at
          : null,
    };
  }

  return {
    getIssue: getIssueView,
    getPullRequest: getPullRequestView,
    getPullRequestChecks: async (prNumber, signal) => {
      const pullRequest = await getPullRequestView(prNumber, undefined, signal);
      if (!pullRequest.headSha) {
        throw new Error(
          `Pull request #${prNumber} does not have a head commit SHA.`,
        );
      }

      const [combinedStatus, checkRuns] = await Promise.all([
        runGitHubCliJson<GitHubApiCombinedStatus>(
          worktreePath,
          [
            "api",
            buildGitHubApiPath(
              `repos/${pullRequest.repoFullName}/commits/${pullRequest.headSha}/status`,
            ),
          ],
          signal,
        ),
        runGitHubCliJson<GitHubApiCheckRuns>(
          worktreePath,
          [
            "api",
            buildGitHubApiPath(
              `repos/${pullRequest.repoFullName}/commits/${pullRequest.headSha}/check-runs`,
              {
                per_page: 100,
              },
            ),
          ],
          signal,
        ),
      ]);

      return {
        defaultBranch: pullRequest.defaultBranch,
        description: pullRequest.description,
        isPrivate: pullRequest.isPrivate,
        repoFullName: pullRequest.repoFullName,
        url: pullRequest.url,
        viewerPermission: pullRequest.viewerPermission,
        checkRuns: (checkRuns.check_runs ?? []).map((checkRun) => ({
          appName:
            typeof checkRun.app?.name === "string" && checkRun.app.name.trim()
              ? checkRun.app.name.trim()
              : null,
          completedAt:
            typeof checkRun.completed_at === "string" &&
            checkRun.completed_at.trim()
              ? checkRun.completed_at
              : null,
          conclusion:
            typeof checkRun.conclusion === "string" &&
            checkRun.conclusion.trim()
              ? checkRun.conclusion.trim()
              : null,
          detailsUrl:
            typeof checkRun.details_url === "string" &&
            checkRun.details_url.trim()
              ? checkRun.details_url.trim()
              : null,
          name:
            typeof checkRun.name === "string" && checkRun.name.trim()
              ? checkRun.name.trim()
              : "(unnamed check)",
          startedAt:
            typeof checkRun.started_at === "string" &&
            checkRun.started_at.trim()
              ? checkRun.started_at
              : null,
          status:
            typeof checkRun.status === "string" && checkRun.status.trim()
              ? checkRun.status.trim()
              : "unknown",
        })),
        headSha: pullRequest.headSha,
        overallState:
          typeof combinedStatus.state === "string" &&
          combinedStatus.state.trim()
            ? combinedStatus.state.trim()
            : "unknown",
        prNumber,
        statusContexts: (combinedStatus.statuses ?? []).map((status) => ({
          context:
            typeof status.context === "string" && status.context.trim()
              ? status.context.trim()
              : "(unnamed status)",
          description:
            typeof status.description === "string" && status.description.trim()
              ? status.description.trim()
              : null,
          state:
            typeof status.state === "string" && status.state.trim()
              ? status.state.trim()
              : "unknown",
          targetUrl:
            typeof status.target_url === "string" && status.target_url.trim()
              ? status.target_url.trim()
              : null,
        })),
      };
    },
    getPullRequestDiff: async (prNumber, signal) => {
      const repo = await getRepositoryContext(signal);
      const diff = await runGitHubCliCommand(
        worktreePath,
        [
          "api",
          `repos/${repo.repoFullName}/pulls/${prNumber}`,
          "-H",
          "Accept: application/vnd.github.v3.diff",
        ],
        signal,
      );
      return {
        ...repo,
        diff,
        prNumber,
      };
    },
    getRepositoryContext,
  };
}

export function createPiGitHubTools(
  scope: PiGitHubToolScope,
  host: PiGitHubToolHost,
): ToolDefinition[] {
  return [
    defineTool({
      description:
        "Inspect the GitHub repository bound to the current workspace. Use this first when you need the repository name, default branch, visibility, or viewer permission.",
      execute: async (_toolCallId, _params, signal) => {
        const repo = await host.getRepositoryContext(signal);
        return textToolResult(
          [
            `GitHub repository for ${scope.worktreePathContext}: ${repo.repoFullName}`,
            `URL: ${repo.url}`,
            `Visibility: ${repo.isPrivate ? "private" : "public"}`,
            `Default branch: ${repo.defaultBranch ?? "unknown"}`,
            `Viewer permission: ${repo.viewerPermission ?? "unknown"}`,
            `Description: ${repo.description?.trim() || "(empty)"}`,
          ].join("\n"),
          repo,
        );
      },
      label: "GitHub Repo",
      name: "github_repo",
      parameters: Type.Object({}),
      promptGuidelines: [
        "Use this when you need to confirm which GitHub repository the current workspace maps to before talking about issues or pull requests.",
      ],
      promptSnippet: "Inspect the GitHub repository for the current workspace",
    }),
    defineTool({
      description:
        "Inspect a GitHub issue in the repository bound to the current workspace. This tool cannot switch repositories.",
      execute: async (_toolCallId, params, signal) => {
        const issue = await host.getIssue(
          params.issueNumber,
          {
            ...(typeof params.commentsLimit === "number"
              ? { commentsLimit: params.commentsLimit }
              : {}),
            ...(params.includeComments === true
              ? { includeComments: true }
              : {}),
          },
          signal,
        );
        const lines = [
          `GitHub issue #${issue.issueNumber} in ${issue.repoFullName}: ${issue.title}`,
          `State: ${issue.state}`,
          `Author: ${issue.authorLogin ?? "unknown"}`,
          `Type: ${issue.isPullRequest ? "pull-request issue" : "issue"}`,
          `URL: ${issue.issueUrl}`,
          `Updated: ${issue.updatedAt ?? "unknown"}`,
          formatList("Labels", issue.labelNames),
          formatList("Assignees", issue.assigneeLogins),
          ...formatBody(issue.body),
        ];
        if (params.includeComments === true) {
          lines.push(
            ...formatCommentsSection(
              "Comments",
              issue.comments,
              issue.totalCommentCount,
            ),
          );
        }
        return textToolResult(lines.join("\n"), issue);
      },
      label: "GitHub Issue",
      name: "github_issue",
      parameters: GitHubIssueParameters,
      prepareArguments: (args) =>
        prepareToolArguments<typeof GitHubIssueParameters>(
          args,
          ["includeComments"],
          ["issueNumber", "commentsLimit"],
        ),
      promptGuidelines: [
        "Use this to inspect issue details in the repository bound to the current workspace.",
      ],
      promptSnippet: "Inspect a GitHub issue in the current repository",
    }),
    defineTool({
      description:
        "Inspect a GitHub pull request in the repository bound to the current workspace. Optional flags add files, comments, and review summaries.",
      execute: async (_toolCallId, params, signal) => {
        const pullRequest = await host.getPullRequest(
          params.prNumber,
          {
            ...(typeof params.commentsLimit === "number"
              ? { commentsLimit: params.commentsLimit }
              : {}),
            ...(typeof params.filesLimit === "number"
              ? { filesLimit: params.filesLimit }
              : {}),
            ...(params.includeComments === true
              ? { includeComments: true }
              : {}),
            ...(params.includeFiles === true ? { includeFiles: true } : {}),
            ...(params.includeReviews === true ? { includeReviews: true } : {}),
            ...(typeof params.reviewsLimit === "number"
              ? { reviewsLimit: params.reviewsLimit }
              : {}),
          },
          signal,
        );
        const lines = [
          `GitHub pull request #${pullRequest.prNumber} in ${pullRequest.repoFullName}: ${pullRequest.title}`,
          `State: ${pullRequest.state}${pullRequest.isDraft ? " (draft)" : ""}`,
          `Author: ${pullRequest.authorLogin ?? "unknown"}`,
          `URL: ${pullRequest.prUrl}`,
          `Base: ${pullRequest.baseRefName}`,
          `Head: ${pullRequest.headRefName} (${pullRequest.headSha || "unknown"})`,
          `Updated: ${pullRequest.updatedAt ?? "unknown"}`,
          `Review decision: ${pullRequest.reviewDecision ?? "unknown"}`,
          `Mergeable state: ${pullRequest.mergeableState ?? "unknown"}`,
          formatList("Labels", pullRequest.labelNames),
          formatList(
            "Requested reviewers",
            pullRequest.requestedReviewerLogins,
          ),
          `Changes: +${pullRequest.additions} -${pullRequest.deletions} across ${pullRequest.totalChangedFileCount} file(s) and ${pullRequest.commitsCount} commit(s)`,
          ...formatBody(pullRequest.body),
        ];
        if (params.includeFiles === true) {
          lines.push(
            ...formatFilesSection(
              pullRequest.changedFiles,
              pullRequest.totalChangedFileCount,
            ),
          );
        }
        if (params.includeComments === true) {
          lines.push(
            ...formatCommentsSection(
              "Issue comments",
              pullRequest.comments,
              pullRequest.totalCommentCount,
            ),
            ...formatCommentsSection(
              "Review comments",
              pullRequest.reviewComments,
              pullRequest.totalReviewCommentCount,
            ),
          );
        }
        if (params.includeReviews === true) {
          lines.push(
            ...formatReviewsSection(
              pullRequest.reviews,
              pullRequest.totalReviewCount,
            ),
          );
        }
        return textToolResult(lines.join("\n"), pullRequest);
      },
      label: "GitHub Pull Request",
      name: "github_pr",
      parameters: GitHubPullRequestParameters,
      prepareArguments: (args) =>
        prepareToolArguments<typeof GitHubPullRequestParameters>(
          args,
          ["includeComments", "includeFiles", "includeReviews"],
          ["prNumber", "commentsLimit", "filesLimit", "reviewsLimit"],
        ),
      promptGuidelines: [
        "Use this for repository-scoped pull-request inspection before asking for diffs or CI status.",
      ],
      promptSnippet: "Inspect a GitHub pull request in the current repository",
    }),
    defineTool({
      description:
        "Inspect GitHub status contexts and check runs for a pull request in the repository bound to the current workspace.",
      execute: async (_toolCallId, params, signal) => {
        const checks = await host.getPullRequestChecks(params.prNumber, signal);
        const lines = [
          `GitHub checks for ${checks.repoFullName}#${checks.prNumber}`,
          `Head SHA: ${checks.headSha || "unknown"}`,
          `Overall state: ${checks.overallState}`,
          `Status contexts: ${checks.statusContexts.length}`,
          ...checks.statusContexts.map(
            (status) =>
              `- ${status.context}: ${status.state}${status.description ? ` (${status.description})` : ""}${status.targetUrl ? ` ${status.targetUrl}` : ""}`,
          ),
          `Check runs: ${checks.checkRuns.length}`,
          ...checks.checkRuns.map(
            (checkRun) =>
              `- ${checkRun.name}: ${checkRun.status}${checkRun.conclusion ? ` / ${checkRun.conclusion}` : ""}${checkRun.appName ? ` [${checkRun.appName}]` : ""}${checkRun.detailsUrl ? ` ${checkRun.detailsUrl}` : ""}`,
          ),
        ];
        return textToolResult(lines.join("\n"), checks);
      },
      label: "GitHub PR Checks",
      name: "github_pr_checks",
      parameters: GitHubPullRequestChecksParameters,
      prepareArguments: (args) =>
        prepareToolArguments<typeof GitHubPullRequestChecksParameters>(
          args,
          [],
          ["prNumber"],
        ),
      promptGuidelines: [
        "Use this when the user asks about CI, failing checks, or merge readiness for a pull request in the current repository.",
      ],
      promptSnippet:
        "Inspect CI status and check runs for a pull request in the current repository",
    }),
    defineTool({
      description:
        "Fetch the unified diff for a GitHub pull request in the repository bound to the current workspace.",
      execute: async (_toolCallId, params, signal) => {
        const diffResult = await host.getPullRequestDiff(
          params.prNumber,
          signal,
        );
        const maxLines =
          typeof params.maxLines === "number" ? params.maxLines : 400;
        const truncated = truncateTextLines(diffResult.diff, maxLines);
        const lines = [
          `GitHub pull-request diff for ${diffResult.repoFullName}#${diffResult.prNumber}`,
          ...(truncated.truncated
            ? [
                `Showing ${truncated.shownLineCount} of ${truncated.totalLineCount} diff lines.`,
              ]
            : []),
          truncated.truncatedText,
        ];
        return textToolResult(lines.join("\n"), {
          ...diffResult,
          shownLineCount: truncated.shownLineCount,
          totalLineCount: truncated.totalLineCount,
          truncated: truncated.truncated,
        });
      },
      label: "GitHub PR Diff",
      name: "github_pr_diff",
      parameters: GitHubPullRequestDiffParameters,
      prepareArguments: (args) =>
        prepareToolArguments<typeof GitHubPullRequestDiffParameters>(
          args,
          [],
          ["prNumber", "maxLines"],
        ),
      promptGuidelines: [
        "Use this when the user needs the actual patch text for a pull request in the current repository.",
      ],
      promptSnippet:
        "Fetch the unified diff for a pull request in the current repository",
    }),
  ];
}
