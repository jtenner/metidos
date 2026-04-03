import { describe, expect, it } from "bun:test";

import {
  canonicalizeSidecarPath,
  enforceBoundThreadScope,
  enforceTargetScope,
  sidecarPathsEqual,
} from "./codex-sidecar-scope";

describe("codex sidecar scope helpers", () => {
  it("canonicalizes relative paths against a base directory", () => {
    expect(
      canonicalizeSidecarPath("subdir/file.ts", {
        baseDirectory: "/repo/worktree",
        platform: "linux",
      }),
    ).toBe("/repo/worktree/subdir/file.ts");
  });

  it("compares paths after canonical normalization", () => {
    expect(
      sidecarPathsEqual("/repo/worktree", "/repo/worktree/", {
        platform: "linux",
      }),
    ).toBeTrue();
  });

  it("rejects thread ids outside the bound thread scope", () => {
    expect(() => enforceBoundThreadScope(12, 11)).toThrow(
      "Thread 12 is outside the bound sidecar thread 11.",
    );
  });

  it("allows in-scope project and worktree targets without override", () => {
    expect(() =>
      enforceTargetScope({
        allowCrossProject: false,
        projectIdContext: 7,
        targetProjectId: 7,
        targetWorktreePath: "/repo/worktree",
        worktreePathContext: "/repo/worktree",
      }),
    ).not.toThrow();
  });

  it("rejects cross-project targets without explicit override", () => {
    expect(() =>
      enforceTargetScope({
        projectIdContext: 7,
        targetProjectId: 9,
        targetWorktreePath: "/repo/worktree",
      }),
    ).toThrow("Cross-project access requires allowCrossProject=true.");
  });

  it("rejects cross-worktree targets without explicit override", () => {
    expect(() =>
      enforceTargetScope({
        baseDirectory: "/repo",
        projectIdContext: 7,
        targetProjectId: 7,
        targetWorktreePath: "/repo/feature-b",
        worktreePathContext: "/repo/feature-a",
      }),
    ).toThrow("Cross-worktree access requires allowCrossProject=true.");
  });

  it("allows cross-scope targets when override is explicit", () => {
    expect(() =>
      enforceTargetScope({
        allowCrossProject: true,
        projectIdContext: 7,
        targetProjectId: 9,
        targetWorktreePath: "/repo/feature-b",
        worktreePathContext: "/repo/feature-a",
      }),
    ).not.toThrow();
  });
});
