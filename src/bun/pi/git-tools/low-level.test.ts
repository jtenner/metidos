/**
 * @file src/bun/pi/git-tools/low-level.test.ts
 * @description Tests for the low-level Git helper tool surface.
 */

import { afterEach, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGitCommand } from "../../git";
import { createPiGitCliHost, createPiGitTools } from "./index";
import type { PiGitToolScope } from "./shared";

const tempDirectories = new Set<string>();

function createTempDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-pi-git-low-level-"));
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

async function createLowLevelRepoFixture(): Promise<{
  baseBranch: string;
  baseCommitHash: string;
  featureBranch: string;
  featureCommitHash: string;
  mainCommitHash: string;
  releaseTag: string;
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
  const baseCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);
  const baseBranch = await runGitCommand(worktreePath, [
    "branch",
    "--show-current",
  ]);
  const releaseTag = "release-v1";
  await runGitCommand(worktreePath, [
    "tag",
    "-a",
    releaseTag,
    "-m",
    "Release 1",
  ]);

  await runGitCommand(worktreePath, ["switch", "-c", "feature"]);
  writeFileSync(join(worktreePath, "tracked.txt"), "feature\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Feature commit"]);
  const featureCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);

  await runGitCommand(worktreePath, ["switch", baseBranch]);
  writeFileSync(join(worktreePath, "tracked.txt"), "main\n");
  await runGitCommand(worktreePath, ["add", "tracked.txt"]);
  await runGitCommand(worktreePath, ["commit", "-m", "Main commit"]);
  const mainCommitHash = await runGitCommand(worktreePath, [
    "rev-parse",
    "HEAD",
  ]);

  return {
    baseBranch,
    baseCommitHash,
    featureBranch: "feature",
    featureCommitHash,
    mainCommitHash,
    releaseTag,
    worktreePath,
  };
}

it("lists refs with structured filters and a bounded result set", async () => {
  const { featureBranch, releaseTag, worktreePath } =
    await createLowLevelRepoFixture();
  const result = await executeTool(worktreePath, "git_for_each_ref", {
    includeRootRefs: true,
    maxRefs: 20,
    patterns: ["refs/heads/*", "refs/tags/*"],
    sort: ["refname"],
  });

  expect(resultText(result)).toContain(`Git refs for ${worktreePath}`);
  expect(resultText(result)).toContain(`refs/heads/${featureBranch}`);
  expect(resultText(result)).toContain(`refs/tags/${releaseTag}`);
  expect(result.details).toEqual(
    expect.objectContaining({
      includeRootRefs: true,
      maxRefs: 20,
      patternCount: 2,
      patterns: ["refs/heads/*", "refs/tags/*"],
      shownRefCount: expect.any(Number),
      sort: ["refname"],
      totalRefCount: expect.any(Number),
      truncatedRefCount: null,
      worktreePath,
    }),
  );
  expect(
    (result.details as { entries: Array<{ ref: string }> }).entries,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ ref: `refs/heads/${featureBranch}` }),
      expect.objectContaining({ ref: `refs/tags/${releaseTag}` }),
    ]),
  );
});

it("compares upstream and head revisions with git cherry", async () => {
  const { baseBranch, featureCommitHash, featureBranch, worktreePath } =
    await createLowLevelRepoFixture();
  const result = await executeTool(worktreePath, "git_cherry", {
    abbrevDigits: 8,
    headRevision: featureBranch,
    limit: 20,
    upstreamRevision: baseBranch,
    verbose: true,
  });

  expect(resultText(result)).toContain(`Git cherry for ${worktreePath}`);
  expect(resultText(result)).toContain(`Upstream: ${baseBranch}`);
  expect(resultText(result)).toContain(`Head: ${featureBranch}`);
  expect(resultText(result)).toContain(`Feature commit`);
  expect(resultText(result)).toContain(`+ ${featureCommitHash.slice(0, 8)}`);
  expect(result.details).toEqual(
    expect.objectContaining({
      abbrevDigits: 8,
      aheadCount: 1,
      equivalentCount: 0,
      headRevision: featureBranch,
      limit: 20,
      upstreamRevision: baseBranch,
      verbose: true,
      worktreePath,
    }),
  );
  expect(
    (
      result.details as {
        entries: Array<{
          ahead: boolean;
          commitHash: string;
          subject: string | null;
        }>;
      }
    ).entries,
  ).toEqual([
    expect.objectContaining({
      ahead: true,
      commitHash: expect.stringMatching(/^.{8}$/u),
      subject: "Feature commit",
    }),
  ]);
});

