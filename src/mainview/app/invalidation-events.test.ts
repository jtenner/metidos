/**
 * @file src/mainview/app/invalidation-events.test.ts
 * @description Test file for invalidation events.
 */

import { describe, expect, it } from "bun:test";

import {
  createCoalescedSignalChannel,
  createCoalescedWorktreeInvalidationChannel,
} from "./invalidation-events";

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

describe("coalesced signal channel", () => {
  it("coalesces repeated publishes into one scheduled flush", () => {
    const scheduledFlushes: Array<() => void> = [];
    let publishCount = 0;
    const channel = createCoalescedSignalChannel(
      (flush) => {
        scheduledFlushes.push(flush);
        return scheduledFlushes.length - 1;
      },
      () => {},
    );

    channel.subscribe(() => {
      publishCount += 1;
    });

    channel.publish();
    channel.publish();
    channel.publish();

    expect(scheduledFlushes).toHaveLength(1);

    scheduledFlushes[0]?.();

    expect(publishCount).toBe(1);
  });

  it("stops notifying unsubscribed listeners on later flushes", () => {
    const scheduledFlushes: Array<() => void> = [];
    let publishCount = 0;
    const channel = createCoalescedSignalChannel(
      (flush) => {
        scheduledFlushes.push(flush);
        return scheduledFlushes.length - 1;
      },
      () => {},
    );

    const unsubscribe = channel.subscribe(() => {
      publishCount += 1;
    });

    channel.publish();
    scheduledFlushes[0]?.();
    unsubscribe();

    channel.publish();
    scheduledFlushes[1]?.();

    expect(publishCount).toBe(1);
  });
});
