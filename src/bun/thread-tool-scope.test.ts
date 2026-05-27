/**
 * @file src/bun/thread-tool-scope.test.ts
 * @description Test file for thread tool scope helpers.
 */

import { describe, expect, it } from "bun:test";

import {
  canonicalizeThreadToolPath,
  enforceBoundThreadScope,
  enforceTargetScope,
  threadToolPathsEqual,
} from "./thread-tool-scope";

describe("thread tool scope helpers", () => {
  it("canonicalizes relative paths against a base directory", () => {
    expect(
      canonicalizeThreadToolPath("subdir/file.ts", {
        baseDirectory: "/repo/worktree",
        platform: "linux",
      }),
    ).toBe("/repo/worktree/subdir/file.ts");
  });

  it("compares paths after canonical normalization", () => {
    expect(
      threadToolPathsEqual("/repo/worktree", "/repo/worktree/", {
        platform: "linux",
      }),
    ).toBeTrue();
  });

  it("rejects thread ids outside the bound thread scope", () => {
    expect(() => enforceBoundThreadScope(12, 11)).toThrow(
      "Thread 12 is outside the bound thread 11.",
    );
  });

  it("allows in-scope project and worktree targets without override", () => {
    expect(() =>
      enforceTargetScope({
        projectIdContext: 7,
        targetProjectId: 7,
        targetWorktreePath: "/repo/worktree",
        worktreePathContext: "/repo/worktree",
      }),
    ).not.toThrow();
  });

  it("rejects cross-project targets from a bound project", () => {
    expect(() =>
      enforceTargetScope({
        projectIdContext: 7,
        targetProjectId: 9,
        targetWorktreePath: "/repo/worktree",
      }),
    ).toThrow("Cross-project access is not allowed from bound project 7.");
  });

  it("rejects cross-worktree targets from a bound worktree", () => {
    expect(() =>
      enforceTargetScope({
        baseDirectory: "/repo",
        projectIdContext: 7,
        targetProjectId: 7,
        targetWorktreePath: "/repo/feature-b",
        worktreePathContext: "/repo/feature-a",
      }),
    ).toThrow(
      "Cross-worktree access is not allowed from bound worktree /repo/feature-a.",
    );
  });

  it("allows same-project targets when no worktree binding exists", () => {
    expect(() =>
      enforceTargetScope({
        projectIdContext: 7,
        targetProjectId: 7,
        targetWorktreePath: "/repo/feature-b",
      }),
    ).not.toThrow();
  });
});
