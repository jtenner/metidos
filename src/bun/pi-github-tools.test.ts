import { describe, expect, it } from "bun:test";

import {
  createPiGitHubTools,
  type PiGitHubToolHost,
  type PiGitHubToolScope,
} from "./pi-github-tools";

function makeScope(): PiGitHubToolScope {
  return {
    worktreePathContext: "/repo/alpha",
  };
}

function createHost(
  overrides: Partial<PiGitHubToolHost> = {},
): PiGitHubToolHost {
  return {
    getIssue: async () => ({
      assigneeLogins: ["octocat"],
      authorLogin: "alice",
      body: "Issue body",
      closedAt: null,
      comments: [],
      defaultBranch: "master",
      description: "Alpha repo",
      isPrivate: true,
      issueNumber: 14,
      issueUrl: "https://github.com/acme/alpha/issues/14",
      isPullRequest: false,
      labelNames: ["bug"],
      repoFullName: "acme/alpha",
      state: "open",
      title: "Fix race condition",
      totalCommentCount: 0,
      updatedAt: "2026-04-09T12:00:00Z",
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    }),
    getPullRequest: async () => ({
      additions: 42,
      authorLogin: "alice",
      baseRefName: "master",
      body: "PR body",
      changedFiles: [],
      closedAt: null,
      comments: [],
      commitsCount: 3,
      defaultBranch: "master",
      deletions: 7,
      description: "Alpha repo",
      headRefName: "feature/github-pack",
      headSha: "abc123def456",
      isDraft: false,
      isPrivate: true,
      labelNames: ["migration"],
      mergeableState: "clean",
      prNumber: 21,
      prUrl: "https://github.com/acme/alpha/pull/21",
      repoFullName: "acme/alpha",
      requestedReviewerLogins: ["bob"],
      reviewComments: [],
      reviewDecision: "APPROVED",
      reviews: [],
      state: "open",
      title: "Add GitHub tools",
      totalChangedFileCount: 0,
      totalCommentCount: 0,
      totalReviewCommentCount: 0,
      totalReviewCount: 0,
      updatedAt: "2026-04-09T12:00:00Z",
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    }),
    getPullRequestChecks: async () => ({
      checkRuns: [
        {
          appName: "GitHub Actions",
          completedAt: "2026-04-09T12:00:00Z",
          conclusion: "success",
          detailsUrl: "https://github.com/acme/alpha/actions/runs/1",
          name: "build",
          startedAt: "2026-04-09T11:59:00Z",
          status: "completed",
        },
      ],
      defaultBranch: "master",
      description: "Alpha repo",
      headSha: "abc123def456",
      isPrivate: true,
      overallState: "success",
      prNumber: 21,
      repoFullName: "acme/alpha",
      statusContexts: [
        {
          context: "ci/lint",
          description: "lint passed",
          state: "success",
          targetUrl: "https://github.com/acme/alpha/actions/runs/2",
        },
      ],
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    }),
    getPullRequestDiff: async () => ({
      defaultBranch: "master",
      description: "Alpha repo",
      diff: ["diff --git a/a.ts b/a.ts", "+line1", "+line2", "+line3"].join(
        "\n",
      ),
      isPrivate: true,
      prNumber: 21,
      repoFullName: "acme/alpha",
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    }),
    getRepositoryContext: async () => ({
      defaultBranch: "master",
      description: "Alpha repo",
      isPrivate: true,
      repoFullName: "acme/alpha",
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    }),
    ...overrides,
  };
}

function getTool(
  scope: PiGitHubToolScope,
  host: PiGitHubToolHost,
  name: string,
) {
  const tool = createPiGitHubTools(scope, host).find(
    (entry) => entry.name === name,
  );
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

async function executeTool(
  scope: PiGitHubToolScope,
  host: PiGitHubToolHost,
  name: string,
  rawArgs: unknown,
) {
  const tool = getTool(scope, host, name);
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  return tool.execute("call-1", args as never, undefined, async () => {}, {
    cwd: scope.worktreePathContext,
  } as never);
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== "text") {
    throw new Error("Expected a text tool result.");
  }
  return firstContent.text;
}

