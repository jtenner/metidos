/**
 * @file src/mainview/app/use-mainview-derived-state.test.ts
 * @description Test file for use mainview derived state.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcCodexModelOption,
  RpcProject,
  RpcThread,
  RpcWorktree,
} from "../../bun/rpc-schema";
import { worktreeKey } from "./state";
import {
  deriveActiveContextUsage,
  deriveWorktreeDisplayPathByKey,
} from "./use-mainview-derived-state";

/**
 * Builds a project fixture.
 * @param id - Identifier value.
 * @param path - Filesystem path.
 */

function project(id: number, path: string): RpcProject {
  return {
    createdAt: "2026-04-04T00:00:00.000Z",
    id,
    isOpen: 1,
    lastOpenedAt: "2026-04-04T00:00:00.000Z",
    name: `Project ${id}`,
    path,
    updatedAt: "2026-04-04T00:00:00.000Z",
  };
}
/**
 * Builds a worktree fixture.
 * @param path - Filesystem path.
 * @param branch - Target git branch.
 */

function worktree(path: string, branch: string | null = "main"): RpcWorktree {
  return {
    bare: false,
    branch,
    head: "abc123",
    path,
    pinnedAt: null,
  };
}

describe("deriveWorktreeDisplayPathByKey", () => {
  it("preformats worktree display paths with home-directory shorthand", () => {
    const projects = [project(7, "/Users/example/project")];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [
        7,
        [
          worktree("/Users/example/project"),
          worktree("/Users/example/project/feature"),
          worktree("/srv/shared/project"),
        ],
      ],
    ]);

    const result = deriveWorktreeDisplayPathByKey(
      projects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "/Users/example",
      true,
    );

    expect(result.get(worktreeKey(7, "/Users/example/project"))).toBe(
      "~/project",
    );
    expect(result.get(worktreeKey(7, "/Users/example/project/feature"))).toBe(
      "~/project/feature",
    );
    expect(result.get(worktreeKey(7, "/srv/shared/project"))).toBe(
      "/srv/shared/project",
    );
  });

  it("falls back to raw paths when tilde formatting is disabled", () => {
    const projects = [project(3, "/Users/example/project")];
    const worktreesByProjectId = new Map<number, RpcWorktree[]>([
      [3, [worktree("/Users/example/project/feature")]],
    ]);

    const result = deriveWorktreeDisplayPathByKey(
      projects,
      (projectId) => worktreesByProjectId.get(projectId) ?? [],
      "/Users/example",
      false,
    );

    expect(result.get(worktreeKey(3, "/Users/example/project/feature"))).toBe(
      "/Users/example/project/feature",
    );
  });
});

describe("deriveActiveContextUsage", () => {
  it("prefers live thread usage window over the model catalog window", () => {
    const selectedThread = {
      usage: {
        inputTokens: 20_361,
        cachedInputTokens: 19_584,
        outputTokens: 341,
        contextWindowTokens: 121_600,
      },
    } as RpcThread;

    expect(
      deriveActiveContextUsage(selectedThread, {
        contextWindowTokens: 400_000,
      } as RpcCodexModelOption),
    ).toEqual({
      inputTokens: 20_361,
      contextWindowTokens: 121_600,
    });
  });

  it("falls back to the model catalog when no live session window is available", () => {
    const selectedThread = {
      usage: {
        inputTokens: 11_000,
        cachedInputTokens: 5_000,
        outputTokens: 400,
      },
    } as RpcThread;

    expect(
      deriveActiveContextUsage(selectedThread, {
        contextWindowTokens: 400_000,
      } as RpcCodexModelOption),
    ).toEqual({
      inputTokens: 11_000,
      contextWindowTokens: 400_000,
    });
  });
});
