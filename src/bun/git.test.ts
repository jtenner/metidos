/**
 * @file src/bun/git.test.ts
 * @description Test file for git.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildGitSpawnEnv,
  normalizeGitPath,
  readGitCommitDiffResult,
  readGitHistoryFirstPage,
  readGitHistorySummary,
  readGitTextStream,
  readWorktreeChangeDiff,
  readWorktreeFileContentPage,
  readWorktreeSnapshot,
} from "./git";

const tempPaths: string[] = [];

function makeStream(
  chunks: Array<string | Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(
          typeof chunk === "string" ? encoder.encode(chunk) : chunk,
        );
      }
      controller.close();
    },
  });
}

function makeTempDir(): string {
  const path = mkdtempSync(join(tmpdir(), "metidos-git-test-"));
  tempPaths.push(path);
  return path;
}

function setupCommittedRepo(worktreePath: string): void {
  execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: worktreePath,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Test User"], {
    cwd: worktreePath,
    stdio: "ignore",
  });
}

afterEach(() => {
  for (const path of tempPaths.splice(0)) {
    rmSync(path, {
      force: true,
      recursive: true,
    });
  }
});

describe("buildGitSpawnEnv", () => {
  test("preserves the frozen git spawn allowlist", () => {
    const spawnEnv = buildGitSpawnEnv({
      GIT_CONFIG_GLOBAL: "/tmp/unsafe-gitconfig",
      HOME: "/home/operator",
      PATH: "/usr/bin",
      XDG_CONFIG_HOME: "/tmp/unsafe-xdg-config",
      XDG_DATA_HOME: "/tmp/unsafe-xdg-data",
    });

    expect(spawnEnv).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      HOME: "/home/operator",
      PATH: "/usr/bin",
    });
    expect(Object.isFrozen(spawnEnv)).toBe(true);
  });
});

describe("readGitTextStream", () => {
  test("decodes successful large output once after byte collection", async () => {
    const largeText = `${"x".repeat(128 * 1024)}✓${"y".repeat(128 * 1024)}`;

    await expect(readGitTextStream(makeStream([largeText]))).resolves.toBe(
      largeText,
    );
  });

  test("rejects stdout that exceeds the byte limit", async () => {
    let exceeded = false;

    await expect(
      readGitTextStream(makeStream(["abcd", "ef"]), {
        maxBytes: 5,
        onMaxBytesExceeded: () => {
          exceeded = true;
        },
      }),
    ).rejects.toThrow(/exceeded 5 bytes/);
    expect(exceeded).toBe(true);
  });

  test("returns captured stderr text when abort is swallowed", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.enqueue(new TextEncoder().encode("partial stderr"));
        controller.abort(new Error("stop"));
      },
      cancel() {},
    });

    const result = readGitTextStream(stream, {
      signal: controller.signal,
      swallowAbort: true,
    });

    await expect(result).resolves.toBe("partial stderr");
  });

  test("rejects when abort is not swallowed", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      pull(streamController) {
        streamController.enqueue(new TextEncoder().encode("partial stdout"));
        controller.abort(new Error("stop"));
      },
      cancel() {},
    });

    const result = readGitTextStream(stream, {
      signal: controller.signal,
    });

    await expect(result).rejects.toThrow(/stop/);
  });
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

describe("git history reads", () => {
  test("reads first page and branch without decorated log metadata", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
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
    writeFileSync(join(worktreePath, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const { history, summary, signature } = await readGitHistoryFirstPage(
      1,
      worktreePath,
      20,
    );

    const firstEntry = history.entries[0];
    expect(firstEntry).toBeDefined();
    if (!firstEntry) {
      throw new Error("Expected one git history entry.");
    }
    expect(summary.branch).toBe("main");
    expect(summary.headHash).toBe(firstEntry.hash);
    expect(summary.headShortHash).toBe(firstEntry.shortHash);
    expect(history.branch).toBe("main");
    expect(history.entries).toHaveLength(1);
    expect(signature).toBe(`main\n${summary.headHash}`);
  });

  test("preserves unborn branch names for empty repositories", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["checkout", "-b", "main"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    const { history } = await readGitHistorySummary(1, worktreePath);

    expect(history.branch).toBe("main");
    expect(history.headHash).toBeNull();
  });
});

describe("readWorktreeChangeDiff", () => {
  test("omits oversized untracked files from synthetic add diffs", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
    writeFileSync(join(worktreePath, "large.log"), "x".repeat(1024 * 1024 + 1));

    const diff = await readWorktreeChangeDiff(worktreePath, {
      path: "large.log",
      previousPath: null,
      stagedStatus: null,
      unstagedStatus: "untracked",
    });

    expect(diff).toContain("+++ b/large.log");
    expect(diff).toContain("[large file omitted from synthetic diff: 1.0 MiB]");
    expect(diff).not.toContain("xxx");
  });

  test("omits binary untracked files from synthetic add diffs", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
    writeFileSync(join(worktreePath, "binary.dat"), new Uint8Array([0, 1, 2]));

    const diff = await readWorktreeChangeDiff(worktreePath, {
      path: "binary.dat",
      previousPath: null,
      stagedStatus: null,
      unstagedStatus: "untracked",
    });

    expect(diff).toContain("+++ b/binary.dat");
    expect(diff).toContain("[binary file omitted from synthetic diff: 3 B]");
  });
});

describe("readWorktreeSnapshot", () => {
  test("does not execute repository core.fsmonitor commands", async () => {
    if (process.platform === "win32") {
      return;
    }

    const sandboxPath = makeTempDir();
    const worktreePath = join(sandboxPath, "repo");
    const markerPath = join(sandboxPath, "fsmonitor-ran.txt");
    mkdirSync(worktreePath);
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
    execFileSync(
      "git",
      [
        "config",
        "core.fsmonitor",
        `sh -c "echo fsmonitor-ran > ${markerPath}"`,
      ],
      {
        cwd: worktreePath,
        stdio: "ignore",
      },
    );
    writeFileSync(join(worktreePath, "tracked.txt"), "before\n");

    await readWorktreeSnapshot(worktreePath);

    expect(existsSync(markerPath)).toBe(false);
  });

  test("does not execute repository textconv commands while reading diffs", async () => {
    if (process.platform === "win32") {
      return;
    }

    const sandboxPath = makeTempDir();
    const worktreePath = join(sandboxPath, "repo");
    const markerPath = join(sandboxPath, "textconv-ran.txt");
    mkdirSync(worktreePath);
    setupCommittedRepo(worktreePath);
    execFileSync(
      "git",
      [
        "config",
        "diff.pwn.textconv",
        `sh -c "echo textconv-ran > ${markerPath}; cat "$1"" -`,
      ],
      { cwd: worktreePath, stdio: "ignore" },
    );
    writeFileSync(join(worktreePath, ".gitattributes"), "*.pwn diff=pwn\n");
    writeFileSync(join(worktreePath, "tracked.pwn"), "before\n");
    execFileSync("git", ["add", "."], { cwd: worktreePath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    writeFileSync(join(worktreePath, "tracked.pwn"), "after\n");

    const snapshot = await readWorktreeSnapshot(worktreePath);
    const diff = await readWorktreeChangeDiff(worktreePath, {
      path: "tracked.pwn",
      previousPath: null,
      stagedStatus: null,
      unstagedStatus: "modified",
    });

    expect(snapshot.diff).toContain("diff --git a/tracked.pwn b/tracked.pwn");
    expect(diff).toContain("diff --git a/tracked.pwn b/tracked.pwn");
    expect(existsSync(markerPath)).toBe(false);
  });

  test("does not execute repository textconv commands while reading commit diffs", async () => {
    if (process.platform === "win32") {
      return;
    }

    const sandboxPath = makeTempDir();
    const worktreePath = join(sandboxPath, "repo");
    const markerPath = join(sandboxPath, "show-textconv-ran.txt");
    mkdirSync(worktreePath);
    setupCommittedRepo(worktreePath);
    execFileSync(
      "git",
      [
        "config",
        "diff.pwn.textconv",
        `sh -c "echo textconv-ran > ${markerPath}; cat "$1"" -`,
      ],
      { cwd: worktreePath, stdio: "ignore" },
    );
    writeFileSync(join(worktreePath, ".gitattributes"), "*.pwn diff=pwn\n");
    writeFileSync(join(worktreePath, "tracked.pwn"), "before\n");
    execFileSync("git", ["add", "."], { cwd: worktreePath, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    writeFileSync(join(worktreePath, "tracked.pwn"), "after\n");
    execFileSync("git", ["add", "tracked.pwn"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "update"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    const headHash = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf8",
    }).trim();

    const result = await readGitCommitDiffResult(1, worktreePath, headHash);

    expect(result.diffText).toContain("diff --git a/tracked.pwn b/tracked.pwn");
    expect(existsSync(markerPath)).toBe(false);
  });

  test("derives short status files from the rich porcelain snapshot", async () => {
    const worktreePath = makeTempDir();
    execFileSync("git", ["init"], { cwd: worktreePath, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Test User"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    writeFileSync(join(worktreePath, "tracked.txt"), "before\n");
    execFileSync("git", ["add", "tracked.txt"], {
      cwd: worktreePath,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "init"], {
      cwd: worktreePath,
      stdio: "ignore",
    });

    writeFileSync(join(worktreePath, "tracked.txt"), "after\n");
    writeFileSync(join(worktreePath, "new.txt"), "new\n");

    const snapshot = await readWorktreeSnapshot(worktreePath);

    expect(snapshot.changes.map((change) => change.path)).toEqual([
      "new.txt",
      "tracked.txt",
    ]);
    expect(snapshot.files).toEqual(["?? new.txt", " M tracked.txt"]);
    expect(snapshot.diff).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect(snapshot.diff).toContain("-before");
    expect(snapshot.diff).toContain("+after");
  });
});