describe("createPiGitHubTools", () => {
  it("inspects the repository bound to the current workspace", async () => {
    const result = await executeTool(
      makeScope(),
      createHost(),
      "github_repo",
      {},
    );

    expect(resultText(result)).toContain(
      "GitHub repository for /repo/alpha: acme/alpha",
    );
    expect(result.details).toEqual({
      defaultBranch: "master",
      description: "Alpha repo",
      isPrivate: true,
      repoFullName: "acme/alpha",
      url: "https://github.com/acme/alpha",
      viewerPermission: "ADMIN",
    });
  });

  it("inspects an issue and can include recent comments", async () => {
    const host = createHost({
      getIssue: async (issueNumber, options) => ({
        assigneeLogins: ["octocat"],
        authorLogin: "alice",
        body: "Issue body",
        closedAt: null,
        comments:
          options?.includeComments === true
            ? [
                {
                  authorLogin: "bob",
                  body: "Please fix this soon.",
                  createdAt: "2026-04-09T12:01:00Z",
                  id: 77,
                  kind: "issue_comment",
                  path: null,
                  url: "https://github.com/acme/alpha/issues/14#issuecomment-77",
                },
              ]
            : [],
        defaultBranch: "master",
        description: "Alpha repo",
        isPrivate: true,
        issueNumber,
        issueUrl: "https://github.com/acme/alpha/issues/14",
        isPullRequest: false,
        labelNames: ["bug"],
        repoFullName: "acme/alpha",
        state: "open",
        title: "Fix race condition",
        totalCommentCount: options?.includeComments === true ? 1 : 0,
        updatedAt: "2026-04-09T12:00:00Z",
        url: "https://github.com/acme/alpha",
        viewerPermission: "ADMIN",
      }),
    });

    const result = await executeTool(makeScope(), host, "github_issue", {
      commentsLimit: "5",
      includeComments: "true",
      issueNumber: "14",
    });

    expect(resultText(result)).toContain(
      "GitHub issue #14 in acme/alpha: Fix race condition",
    );
    expect(resultText(result)).toContain("Comments: showing 1 of 1");
    expect(resultText(result)).toContain("Please fix this soon.");
  });

  it("inspects a pull request with files, comments, and reviews", async () => {
    const host = createHost({
      getPullRequest: async (prNumber, options) => ({
        additions: 42,
        authorLogin: "alice",
        baseRefName: "master",
        body: "PR body",
        changedFiles:
          options?.includeFiles === true
            ? [
                {
                  additions: 10,
                  deletions: 2,
                  path: "src/bun/pi-github-tools.ts",
                  status: "modified",
                },
              ]
            : [],
        closedAt: null,
        comments:
          options?.includeComments === true
            ? [
                {
                  authorLogin: "bob",
                  body: "Looks good overall.",
                  createdAt: "2026-04-09T12:02:00Z",
                  id: 90,
                  kind: "issue_comment",
                  path: null,
                  url: "https://github.com/acme/alpha/pull/21#issuecomment-90",
                },
              ]
            : [],
        commitsCount: 3,
        defaultBranch: "master",
        deletions: 7,
        description: "Alpha repo",
        headRefName: "feature/github-pack",
        headSha: "abc123def456",
        isDraft: false,
        isPrivate: true,
        labelNames: ["migration"],
        mergeableState: "clean",
        prNumber,
        prUrl: "https://github.com/acme/alpha/pull/21",
        repoFullName: "acme/alpha",
        requestedReviewerLogins: ["bob"],
        reviewComments:
          options?.includeComments === true
            ? [
                {
                  authorLogin: "carol",
                  body: "Nit: rename this helper.",
                  createdAt: "2026-04-09T12:03:00Z",
                  id: 91,
                  kind: "review_comment",
                  path: "src/bun/pi-github-tools.ts",
                  url: "https://github.com/acme/alpha/pull/21#discussion_r91",
                },
              ]
            : [],
        reviewDecision: "APPROVED",
        reviews:
          options?.includeReviews === true
            ? [
                {
                  authorLogin: "bob",
                  body: "Approved.",
                  id: 88,
                  state: "APPROVED",
                  submittedAt: "2026-04-09T12:04:00Z",
                  url: "https://github.com/acme/alpha/pull/21#pullrequestreview-88",
                },
              ]
            : [],
        state: "open",
        title: "Add GitHub tools",
        totalChangedFileCount: options?.includeFiles === true ? 1 : 0,
        totalCommentCount: options?.includeComments === true ? 1 : 0,
        totalReviewCommentCount: options?.includeComments === true ? 1 : 0,
        totalReviewCount: options?.includeReviews === true ? 1 : 0,
        updatedAt: "2026-04-09T12:00:00Z",
        url: "https://github.com/acme/alpha",
        viewerPermission: "ADMIN",
      }),
    });

    const result = await executeTool(makeScope(), host, "github_pr", {
      commentsLimit: "5",
      filesLimit: "5",
      includeComments: "true",
      includeFiles: "true",
      includeReviews: "true",
      prNumber: "21",
      reviewsLimit: "5",
    });

    expect(resultText(result)).toContain(
      "GitHub pull request #21 in acme/alpha: Add GitHub tools",
    );
    expect(resultText(result)).toContain("Files: showing 1 of 1");
    expect(resultText(result)).toContain("Issue comments: showing 1 of 1");
    expect(resultText(result)).toContain("Review comments: showing 1 of 1");
    expect(resultText(result)).toContain("Reviews: showing 1 of 1");
  });

  it("inspects pull-request checks", async () => {
    const result = await executeTool(
      makeScope(),
      createHost(),
      "github_pr_checks",
      {
        prNumber: "21",
      },
    );

    expect(resultText(result)).toContain("GitHub checks for acme/alpha#21");
    expect(resultText(result)).toContain("ci/lint: success");
    expect(resultText(result)).toContain("build: completed / success");
  });

  it("truncates pull-request diffs to the requested line count", async () => {
    const result = await executeTool(
      makeScope(),
      createHost(),
      "github_pr_diff",
      {
        maxLines: "2",
        prNumber: "21",
      },
    );

    expect(resultText(result)).toContain("Showing 2 of 4 diff lines.");
    expect(resultText(result)).toContain("diff --git a/a.ts b/a.ts");
    expect(result.details).toMatchObject({
      shownLineCount: 2,
      totalLineCount: 4,
      truncated: true,
    });
  });
});