it("shows branch relationships with bounded output", async () => {
  const { baseBranch, featureBranch, worktreePath } =
    await createLowLevelRepoFixture();
  const result = await executeTool(worktreePath, "git_show_branch", {
    current: true,
    maxLines: 20,
    mode: "show",
    revisions: [baseBranch, featureBranch],
    topoOrder: true,
  });

  expect(resultText(result)).toContain(`Git show-branch for ${worktreePath}`);
  expect(resultText(result)).toContain(baseBranch);
  expect(resultText(result)).toContain(featureBranch);
  expect(resultText(result)).toContain("Feature commit");
  expect(resultText(result)).toContain("Main commit");
  expect(result.details).toEqual(
    expect.objectContaining({
      current: true,
      maxLines: 20,
      mode: "show",
      revisions: [baseBranch, featureBranch],
      shownLineCount: expect.any(Number),
      totalLineCount: expect.any(Number),
      topoOrder: true,
      truncatedLineCount: null,
      worktreePath,
    }),
  );
  expect((result.details as { lines: string[] }).lines).toEqual(
    expect.arrayContaining([expect.stringContaining("Feature commit")]),
  );
});

it("reports dangling objects with git fsck", async () => {
  const { worktreePath } = await createLowLevelRepoFixture();
  const orphanPath = join(worktreePath, "orphan.txt");
  writeFileSync(orphanPath, "orphan\n");
  const danglingBlobHash = await runGitCommand(worktreePath, [
    "hash-object",
    "-w",
    "orphan.txt",
  ]);
  const result = await executeTool(worktreePath, "git_fsck", {
    dangling: true,
    maxLines: 20,
  });

  expect(resultText(result)).toContain(`Git fsck for ${worktreePath}`);
  expect(resultText(result)).toContain(`dangling blob ${danglingBlobHash}`);
  expect(result.details).toEqual(
    expect.objectContaining({
      dangling: true,
      exitCode: 0,
      maxLines: 20,
      messageCount: expect.any(Number),
      totalLineCount: expect.any(Number),
      truncatedLineCount: null,
      worktreePath,
    }),
  );
  expect(
    (result.details as { messages: Array<{ category: string; text: string }> })
      .messages,
  ).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        category: "dangling",
        text: expect.stringContaining(danglingBlobHash),
      }),
    ]),
  );
});

it("inspects object metadata and previews object contents with git cat-file", async () => {
  const { baseCommitHash, worktreePath } = await createLowLevelRepoFixture();
  const typeResult = await executeTool(worktreePath, "git_cat_file", {
    mode: "type",
    object: baseCommitHash,
  });

  expect(resultText(typeResult)).toContain(`Git cat-file for ${worktreePath}`);
  expect(resultText(typeResult)).toContain(`Object: ${baseCommitHash}`);
  expect(resultText(typeResult)).toContain("Type: commit");
  expect(typeResult.details).toEqual(
    expect.objectContaining({
      exists: true,
      mode: "type",
      object: baseCommitHash,
      objectType: "commit",
      worktreePath,
    }),
  );

  const prettyResult = await executeTool(worktreePath, "git_cat_file", {
    maxBytes: 4_096,
    maxLines: 20,
    mode: "pretty",
    object: baseCommitHash,
  });

  expect(resultText(prettyResult)).toContain("Mode: pretty");
  expect(resultText(prettyResult)).toContain("Exists: yes");
  expect(resultText(prettyResult)).toContain("Type: commit");
  expect(resultText(prettyResult)).toContain("Base commit");
  expect(prettyResult.details).toEqual(
    expect.objectContaining({
      content: expect.stringContaining("Base commit"),
      exists: true,
      mode: "pretty",
      object: baseCommitHash,
      objectType: "commit",
      shownLineCount: expect.any(Number),
      totalByteLength: expect.any(Number),
      totalLineCount: expect.any(Number),
      truncatedByBytes: false,
      truncatedLineCount: null,
      worktreePath,
    }),
  );
});
