/**
 * @file src/bun/git.test.ts
 * @description Test file for git.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeGitPath, readWorktreeFileContentPage } from "./git";

const tempPaths: string[] = [];

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-git-test-"));
  tempPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
});

describe("normalizeGitPath", () => {
  test("rejects lexical traversal outside the worktree", () => {
    const worktreePath = makeTempDir();
    expect(() => normalizeGitPath(worktreePath, "../secret.txt")).toThrow(
      /Path must stay within worktree/,
    );
  });

  test("rejects symlink escapes outside the worktree", async () => {
    if (process.platform === "win32") {
      return;
    }

    const sandboxPath = makeTempDir();
    const worktreePath = join(sandboxPath, "worktree");
    const outsidePath = join(sandboxPath, "outside");
    mkdirSync(worktreePath);
    mkdirSync(outsidePath);
    writeFileSync(join(outsidePath, "secret.txt"), "secret");
    symlinkSync(outsidePath, join(worktreePath, "linked-outside"));

    expect(() =>
      normalizeGitPath(worktreePath, "linked-outside/secret.txt"),
    ).toThrow(/Path must stay within worktree/);

    await expect(
      readWorktreeFileContentPage(worktreePath, "linked-outside/secret.txt"),
    ).rejects.toThrow(/Path must stay within worktree/);
  });

  test("preserves valid in-worktree paths", () => {
    const worktreePath = makeTempDir();
    mkdirSync(join(worktreePath, "src"));
    expect(normalizeGitPath(worktreePath, "src/index.ts")).toBe("src/index.ts");
  });
});
