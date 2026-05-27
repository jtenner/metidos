/**
 * @file src/bun/pi/git-tools/inspection.test.ts
 * @description Tests for the low-level Git inspection tool surface.
 */

import { afterEach, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGitCommand } from "../../git";
import { createPiGitCliHost, createPiGitTools } from "./index";
import type { PiGitToolScope } from "./shared";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-pi-git-inspection-"));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const path of tempDirectories) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
  tempDirectories.clear();
});

function makeScope(worktreePathContext: string): PiGitToolScope {
  return {
    worktreePathContext,
  };
}

function createHost(worktreePath: string) {
  return createPiGitCliHost(worktreePath);
}

async function executeTool(
  worktreePath: string,
  name: string,
  rawArgs: unknown,
) {
  const scope = makeScope(worktreePath);
  const host = createHost(worktreePath);
  const tool = createPiGitTools(scope, host).find(
    (entry) => entry.name === name,
  );
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
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

async function createInspectionRepoFixture(): Promise<{
  attributePath: string;
  headCommitHash: string;
  ignoredPath: string;
  releaseTag: string;
  trackedIgnoredPath: string;
  trackedPath: string;
  treePath: string;
  visiblePath: string;
  worktreePath: string;
}> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);

  writeFileSync(
    join(worktreePath, ".gitignore"),
    "ignored.txt\nignored-tracked.txt\n",
  );
  writeFileSync(
    join(worktreePath, ".gitattributes"),
    "attribute.txt text eol=lf\n",
  );
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  writeFileSync(join(worktreePath, "attribute.txt"), "attribute\n");
  writeFileSync(join(worktreePath, "ignored-tracked.txt"), "tracked ignored\n");
  mkdirSync(join(worktreePath, "dir"), { recursive: true });
  writeFileSync(join(worktreePath, "dir", "nested.txt"), "nested\n");
  await runGitCommand(worktreePath, [
    "add",
    ".gitignore",
    ".gitattributes",
    "tracked.txt",
    "attribute.txt",
    "dir/nested.txt",
  ]);
  await runGitCommand(worktreePath, ["add", "-f", "ignored-tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Inspection base commit"]);
  const headCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);
  await runGitCommand(worktreePath, [
    "tag",
    "-a",
    "release-v1",
    "-m",
    "Release 1",
  ]);

  writeFileSync(join(worktreePath, "tracked.txt"), "modified\n");
  writeFileSync(join(worktreePath, "ignored.txt"), "ignored\n");
  writeFileSync(join(worktreePath, "visible.txt"), "visible\n");

  return {
    attributePath: "attribute.txt",
    headCommitHash,
    ignoredPath: "ignored.txt",
    releaseTag: "release-v1",
    trackedIgnoredPath: "ignored-tracked.txt",
    trackedPath: "tracked.txt",
    treePath: "dir",
    visiblePath: "visible.txt",
    worktreePath,
  };
}

it("verifies commit signatures without invoking bash", async () => {
  const { headCommitHash, worktreePath } = await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_verify_commit", {
    commits: [headCommitHash],
  });

  expect(resultText(result)).toContain(
    `Git commit verification for ${worktreePath}`,
  );
  expect(resultText(result)).toContain(`Commits: ${headCommitHash}`);
  expect(resultText(result)).toContain("Verified: 0 of 1");
  expect(resultText(result)).toContain("not verified (exit 1)");
  expect(result.details).toEqual({
    commitResults: [
      {
        exitCode: 1,
        input: headCommitHash,
        output: expect.any(String),
        verified: false,
      },
    ],
    commits: [headCommitHash],
    failedCount: 1,
    raw: false,
    verifiedCount: 0,
    verbose: false,
    worktreePath,
  });
});

it("verifies annotated tags without invoking bash", async () => {
  const { releaseTag, worktreePath } = await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_verify_tag", {
    raw: true,
    tags: [releaseTag],
  });

  expect(resultText(result)).toContain(
    `Git tag verification for ${worktreePath}`,
  );
  expect(resultText(result)).toContain(`Tags: ${releaseTag}`);
  expect(resultText(result)).toContain("Verified: 0 of 1");
  expect(resultText(result)).toContain("no signature found");
  expect(result.details).toEqual({
    failedCount: 1,
    raw: true,
    tagResults: [
      {
        exitCode: 1,
        input: releaseTag,
        output: expect.stringContaining("no signature found"),
        verified: false,
      },
    ],
    tags: [releaseTag],
    verifiedCount: 0,
    verbose: false,
    worktreePath,
  });
});

