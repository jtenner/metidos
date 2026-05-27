/**
 * @file src/bun/rpc-authz.test.ts
 * @description Test file for rpc authz.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createThreadTargetsDifferentWorkspace } from "./rpc-authz";

function tempWorkspace(name: string): string {
  return mkdtempSync(join(tmpdir(), `metidos-rpc-authz-${name}-`));
}

describe("rpc authz helpers", () => {
  it("reports false when the target thread stays in the current workspace", () => {
    const worktreePath = tempWorkspace("same");

    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 7,
        worktreePath,
        currentProjectId: 7,
        currentWorktreePath: `${worktreePath}/`,
      }),
    ).toBeFalse();
  });

  it("reports cross-project thread creation", () => {
    const worktreePath = tempWorkspace("project");

    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 8,
        worktreePath,
        currentProjectId: 7,
        currentWorktreePath: worktreePath,
      }),
    ).toBeTrue();
  });

  it("reports cross-worktree thread creation", () => {
    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 7,
        worktreePath: tempWorkspace("feature-b"),
        currentProjectId: 7,
        currentWorktreePath: tempWorkspace("feature-a"),
      }),
    ).toBeTrue();
  });

  it("reports true when no current workspace context is supplied", () => {
    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 7,
        worktreePath: tempWorkspace("missing-context"),
      }),
    ).toBeTrue();
  });

  it("reports true when either workspace path cannot be resolved", () => {
    const worktreePath = tempWorkspace("existing");

    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 7,
        worktreePath,
        currentProjectId: 7,
        currentWorktreePath: `${worktreePath}/missing`,
      }),
    ).toBeTrue();
  });

  it("reports true when canonical path resolution throws", () => {
    const worktreePath = tempWorkspace("existing");
    const loopPath = `${worktreePath}/loop`;
    symlinkSync(loopPath, loopPath);

    expect(
      createThreadTargetsDifferentWorkspace({
        projectId: 7,
        worktreePath,
        currentProjectId: 7,
        currentWorktreePath: loopPath,
      }),
    ).toBeTrue();
  });
});
