/**
 * @file src/bun/pi/git-tools/index.test.ts
 * @description Tests for the local Git tool surface.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGitCommand } from "../../git";
import { createPiGitCliHost, createPiGitTools } from "./index";
import type { PiGitToolScope } from "./shared";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-pi-git-tools-"));
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

async function createCommittedRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial commit"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "modified\n");
  writeFileSync(join(worktreePath, "untracked.txt"), "hello\n");
  return worktreePath;
}

async function createHistoryRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial commit"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "second\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Second commit"]);
  return worktreePath;
}

async function createTaggedHistoryRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial commit"]);
  await runGitCommand(worktreePath, ["tag", "-a", "v1", "-m", "Release 1"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "second\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Second commit"]);
  return worktreePath;
}

async function createShortlogRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Alice"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "alice@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial commit"]);

  await runGitCommand(worktreePath, ["config", "user.name", "Bob"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "bob@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "bob\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Bob commit"]);

  await runGitCommand(worktreePath, ["config", "user.name", "Alice"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "alice@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "alice again\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Alice second commit"]);
  return worktreePath;
}

async function createDivergedBranchRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "initial\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial commit"]);
  await runGitCommand(worktreePath, ["switch", "-c", "feature"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "feature\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Feature commit"]);
  await runGitCommand(worktreePath, ["switch", "master"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "main\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Main commit"]);
  return worktreePath;
}

async function createRenameRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(join(worktreePath, "move-me.txt"), "rename me\n");
  await runGitCommand(worktreePath, ["add", "move-me.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Add rename candidate"]);
  return worktreePath;
}

async function createRangeDiffRepoFixture(): Promise<{
  baseHash: string;
  newTipHash: string;
  oldTipHash: string;
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
  writeFileSync(join(worktreePath, "tracked.txt"), "base\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Base commit"]);
  const baseHash = await runGitCommand(worktreePath, ["rev-parse", "HEAD"]);
  await runGitCommand(worktreePath, ["branch", "basepoint"]);
  await runGitCommand(worktreePath, ["switch", "-c", "old-series"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "old\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "old change"]);
  const oldTipHash = await runGitCommand(worktreePath, ["rev-parse", "HEAD"]);
  await runGitCommand(worktreePath, [
    "switch",
    "-c",
    "new-series",
    "basepoint",
  ]);
  writeFileSync(join(worktreePath, "tracked.txt"), "new\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "new change"]);
  const newTipHash = await runGitCommand(worktreePath, ["rev-parse", "HEAD"]);
  return {
    baseHash,
    newTipHash,
    oldTipHash,
    worktreePath,
  };
}

async function createBranchingRepoFixture(): Promise<{
  baseBranch: string;
  baseCommitHash: string;
  featureBranch: string;
  featureCommitHash: string;
  mainCommitHash: string;
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
  const baseBranch =
    (await runGitCommand(worktreePath, ["branch", "--show-current"])) ||
    "master";

  writeFileSync(join(worktreePath, "base.txt"), "base\n");
  await runGitCommand(worktreePath, ["add", "base.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Base commit"]);
  const baseCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);

  const featureBranch = "feature";
  await runGitCommand(worktreePath, ["switch", "-c", featureBranch]);
  writeFileSync(join(worktreePath, "feature.txt"), "feature\n");
  await runGitCommand(worktreePath, ["add", "feature.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Feature change"]);
  const featureCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);

  await runGitCommand(worktreePath, ["switch", baseBranch]);
  writeFileSync(join(worktreePath, "main.txt"), "main\n");
  await runGitCommand(worktreePath, ["add", "main.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Main change"]);
  const mainCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);

  return {
    baseBranch,
    baseCommitHash,
    featureBranch,
    featureCommitHash,
    mainCommitHash,
    worktreePath,
  };
}

async function createGrepRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Metidos Test"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "metidos@example.com",
  ]);
  writeFileSync(
    join(worktreePath, "needle.txt"),
    "needle first\nno match\nneedle second\n",
  );
  await runGitCommand(worktreePath, ["add", "needle.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Add grep fixture"]);
  return worktreePath;
}

async function createBlameRepoFixture(): Promise<string> {
  const worktreePath = createTempDirectory();
  await runGitCommand(worktreePath, ["init"]);
  await runGitCommand(worktreePath, ["config", "user.name", "Alice"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "alice@example.com",
  ]);
  writeFileSync(join(worktreePath, "blame.txt"), "alpha\nbeta\ngamma\n");
  await runGitCommand(worktreePath, ["add", "blame.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Initial blame commit"]);

  await runGitCommand(worktreePath, ["config", "user.name", "Bob"]);
  await runGitCommand(worktreePath, [
    "config",
    "user.email",
    "bob@example.com",
  ]);
  writeFileSync(
    join(worktreePath, "blame.txt"),
    "alpha\nbeta updated\ngamma\n",
  );
  await runGitCommand(worktreePath, ["add", "blame.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Update middle line"]);
  return worktreePath;
}

describe("createPiGitTools", () => {
  it("exposes a bounded status snapshot for the current worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });

    expect(resultText(result)).toContain(`Git status for ${worktreePath}`);
    expect(resultText(result)).toContain("Branch:");
    expect(resultText(result)).toContain("tracked.txt");
    expect(resultText(result)).toContain("untracked.txt");
    expect(result.details).toEqual({
      branchLine: expect.any(String),
      shownLineCount: expect.any(Number),
      statusLines: expect.any(Array),
      totalLineCount: expect.any(Number),
      truncated: false,
      worktreePath,
    });
  });

  it("summarizes the current worktree diff without enabling bash", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_diff", {});

    expect(resultText(result)).toContain(
      `Git diff snapshot for ${worktreePath}`,
    );
    expect(resultText(result)).toContain("Summary:");
    expect(resultText(result)).toContain("modified tracked.txt");
    expect(resultText(result)).toContain("untracked untracked.txt");
    expect(resultText(result)).toContain(
      "diff --git a/tracked.txt b/tracked.txt",
    );
    expect(resultText(result)).toContain("-initial");
    expect(resultText(result)).toContain("+modified");
    expect(resultText(result)).toContain("?? untracked.txt");
    expect(result.details).toEqual({
      changeCount: expect.any(Number),
      changes: expect.any(Array),
      diffLineCount: expect.any(Number),
      diffLines: expect.any(Array),
      fileCount: expect.any(Number),
      fileLines: expect.any(Array),
      shownChangeCount: expect.any(Number),
      shownDiffLineCount: expect.any(Number),
      shownFileCount: expect.any(Number),
      truncated: null,
      worktreePath,
    });
  });

  it("lists commit history for the current worktree without requiring bash", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const result = await executeTool(worktreePath, "git_log", {
      limit: 10,
      offset: 0,
    });

    expect(resultText(result)).toContain(`Git log for ${worktreePath}`);
    expect(resultText(result)).toContain("Branch:");
    expect(resultText(result)).toContain(
      "Showing 2 commit(s) from offset 0 with limit 10.",
    );
    expect(resultText(result)).toContain("Second commit");
    expect(resultText(result)).toContain("Initial commit");
    expect(result.details).toEqual({
      branch: expect.any(String),
      entryCount: 2,
      entries: expect.any(Array),
      headHash: expect.any(String),
      headShortHash: expect.any(String),
      limit: 10,
      nextOffset: null,
      offset: 0,
      worktreePath,
    });
  });

  it("stages selected paths in the current worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_add", {
      paths: ["tracked.txt", "untracked.txt"],
    });

    expect(resultText(result)).toContain(
      `Staged 2 path(s) in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Mode: tracked and new files");
    expect(resultText(result)).toContain("Paths: tracked.txt, untracked.txt");
    expect(result.details).toEqual({
      pathCount: 2,
      paths: ["tracked.txt", "untracked.txt"],
      update: false,
      worktreePath,
    });

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain("M  tracked.txt");
    expect(resultText(status)).toContain("A  untracked.txt");
  });

  it("restores modified tracked files in the current worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_restore", {
      paths: ["tracked.txt"],
    });

    expect(resultText(result)).toContain(
      `Restored 1 path(s) in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Mode: worktree");
    expect(resultText(result)).toContain("Source: default");
    expect(resultText(result)).toContain("Paths: tracked.txt");
    expect(readFileSync(join(worktreePath, "tracked.txt"), "utf8")).toBe(
      "initial\n",
    );
    expect(result.details).toEqual({
      pathCount: 1,
      paths: ["tracked.txt"],
      source: null,
      staged: false,
      worktree: true,
      worktreePath,
    });

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).not.toContain("M  tracked.txt");
    expect(resultText(status)).toContain("?? untracked.txt");
  });

  it("removes tracked files from the worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_rm", {
      force: true,
      paths: ["tracked.txt"],
    });

    expect(resultText(result)).toContain(
      `Removed 1 path(s) from ${worktreePath}.`,
    );
    expect(resultText(result)).toContain(
      "Mode: index and worktree, recursive, force",
    );
    expect(result.details).toEqual({
      cached: false,
      force: true,
      pathCount: 1,
      paths: ["tracked.txt"],
      recursive: true,
      worktreePath,
    });
    expect(existsSync(join(worktreePath, "tracked.txt"))).toBe(false);

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain("D  tracked.txt");
    expect(resultText(status)).toContain("?? untracked.txt");
  });

  it("renames tracked files within the current worktree", async () => {
    const worktreePath = await createRenameRepoFixture();
    const result = await executeTool(worktreePath, "git_mv", {
      destinationPath: "renamed.txt",
      sourcePath: "move-me.txt",
    });

    expect(resultText(result)).toContain(
      `Moved move-me.txt -> renamed.txt in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Mode: standard");
    expect(result.details).toEqual({
      destinationPath: "renamed.txt",
      force: false,
      sourcePath: "move-me.txt",
      worktreePath,
    });
    expect(existsSync(join(worktreePath, "move-me.txt"))).toBe(false);
    expect(existsSync(join(worktreePath, "renamed.txt"))).toBe(true);

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain("move-me.txt -> renamed.txt");
  });

  it("resets the current worktree to an earlier commit without discarding the worktree", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const result = await executeTool(worktreePath, "git_reset", {
      mode: "mixed",
      target: "HEAD~1",
    });

    expect(resultText(result)).toContain(`Reset ${worktreePath} to HEAD~1.`);
    expect(resultText(result)).toContain("Mode: mixed");
    expect(resultText(result)).toContain("Resolved target:");
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Initial commit");
    expect(readFileSync(join(worktreePath, "tracked.txt"), "utf8")).toBe(
      "second\n",
    );
    expect(result.details).toEqual({
      branch: expect.any(String),
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Initial commit",
      },
      mode: "mixed",
      resetOutput: expect.any(String),
      resolvedTarget: expect.any(String),
      target: "HEAD~1",
      worktreePath,
    });

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain(" M tracked.txt");

    const logResult = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    expect(resultText(logResult)).toContain("Initial commit");
  });

  it("reverts the latest commit by creating a new revert commit", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const logResult = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    const commitHash = (
      logResult.details as { entries: Array<{ hash: string }> }
    ).entries[0]?.hash;
    if (!commitHash) {
      throw new Error("Expected a commit hash in the git log output.");
    }
    const result = await executeTool(worktreePath, "git_revert", {
      commitHash,
    });

    expect(resultText(result)).toContain(
      `Reverted commit ${commitHash} in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Resolved commit:");
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain('Revert "Second commit"');
    expect(result.details).toEqual({
      branch: expect.any(String),
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: 'Revert "Second commit"',
      },
      commitHash,
      revertOutput: expect.any(String),
      resolvedCommitHash: expect.any(String),
      worktreePath,
    });

    const revertLog = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    expect(resultText(revertLog)).toContain('Revert "Second commit"');

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain("## master");
    expect(resultText(status)).not.toContain("tracked.txt");
  });

  it("stashes tracked and untracked changes in the current worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_stash", {
      includeUntracked: true,
      message: "before cleanup",
    });

    expect(resultText(result)).toContain(`Stashed changes in ${worktreePath}.`);
    expect(resultText(result)).toContain("Created stash entry: yes");
    expect(resultText(result)).toContain("Mode: include untracked");
    expect(resultText(result)).toContain("Message: before cleanup");
    expect(resultText(result)).toContain("Latest stash: stash@{0}");
    expect(readFileSync(join(worktreePath, "tracked.txt"), "utf8")).toBe(
      "initial\n",
    );
    expect(existsSync(join(worktreePath, "untracked.txt"))).toBe(false);
    expect(result.details).toEqual({
      created: true,
      includeUntracked: true,
      keepIndex: false,
      message: "before cleanup",
      previousStash: null,
      pushOutput: expect.any(String),
      stashEntry: {
        committedAt: expect.any(String),
        hash: expect.any(String),
        ref: "stash@{0}",
        subject: expect.stringContaining("before cleanup"),
      },
      worktreePath,
    });

    const status = await executeTool(worktreePath, "git_status", {
      maxLines: 50,
    });
    expect(resultText(status)).toContain("## master");
    expect(resultText(status)).not.toContain("tracked.txt");
    expect(resultText(status)).not.toContain("untracked.txt");

    const stashList = await executeTool(worktreePath, "git_stash_list", {
      maxStashes: 10,
    });
    expect(resultText(stashList)).toContain(
      `Git stash list for ${worktreePath}`,
    );
    expect(resultText(stashList)).toContain(
      "Showing 1 stash entry with limit 10.",
    );
    expect(resultText(stashList)).toContain("Stashes");
    expect(resultText(stashList)).toContain("stash@{0}");
    expect(resultText(stashList)).toContain("before cleanup");
    expect(stashList.details).toEqual({
      entryCount: 1,
      entries: [
        {
          committedAt: expect.any(String),
          hash: expect.any(String),
          ref: "stash@{0}",
          subject: expect.stringContaining("before cleanup"),
        },
      ],
      maxStashes: 10,
      worktreePath,
    });
  });

  it("creates bounded local tags and lists them in the current worktree", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const annotatedResult = await executeTool(worktreePath, "git_tag", {
      message: "Release 1.0",
      tagName: "release/v1.0",
      target: "HEAD",
    });

    expect(resultText(annotatedResult)).toContain(
      `Tagged release/v1.0 in ${worktreePath}.`,
    );
    expect(resultText(annotatedResult)).toContain("Mode: annotated");
    expect(resultText(annotatedResult)).toContain("Target: HEAD ->");
    expect(resultText(annotatedResult)).toContain(
      "Tag: release/v1.0 annotated",
    );
    expect(resultText(annotatedResult)).toContain("Message: Release 1.0");
    expect(annotatedResult.details).toEqual({
      annotated: true,
      force: false,
      message: "Release 1.0",
      resolvedTargetHash: expect.any(String),
      tag: {
        annotated: true,
        date: expect.any(String),
        name: "release/v1.0",
        objectHash: expect.any(String),
        objectType: "tag",
        subject: "Release 1.0",
        targetHash: expect.any(String),
      },
      tagName: "release/v1.0",
      tagOutput: expect.any(String),
      target: "HEAD",
      worktreePath,
    });

    const lightweightResult = await executeTool(worktreePath, "git_tag", {
      tagName: "snapshot",
      target: "HEAD~1",
    });

    expect(resultText(lightweightResult)).toContain(
      `Tagged snapshot in ${worktreePath}.`,
    );
    expect(resultText(lightweightResult)).toContain("Mode: lightweight");
    expect(resultText(lightweightResult)).toContain("Target: HEAD~1 ->");
    expect(resultText(lightweightResult)).toContain(
      "Tag: snapshot lightweight",
    );
    expect(resultText(lightweightResult)).toContain("Message: none");
    expect(lightweightResult.details).toEqual({
      annotated: false,
      force: false,
      message: null,
      resolvedTargetHash: expect.any(String),
      tag: {
        annotated: false,
        date: expect.any(String),
        name: "snapshot",
        objectHash: expect.any(String),
        objectType: "commit",
        subject: "Initial commit",
        targetHash: expect.any(String),
      },
      tagName: "snapshot",
      tagOutput: expect.any(String),
      target: "HEAD~1",
      worktreePath,
    });

    const tagList = await executeTool(worktreePath, "git_tag_list", {
      maxTags: 50,
    });
    expect(resultText(tagList)).toContain(`Git tags for ${worktreePath}`);
    expect(resultText(tagList)).toContain("Showing 2 tag(s) with limit 50.");
    expect(resultText(tagList)).toContain("Tags");
    expect(resultText(tagList)).toContain("release/v1.0 annotated");
    expect(resultText(tagList)).toContain("snapshot lightweight");
    expect(tagList.details).toEqual({
      shownTagCount: 2,
      tagCount: 2,
      tags: [
        {
          annotated: true,
          date: expect.any(String),
          name: "release/v1.0",
          objectHash: expect.any(String),
          objectType: "tag",
          subject: "Release 1.0",
          targetHash: expect.any(String),
        },
        {
          annotated: false,
          date: expect.any(String),
          name: "snapshot",
          objectHash: expect.any(String),
          objectType: "commit",
          subject: "Initial commit",
          targetHash: expect.any(String),
        },
      ],
      truncated: null,
      worktreePath,
    });
  });

  it("creates and inspects notes on commits in the current worktree", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const createdResult = await executeTool(worktreePath, "git_notes", {
      message: "Needs review",
      target: "HEAD",
    });

    expect(resultText(createdResult)).toContain(
      `Added note to HEAD in ${worktreePath}.`,
    );
    expect(resultText(createdResult)).toContain("Ref: refs/notes/commits");
    expect(resultText(createdResult)).toContain("Mode: created");
    expect(resultText(createdResult)).toContain("Note lines: 1");
    expect(resultText(createdResult)).toContain("Needs review");
    expect(createdResult.details).toEqual({
      created: true,
      force: false,
      message: "Needs review",
      noteOutput: expect.any(String),
      noteText: "Needs review",
      previousNoteText: null,
      refName: "commits",
      refPath: "refs/notes/commits",
      resolvedTargetHash: expect.any(String),
      target: "HEAD",
      worktreePath,
    });

    const replacedResult = await executeTool(worktreePath, "git_notes", {
      force: true,
      message: "Updated review note",
      target: "HEAD",
    });

    expect(resultText(replacedResult)).toContain(
      `Added note to HEAD in ${worktreePath}.`,
    );
    expect(resultText(replacedResult)).toContain("Mode: replaced");
    expect(resultText(replacedResult)).toContain("Updated review note");
    expect(replacedResult.details).toEqual({
      created: false,
      force: true,
      message: "Updated review note",
      noteOutput: expect.any(String),
      noteText: "Updated review note",
      previousNoteText: "Needs review",
      refName: "commits",
      refPath: "refs/notes/commits",
      resolvedTargetHash: expect.any(String),
      target: "HEAD",
      worktreePath,
    });

    const noteShow = await executeTool(worktreePath, "git_notes_show", {
      maxLines: 50,
      target: "HEAD",
    });
    expect(resultText(noteShow)).toContain(`Git note for ${worktreePath}`);
    expect(resultText(noteShow)).toContain("Ref: refs/notes/commits");
    expect(resultText(noteShow)).toContain("Target: HEAD ->");
    expect(resultText(noteShow)).toContain("Updated review note");
    expect(noteShow.details).toEqual({
      found: true,
      lineCount: 1,
      lines: ["Updated review note"],
      refName: "commits",
      refPath: "refs/notes/commits",
      resolvedTargetHash: expect.any(String),
      target: "HEAD",
      truncated: null,
      worktreePath,
    });

    const noteRefs = await executeTool(worktreePath, "git_notes_list", {
      maxRefs: 10,
    });
    expect(resultText(noteRefs)).toContain(
      `Git notes refs for ${worktreePath}`,
    );
    expect(resultText(noteRefs)).toContain(
      "Showing 1 note ref(s) with limit 10.",
    );
    expect(resultText(noteRefs)).toContain("Notes refs");
    expect(resultText(noteRefs)).toContain("notes/commits commit");
    expect(noteRefs.details).toEqual({
      noteRefCount: 1,
      noteRefs: [
        {
          objectHash: expect.any(String),
          objectType: "commit",
          name: "notes/commits",
          subject: expect.stringContaining("Notes added by"),
        },
      ],
      shownNoteRefCount: 1,
      truncated: null,
      worktreePath,
    });
  });

  it("lists refs with dereferenced tag targets in the current worktree", async () => {
    const worktreePath = await createTaggedHistoryRepoFixture();
    const result = await executeTool(worktreePath, "git_show_ref", {
      dereference: true,
      includeHead: true,
      maxRefs: 50,
    });

    expect(resultText(result)).toContain(`Git show-ref for ${worktreePath}`);
    expect(resultText(result)).toContain(
      "Showing 4 ref(s) from 4 total with limit 50.",
    );
    expect(resultText(result)).toContain("Include HEAD: yes");
    expect(resultText(result)).toContain("Dereference: yes");
    expect(resultText(result)).toContain("Patterns: none");
    expect(resultText(result)).toContain("HEAD");
    expect(resultText(result)).toContain("refs/heads/master");
    expect(resultText(result)).toContain("refs/tags/v1");
    expect(resultText(result)).toContain("refs/tags/v1^{}");
    expect(result.details).toEqual({
      dereference: true,
      includeHead: true,
      patterns: [],
      refCount: 4,
      refs: [
        {
          hash: expect.any(String),
          namespace: "HEAD",
          peeled: false,
          ref: "HEAD",
        },
        {
          hash: expect.any(String),
          namespace: "heads",
          peeled: false,
          ref: "refs/heads/master",
        },
        {
          hash: expect.any(String),
          namespace: "tags",
          peeled: false,
          ref: "refs/tags/v1",
        },
        {
          hash: expect.any(String),
          namespace: "tags",
          peeled: true,
          ref: "refs/tags/v1^{}",
        },
      ],
      shownRefCount: 4,
      truncated: null,
      worktreePath,
    });
  });

  it("summarizes commits by author with shortlog", async () => {
    const worktreePath = await createShortlogRepoFixture();
    const result = await executeTool(worktreePath, "git_shortlog", {
      maxAuthors: 10,
      range: "HEAD",
    });

    expect(resultText(result)).toContain(`Git shortlog for ${worktreePath}`);
    expect(resultText(result)).toContain("Range: HEAD");
    expect(resultText(result)).toContain(
      "Showing 2 author group(s) across 3 commit(s).",
    );
    expect(resultText(result)).toContain("Exclude merges: yes");
    expect(resultText(result)).toContain("Authors");
    expect(resultText(result)).toContain("2 Alice <alice@example.com>");
    expect(resultText(result)).toContain("1 Bob <bob@example.com>");
    expect(result.details).toEqual({
      authorCount: 2,
      authors: [
        {
          authorText: "Alice <alice@example.com>",
          count: 2,
        },
        {
          authorText: "Bob <bob@example.com>",
          count: 1,
        },
      ],
      commitCount: 3,
      noMerges: true,
      range: "HEAD",
      shownAuthorCount: 2,
      truncated: null,
      worktreePath,
    });
  });

  it("describes the current commit with the nearest tag", async () => {
    const worktreePath = await createTaggedHistoryRepoFixture();
    const result = await executeTool(worktreePath, "git_describe", {
      commit: "HEAD",
    });

    expect(resultText(result)).toContain(`Git describe for ${worktreePath}`);
    expect(resultText(result)).toContain("Target: HEAD ->");
    expect(resultText(result)).toContain("Description: v1-1-g");
    expect(resultText(result)).toContain("Options: tags, long, always");
    expect(result.details).toEqual({
      all: false,
      commit: "HEAD",
      description: expect.stringMatching(/^v1-1-g[0-9a-f]+$/),
      long: true,
      resolvedCommitHash: expect.any(String),
      tags: true,
      worktreePath,
    });
  });

  it("validates ref and branch names with check-ref-format", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_check_ref_format", {
      names: ["feature/git-tools", "bad..ref", "refs/heads/bad.lock"],
    });

    expect(resultText(result)).toContain(
      `Git check-ref-format for ${worktreePath}`,
    );
    expect(resultText(result)).toContain("Mode: branch");
    expect(resultText(result)).toContain(
      "Checked 3 name(s); 1 valid, 2 invalid.",
    );
    expect(resultText(result)).toContain("Results");
    expect(resultText(result)).toContain(
      "feature/git-tools -> feature/git-tools",
    );
    expect(resultText(result)).toContain("bad..ref -> ERROR:");
    expect(resultText(result)).toContain("refs/heads/bad.lock -> ERROR:");
    expect(result.details).toEqual({
      branch: true,
      checkCount: 3,
      checks: [
        {
          error: null,
          input: "feature/git-tools",
          normalized: "feature/git-tools",
          valid: true,
        },
        {
          error: expect.stringContaining("not a valid branch name"),
          input: "bad..ref",
          normalized: null,
          valid: false,
        },
        {
          error: expect.stringContaining("not a valid branch name"),
          input: "refs/heads/bad.lock",
          normalized: null,
          valid: false,
        },
      ],
      invalidCount: 2,
      validCount: 1,
      worktreePath,
    });
  });

  it("summarizes repository object counts with count-objects", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_count_objects", {});

    expect(resultText(result)).toContain(
      `Git count-objects for ${worktreePath}`,
    );
    expect(resultText(result)).toContain(
      "Loose objects: 3; Packed objects: 0 object(s) in 0 pack(s); Garbage: 0 loose garbage object(s).",
    );
    expect(resultText(result)).toContain("count: 3");
    expect(resultText(result)).toContain("in-pack: 0");
    expect(resultText(result)).toContain("packs: 0");
    expect(resultText(result)).toContain("garbage: 0");
    expect(result.details).toEqual({
      count: 3,
      garbage: 0,
      inPack: 0,
      packs: 0,
      prunePackable: 0,
      rawOutput: expect.any(String),
      size: expect.any(Number),
      sizeGarbage: 0,
      sizePack: 0,
      worktreePath,
    });
  });

  it("resolves revision expressions in the current worktree", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const expectedHead = await runGitCommand(worktreePath, [
      "rev-parse",
      "HEAD",
    ]);
    const expectedParent = await runGitCommand(worktreePath, [
      "rev-parse",
      "HEAD~1",
    ]);
    const result = await executeTool(worktreePath, "git_rev_parse", {
      revisions: ["HEAD", "HEAD~1"],
    });

    expect(resultText(result)).toContain(`Git rev-parse for ${worktreePath}`);
    expect(resultText(result)).toContain("Resolved 2 of 2 revision(s).");
    expect(resultText(result)).toContain("Resolutions");
    expect(resultText(result)).toContain(`HEAD -> ${expectedHead}`);
    expect(resultText(result)).toContain(`HEAD~1 -> ${expectedParent}`);
    expect(result.details).toEqual({
      failedCount: 0,
      resultCount: 2,
      resolutions: [
        {
          error: null,
          input: "HEAD",
          resolvedHash: expectedHead,
        },
        {
          error: null,
          input: "HEAD~1",
          resolvedHash: expectedParent,
        },
      ],
      resolvedCount: 2,
      worktreePath,
    });
  });

  it("finds the merge base between diverged branches in the current worktree", async () => {
    const worktreePath = await createDivergedBranchRepoFixture();
    const expectedMergeBase = await runGitCommand(worktreePath, [
      "rev-parse",
      "HEAD~1",
    ]);
    const result = await executeTool(worktreePath, "git_merge_base", {
      leftRevision: "HEAD",
      rightRevision: "feature",
    });

    expect(resultText(result)).toContain(`Git merge-base for ${worktreePath}`);
    expect(resultText(result)).toContain("Left: HEAD ->");
    expect(resultText(result)).toContain("Right: feature ->");
    expect(resultText(result)).toContain("Showing 1 merge base(s).");
    expect(resultText(result)).toContain(expectedMergeBase);
    expect(result.details).toEqual({
      all: false,
      baseCount: 1,
      baseHashes: [expectedMergeBase],
      leftRevision: "HEAD",
      mergeBaseOutput: expectedMergeBase,
      resolvedLeftHash: expect.any(String),
      resolvedRightHash: expect.any(String),
      rightRevision: "feature",
      worktreePath,
    });
  });

  it("compares commit series with range-diff", async () => {
    const { baseHash, newTipHash, oldTipHash, worktreePath } =
      await createRangeDiffRepoFixture();
    const result = await executeTool(worktreePath, "git_range_diff", {
      baseRevision: "basepoint",
      oldTipRevision: "old-series",
      newTipRevision: "new-series",
    });

    expect(resultText(result)).toContain(`Git range-diff for ${worktreePath}`);
    expect(resultText(result)).toContain("Base: basepoint ->");
    expect(resultText(result)).toContain("Old tip: old-series ->");
    expect(resultText(result)).toContain("New tip: new-series ->");
    expect(resultText(result)).toContain("Options: none");
    expect(resultText(result)).toContain("Showing 2 line(s).");
    expect(resultText(result)).toContain("old change");
    expect(resultText(result)).toContain("new change");
    expect(result.details).toEqual({
      baseRevision: "basepoint",
      creationFactor: null,
      leftOnly: false,
      maxLines: 200,
      newTipRevision: "new-series",
      oldTipRevision: "old-series",
      rangeDiffLines: expect.arrayContaining([
        expect.stringContaining("old change"),
        expect.stringContaining("new change"),
      ]),
      rangeDiffOutput: expect.stringContaining("old change"),
      resolvedBaseHash: baseHash,
      resolvedNewTipHash: newTipHash,
      resolvedOldTipHash: oldTipHash,
      rightOnly: false,
      shownLineCount: 2,
      totalLineCount: 2,
      truncated: null,
      worktreePath,
    });
  });

  it("creates a commit from staged changes and returns the latest commit summary", async () => {
    const worktreePath = await createCommittedRepoFixture();
    await executeTool(worktreePath, "git_add", {
      paths: ["tracked.txt", "untracked.txt"],
    });
    const result = await executeTool(worktreePath, "git_commit", {
      message: "Snapshot changes",
    });

    expect(resultText(result)).toContain(
      `Committed changes in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Branch:");
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Snapshot changes");
    expect(result.details).toEqual({
      all: false,
      allowEmpty: false,
      amend: false,
      branch: expect.any(String),
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Snapshot changes",
      },
      commandOutput: expect.any(String),
      message: "Snapshot changes",
      worktreePath,
    });

    const logResult = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    expect(resultText(logResult)).toContain("Snapshot changes");
  });

  it("creates and switches to a new branch within the current worktree", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_switch", {
      branchName: "feature/git-tools",
      create: true,
    });

    expect(resultText(result)).toContain(
      "Created and switched to branch feature/git-tools.",
    );
    expect(resultText(result)).toContain("Current branch: feature/git-tools");
    expect(result.details).toEqual({
      branchName: "feature/git-tools",
      create: true,
      currentBranch: "feature/git-tools",
      startPoint: null,
      switchOutput: expect.any(String),
      worktreePath,
    });

    const logResult = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    expect(resultText(logResult)).toContain("Branch: feature/git-tools");
  });

  it("lists local branches with the checked-out branch highlighted", async () => {
    const worktreePath = await createCommittedRepoFixture();
    const result = await executeTool(worktreePath, "git_branch", {
      maxBranches: 50,
    });

    expect(resultText(result)).toContain(`Git branches for ${worktreePath}`);
    expect(resultText(result)).toContain("Current branch:");
    expect(resultText(result)).toContain("Branches");
    expect(result.details).toEqual({
      branchCount: 1,
      branches: [
        {
          current: true,
          hash: expect.any(String),
          name: expect.any(String),
          upstream: null,
        },
      ],
      currentBranch: expect.any(String),
      shownBranchCount: 1,
      truncated: null,
      worktreePath,
    });
  });

  it("searches the current worktree with grep and truncates matches", async () => {
    const worktreePath = await createGrepRepoFixture();
    const result = await executeTool(worktreePath, "git_grep", {
      fixedStrings: true,
      maxMatches: 1,
      paths: ["needle.txt"],
      pattern: "needle",
      revision: "HEAD",
    });

    expect(resultText(result)).toContain(`Git grep for ${worktreePath}`);
    expect(resultText(result)).toContain("Pattern: needle");
    expect(resultText(result)).toContain("Revision: HEAD");
    expect(resultText(result)).toContain("Paths: needle.txt");
    expect(resultText(result)).toContain("Ignore case: no");
    expect(resultText(result)).toContain("Fixed strings: yes");
    expect(resultText(result)).toContain(
      "Showing 1 match(es) from 2 total with limit 1.",
    );
    expect(resultText(result)).toContain("needle first");
    expect(result.details).toEqual({
      fixedStrings: true,
      ignoreCase: false,
      matchCount: 2,
      matches: [
        {
          lineNumber: 1,
          path: "needle.txt",
          text: "needle first",
        },
      ],
      maxMatches: 1,
      pattern: "needle",
      paths: ["needle.txt"],
      revision: "HEAD",
      shownMatchCount: 1,
      truncated: 1,
      worktreePath,
    });
  });

  it("blames a bounded line range in the current worktree", async () => {
    const worktreePath = await createBlameRepoFixture();
    const result = await executeTool(worktreePath, "git_blame", {
      ignoreWhitespace: true,
      maxLines: 3,
      path: "blame.txt",
      revision: "HEAD",
      startLine: 1,
    });

    expect(resultText(result)).toContain(`Git blame for ${worktreePath}`);
    expect(resultText(result)).toContain("Revision: HEAD ->");
    expect(resultText(result)).toContain("Path: blame.txt");
    expect(resultText(result)).toContain("Lines: 1-3");
    expect(resultText(result)).toContain("Ignore whitespace: yes");
    expect(resultText(result)).toContain("beta updated");
    expect(result.details).toEqual({
      endLine: 3,
      entries: [
        {
          authorName: "Alice",
          commitHash: expect.any(String),
          content: "alpha",
          finalLineNumber: 1,
          originalLineNumber: 1,
          summary: "Initial blame commit",
        },
        {
          authorName: "Bob",
          commitHash: expect.any(String),
          content: "beta updated",
          finalLineNumber: 2,
          originalLineNumber: 2,
          summary: "Update middle line",
        },
        {
          authorName: "Alice",
          commitHash: expect.any(String),
          content: "gamma",
          finalLineNumber: 3,
          originalLineNumber: 3,
          summary: "Initial blame commit",
        },
      ],
      ignoreWhitespace: true,
      lineCount: 3,
      maxLines: 3,
      path: "blame.txt",
      resolvedRevision: expect.any(String),
      revision: "HEAD",
      startLine: 1,
      worktreePath,
    });
  });

  it("merges a branch into the current branch without invoking bash", async () => {
    const {
      baseBranch,
      featureBranch,
      featureCommitHash,
      mainCommitHash,
      worktreePath,
    } = await createBranchingRepoFixture();
    const result = await executeTool(worktreePath, "git_merge", {
      ffMode: "no",
      message: "Merge feature branch",
      revisions: [featureBranch],
    });

    expect(resultText(result)).toContain(`Git merge for ${worktreePath}`);
    expect(resultText(result)).toContain(`Revisions: ${featureBranch}`);
    expect(resultText(result)).toContain(
      `Resolved revisions: ${featureCommitHash}`,
    );
    expect(resultText(result)).toContain("FF mode: no");
    expect(resultText(result)).toContain("Allow unrelated histories: no");
    expect(resultText(result)).toContain("Message: Merge feature branch");
    expect(resultText(result)).toContain(`Branch: ${baseBranch}`);
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Merge feature branch");
    expect(result.details).toEqual({
      action: "merge",
      allowUnrelatedHistories: false,
      branch: baseBranch,
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Merge feature branch",
      },
      ffMode: "no",
      message: "Merge feature branch",
      mergeOutput: expect.any(String),
      revisions: [featureBranch],
      resolvedRevisions: [featureCommitHash],
      worktreePath,
    });
    const mergeDetails = result.details as { commit: { hash: string } };
    expect(mergeDetails.commit.hash).not.toBe(mainCommitHash);
  });

  it("rebases the current branch onto another branch without invoking bash", async () => {
    const {
      baseBranch,
      featureBranch,
      featureCommitHash,
      mainCommitHash,
      worktreePath,
    } = await createBranchingRepoFixture();
    await runGitCommand(worktreePath, ["switch", featureBranch]);
    const result = await executeTool(worktreePath, "git_rebase", {
      forceRebase: true,
      upstreamRevision: baseBranch,
    });

    expect(resultText(result)).toContain(`Git rebase for ${worktreePath}`);
    expect(resultText(result)).toContain(
      `Upstream: ${baseBranch} -> ${mainCommitHash}`,
    );
    expect(resultText(result)).toContain("Onto: default");
    expect(resultText(result)).toContain("Force rebase: yes");
    expect(resultText(result)).toContain("Keep base: no");
    expect(resultText(result)).toContain(`Branch: ${featureBranch}`);
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Feature change");
    expect(result.details).toEqual({
      action: "rebase",
      branch: featureBranch,
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Feature change",
      },
      forceRebase: true,
      keepBase: false,
      ontoRevision: null,
      rebaseOutput: expect.any(String),
      resolvedOntoRevision: null,
      resolvedUpstreamRevision: mainCommitHash,
      upstreamRevision: baseBranch,
      worktreePath,
    });
    const rebaseDetails = result.details as { commit: { hash: string } };
    expect(rebaseDetails.commit.hash).not.toBe(featureCommitHash);
  });

  it("cherry-picks a commit onto the current branch without invoking bash", async () => {
    const { baseBranch, featureCommitHash, worktreePath } =
      await createBranchingRepoFixture();
    const result = await executeTool(worktreePath, "git_cherry_pick", {
      commits: [featureCommitHash],
      signoff: true,
    });

    expect(resultText(result)).toContain(`Git cherry-pick for ${worktreePath}`);
    expect(resultText(result)).toContain(`Commits: ${featureCommitHash}`);
    expect(resultText(result)).toContain(
      `Resolved commits: ${featureCommitHash}`,
    );
    expect(resultText(result)).toContain(`Mainline: none`);
    expect(resultText(result)).toContain("No commit: no");
    expect(resultText(result)).toContain("Signoff: yes");
    expect(resultText(result)).toContain(`Branch: ${baseBranch}`);
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Feature change");
    expect(result.details).toEqual({
      action: "pick",
      branch: baseBranch,
      cherryPickOutput: expect.any(String),
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Feature change",
      },
      commits: [featureCommitHash],
      mainline: null,
      noCommit: false,
      resolvedCommits: [featureCommitHash],
      signoff: true,
      worktreePath,
    });
    const cherryPickDetails = result.details as {
      commit: { hash: string };
    };
    expect(cherryPickDetails.commit.hash).not.toBe(featureCommitHash);
  });

  it("applies local patch files with git am without invoking bash", async () => {
    const { baseBranch, featureCommitHash, worktreePath } =
      await createBranchingRepoFixture();
    const patchOutput = await runGitCommand(worktreePath, [
      "format-patch",
      "-1",
      featureCommitHash,
      "--stdout",
    ]);
    writeFileSync(join(worktreePath, "feature.patch"), patchOutput);
    const result = await executeTool(worktreePath, "git_am", {
      keepCr: true,
      noVerify: true,
      patchPaths: ["feature.patch"],
      signoff: true,
      threeWay: true,
    });

    expect(resultText(result)).toContain(`Git am for ${worktreePath}`);
    expect(resultText(result)).toContain("Patch paths: feature.patch");
    expect(resultText(result)).toContain("Three way: yes");
    expect(resultText(result)).toContain("Signoff: yes");
    expect(resultText(result)).toContain("Keep CR: yes");
    expect(resultText(result)).toContain("No verify: yes");
    expect(resultText(result)).toContain(`Branch: ${baseBranch}`);
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Feature change");
    expect(result.details).toEqual({
      action: "apply",
      amOutput: expect.any(String),
      branch: baseBranch,
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: expect.any(String),
        shortHash: expect.any(String),
        subject: "Feature change",
      },
      keepCr: true,
      noVerify: true,
      patchPaths: ["feature.patch"],
      signoff: true,
      threeWay: true,
      worktreePath,
    });
  });

  it("lists linked worktrees for the current repository", async () => {
    const { baseBranch, featureBranch, worktreePath } =
      await createBranchingRepoFixture();
    const linkedWorktreePath = join(worktreePath, "linked-worktree");
    await runGitCommand(worktreePath, [
      "worktree",
      "add",
      linkedWorktreePath,
      featureBranch,
    ]);
    const result = await executeTool(worktreePath, "git_worktree_list", {
      maxWorktrees: 10,
    });

    expect(resultText(result)).toContain(`Git worktrees for ${worktreePath}`);
    expect(resultText(result)).toContain(worktreePath);
    expect(resultText(result)).toContain(linkedWorktreePath);
    expect(result.details).toEqual({
      currentWorktreePath: worktreePath,
      maxWorktrees: 10,
      shownWorktreeCount: 2,
      truncated: null,
      worktreeCount: 2,
      worktrees: [
        {
          bare: false,
          branch: baseBranch,
          current: true,
          head: expect.any(String),
          path: worktreePath,
          pinnedAt: null,
        },
        {
          bare: false,
          branch: featureBranch,
          current: false,
          head: expect.any(String),
          path: linkedWorktreePath,
          pinnedAt: null,
        },
      ],
      worktreePath,
    });
  });

  it("initializes the current directory as a repository", async () => {
    const worktreePath = createTempDirectory();
    const result = await executeTool(worktreePath, "git_init", {
      initialBranch: "main",
      quiet: true,
    });

    expect(existsSync(join(worktreePath, ".git"))).toBe(true);
    expect(resultText(result)).toContain(
      `Initialized Git repository in ${worktreePath}.`,
    );
    expect(resultText(result)).toContain("Initial branch: main");
    expect(resultText(result)).toContain("Quiet: yes");
    expect(result.details).toEqual({
      currentBranch: "main",
      initialBranch: "main",
      initOutput: "",
      quiet: true,
      worktreePath,
    });
  });

  it("shows a bounded diff snapshot for a specific commit", async () => {
    const worktreePath = await createHistoryRepoFixture();
    const logResult = await executeTool(worktreePath, "git_log", {
      limit: 1,
      offset: 0,
    });
    const commitHash = (
      logResult.details as { entries: Array<{ hash: string }> }
    ).entries[0]?.hash;
    const result = await executeTool(worktreePath, "git_show", {
      commitHash,
      maxDiffLines: 50,
    });

    expect(resultText(result)).toContain(`Git show for ${worktreePath}`);
    expect(resultText(result)).toContain("Commit:");
    expect(resultText(result)).toContain("Second commit");
    expect(resultText(result)).toContain("Diff");
    expect(result.details).toEqual({
      commit: {
        authorName: expect.any(String),
        committedAt: expect.any(String),
        hash: commitHash,
        shortHash: expect.any(String),
        subject: "Second commit",
      },
      commitHash,
      diffLineCount: expect.any(Number),
      diffLines: expect.any(Array),
      maxDiffLines: 50,
      shownDiffLineCount: expect.any(Number),
      truncated: null,
      worktreePath,
    });
  });
});