it("explains ignored and non-ignored paths without invoking bash", async () => {
  const { ignoredPath, trackedIgnoredPath, visiblePath, worktreePath } =
    await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_check_ignore", {
    paths: [ignoredPath, trackedIgnoredPath, visiblePath],
  });

  expect(resultText(result)).toContain(`Git ignore check for ${worktreePath}`);
  expect(resultText(result)).toContain(
    `Paths: ${ignoredPath}, ${trackedIgnoredPath}, ${visiblePath}`,
  );
  expect(resultText(result)).toContain("Ignored: 1 of 3");
  expect(result.details).toEqual({
    includeIndex: true,
    ignoredCount: 1,
    pathCount: 3,
    paths: [ignoredPath, trackedIgnoredPath, visiblePath],
    results: [
      {
        ignored: true,
        lineNumber: 1,
        pattern: "ignored.txt",
        path: ignoredPath,
        source: ".gitignore",
      },
      {
        ignored: false,
        lineNumber: null,
        pattern: null,
        path: trackedIgnoredPath,
        source: null,
      },
      {
        ignored: false,
        lineNumber: null,
        pattern: null,
        path: visiblePath,
        source: null,
      },
    ],
    worktreePath,
  });

  const noIndexResult = await executeTool(worktreePath, "git_check_ignore", {
    includeIndex: false,
    paths: [trackedIgnoredPath],
  });

  expect(resultText(noIndexResult)).toContain("Include index: no");
  expect(resultText(noIndexResult)).toContain(`${trackedIgnoredPath}: ignored`);
  expect(noIndexResult.details).toEqual({
    includeIndex: false,
    ignoredCount: 1,
    pathCount: 1,
    paths: [trackedIgnoredPath],
    results: [
      {
        ignored: true,
        lineNumber: 2,
        pattern: "ignored-tracked.txt",
        path: trackedIgnoredPath,
        source: ".gitignore",
      },
    ],
    worktreePath,
  });
});

it("reads worktree attributes without invoking bash", async () => {
  const { attributePath, worktreePath } = await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_check_attr", {
    attributes: ["text", "eol"],
    cached: true,
    paths: [attributePath],
  });

  expect(resultText(result)).toContain(
    `Git attribute check for ${worktreePath}`,
  );
  expect(resultText(result)).toContain(`Paths: ${attributePath}`);
  expect(resultText(result)).toContain("Cached: yes");
  expect(resultText(result)).toContain("Attribute values: 2");
  expect(resultText(result)).toContain("text: set");
  expect(resultText(result)).toContain("eol: lf");
  expect(result.details).toEqual({
    all: false,
    attributeCount: 2,
    attributes: ["text", "eol"],
    cached: true,
    pathCount: 1,
    paths: [attributePath],
    results: [
      {
        attributes: [
          {
            name: "text",
            value: "set",
          },
          {
            name: "eol",
            value: "lf",
          },
        ],
        path: attributePath,
      },
    ],
    worktreePath,
  });
});

it("lists index and worktree files without invoking bash", async () => {
  const { trackedIgnoredPath, trackedPath, visiblePath, worktreePath } =
    await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_ls_files", {
    maxEntries: 20,
  });

  expect(resultText(result)).toContain(`Git ls-files for ${worktreePath}`);
  expect(resultText(result)).toContain("Modes: cached, modified, others");
  expect(resultText(result)).toContain("tracked.txt");
  expect(resultText(result)).toContain(visiblePath);
  expect(resultText(result)).toContain(trackedIgnoredPath);
  expect(result.details).toMatchObject({
    cached: true,
    deleted: false,
    deduplicate: true,
    excludeStandard: true,
    includeDirectories: false,
    ignored: false,
    maxEntries: 20,
    modified: true,
    others: true,
    pathCount: 0,
    paths: [],
    shownEntryCount: expect.any(Number),
    totalEntryCount: expect.any(Number),
    truncatedEntryCount: null,
    unmerged: false,
    worktreePath,
  });

  const lsFilesResults = (
    result.details as {
      results: Array<{ path: string; statusTag: string | null }>;
    }
  ).results;
  expect(lsFilesResults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: trackedPath }),
      expect.objectContaining({ path: visiblePath, statusTag: "?" }),
      expect.objectContaining({ path: trackedIgnoredPath }),
    ]),
  );
});

it("lists tree entries without invoking bash", async () => {
  const { headCommitHash, worktreePath } = await createInspectionRepoFixture();
  const result = await executeTool(worktreePath, "git_ls_tree", {
    long: true,
    maxEntries: 20,
    recursive: true,
    treeish: headCommitHash,
  });

  expect(resultText(result)).toContain(`Git tree listing for ${worktreePath}`);
  expect(resultText(result)).toContain(`Treeish: ${headCommitHash}`);
  expect(resultText(result)).toContain("Recursive: yes");
  expect(resultText(result)).toContain("Long: yes");
  expect(resultText(result)).toContain("dir/nested.txt");
  expect(result.details).toMatchObject({
    long: true,
    maxEntries: 20,
    pathCount: 0,
    paths: [],
    recursive: true,
    shownEntryCount: expect.any(Number),
    totalEntryCount: expect.any(Number),
    truncatedEntryCount: null,
    treeish: headCommitHash,
    worktreePath,
  });

  const lsTreeResults = (result.details as { results: Array<{ path: string }> })
    .results;
  expect(lsTreeResults).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "tracked.txt" }),
      expect.objectContaining({ path: "attribute.txt" }),
      expect.objectContaining({ path: "dir/nested.txt" }),
      expect.objectContaining({ path: "ignored-tracked.txt" }),
    ]),
  );
});
