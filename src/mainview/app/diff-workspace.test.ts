/**
 * @file src/mainview/app/diff-workspace.test.ts
 * @description Tests for the diff workspace file navigator model.
 */

import { describe, expect, it } from "bun:test";

import type { RpcWorktreeChange } from "../../bun/rpc-schema";
import {
  buildDiffFileTree,
  isNonGitRepositoryDiffError,
} from "./diff-workspace";

function change(path: string): RpcWorktreeChange {
  return {
    path,
    previousPath: null,
    stagedStatus: null,
    unstagedStatus: "modified",
  };
}

describe("diff workspace non-git detection", () => {
  it("recognizes repository availability errors", () => {
    expect(isNonGitRepositoryDiffError("fatal: not a git repository")).toBe(
      true,
    );
    expect(
      isNonGitRepositoryDiffError(
        "fatal: this operation must be run in a work tree",
      ),
    ).toBe(true);
    expect(
      isNonGitRepositoryDiffError("Worktree not found for project /tmp/demo"),
    ).toBe(true);
    expect(isNonGitRepositoryDiffError("permission denied")).toBe(false);
  });
});

describe("diff workspace file tree", () => {
  it("groups files by full containing directory paths", () => {
    const tree = buildDiffFileTree([
      change("docs/research/alpha.md"),
      change("docs/research/beta.md"),
      change("src/mainview/app/diff-workspace.tsx"),
      change("README.md"),
    ]);

    expect(tree.map((node) => node.label)).toEqual([
      "docs/research",
      "src/mainview/app",
      "README.md",
    ]);
    expect(tree[0]?.children.map((node) => node.label)).toEqual([
      "alpha.md",
      "beta.md",
    ]);
    expect(tree[1]?.children.map((node) => node.label)).toEqual([
      "diff-workspace.tsx",
    ]);
  });
});
