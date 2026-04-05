import { describe, expect, it } from "bun:test";

import { createCoalescedWorktreeInvalidationChannel } from "./invalidation-events";

describe("coalesced worktree invalidation channel", () => {
  it("batches repeated same-worktree invalidations onto one scheduled flush", () => {
    const scheduledFlushes: Array<() => void> = [];
    const publishedPayloads: Array<{
      projectId: number;
      worktreePath: string;
    }> = [];
    const channel = createCoalescedWorktreeInvalidationChannel(
      (flush) => {
        scheduledFlushes.push(flush);
        return scheduledFlushes.length - 1;
      },
      () => {},
    );

    channel.subscribe((payload) => {
      publishedPayloads.push(payload);
    });

    channel.publish({
      projectId: 7,
      worktreePath: "/repo/worktree-a",
    });
    channel.publish({
      projectId: 7,
      worktreePath: "/repo/worktree-a",
    });
    channel.publish({
      projectId: 7,
      worktreePath: "/repo/worktree-b",
    });

    expect(scheduledFlushes).toHaveLength(1);

    scheduledFlushes[0]?.();

    expect(publishedPayloads).toEqual([
      {
        projectId: 7,
        worktreePath: "/repo/worktree-a",
      },
      {
        projectId: 7,
        worktreePath: "/repo/worktree-b",
      },
    ]);
  });

  it("stops notifying unsubscribed listeners on later flushes", () => {
    const scheduledFlushes: Array<() => void> = [];
    const publishedPayloads: Array<{
      projectId: number;
      worktreePath: string;
    }> = [];
    const channel = createCoalescedWorktreeInvalidationChannel(
      (flush) => {
        scheduledFlushes.push(flush);
        return scheduledFlushes.length - 1;
      },
      () => {},
    );

    const unsubscribe = channel.subscribe((payload) => {
      publishedPayloads.push(payload);
    });

    channel.publish({
      projectId: 3,
      worktreePath: "/repo/worktree-a",
    });
    scheduledFlushes[0]?.();
    unsubscribe();

    channel.publish({
      projectId: 3,
      worktreePath: "/repo/worktree-b",
    });
    scheduledFlushes[1]?.();

    expect(publishedPayloads).toEqual([
      {
        projectId: 3,
        worktreePath: "/repo/worktree-a",
      },
    ]);
  });
});
