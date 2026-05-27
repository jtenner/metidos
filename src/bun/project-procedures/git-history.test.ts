/**
 * @file src/bun/project-procedures/git-history.test.ts
 * @description Tests for git history cache pagination repair.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fillGitHistoryCache,
  type WorktreeGitHistoryCacheState,
} from "./git-history";

const tempPaths: string[] = [];

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-git-history-cache-test-"));
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

describe("fillGitHistoryCache", () => {
  test("repairs a changed-head cache whose entries were cleared by polling", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
    execFileSync("git", ["checkout", "-b", "main"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    writeFileSync(join(worktreePath, "tracked.txt"), "content\n");
    execFileSync("git", ["add", "tracked.txt"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    const headHash = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
    }).trim();

    const state: WorktreeGitHistoryCacheState = {
      history: {
        branch: "main",
        headHash,
        headShortHash: headHash.slice(0, 7),
        lastUpdatedAt: new Date().toISOString(),
        projectId: 1,
        worktreePath,
      },
      historyEntries: [],
      historyNextOffset: null,
      historyPrefetch: null,
      historySignature: `main\n${headHash}`,
    };

    await fillGitHistoryCache(state, worktreePath, 0, 20, "foreground");

    expect(state.historyEntries).toHaveLength(1);
    expect(state.historyEntries[0]?.hash).toBe(headHash);
    expect(state.historyNextOffset).toBeNull();
  });
});
