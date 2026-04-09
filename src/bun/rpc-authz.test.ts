/**
 * @file src/bun/rpc-authz.test.ts
 * @description Test file for rpc authz.
 */

import { describe, expect, it, mock } from "bun:test";

import { createThreadRequiresStepUp, enforceRpcStepUp } from "./rpc-authz";

describe("rpc authz helpers", () => {
  it("does not require step-up when the target thread stays in the current workspace", () => {
    expect(
      createThreadRequiresStepUp({
        projectId: 7,
        worktreePath: "/repo/worktree",
        currentProjectId: 7,
        currentWorktreePath: "/repo/worktree/",
      }),
    ).toBeFalse();
  });

  it("requires step-up for cross-project thread creation", () => {
    expect(
      createThreadRequiresStepUp({
        projectId: 8,
        worktreePath: "/repo/worktree",
        currentProjectId: 7,
        currentWorktreePath: "/repo/worktree",
      }),
    ).toBeTrue();
  });

  it("requires step-up for cross-worktree thread creation", () => {
    expect(
      createThreadRequiresStepUp({
        projectId: 7,
        worktreePath: "/repo/feature-b",
        currentProjectId: 7,
        currentWorktreePath: "/repo/feature-a",
      }),
    ).toBeTrue();
  });

  it("skips cross-workspace checks when no current workspace context is supplied", () => {
    expect(
      createThreadRequiresStepUp({
        projectId: 7,
        worktreePath: "/repo/worktree",
      }),
    ).toBeFalse();
  });

  it("skips step-up enforcement when auth bypass is active", () => {
    const onRequireStepUp = mock(() => {});

    enforceRpcStepUp({
      actionDescription: "delete a project",
      context: {
        auth: {
          authBypass: true,
          sessionId: null,
        },
        priority: "foreground",
        signal: new AbortController().signal,
        timeoutMs: null,
      },
      onRequireStepUp,
    });

    expect(onRequireStepUp).not.toHaveBeenCalled();
  });

  it("forwards the session id and action description when step-up is required", () => {
    const onRequireStepUp = mock(() => {});

    enforceRpcStepUp({
      actionDescription: "delete a project",
      context: {
        auth: {
          authBypass: false,
          sessionId: "session-123",
        },
        priority: "foreground",
        signal: new AbortController().signal,
        timeoutMs: 5_000,
      },
      onRequireStepUp,
    });

    expect(onRequireStepUp).toHaveBeenCalledWith({
      actionDescription: "delete a project",
      sessionId: "session-123",
    });
  });
});
