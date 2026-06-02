/**
 * @file src/bun/thread-status-coalescer.test.ts
 * @description Tests for high-frequency thread status push coalescing.
 */

import { describe, expect, it } from "bun:test";

import { ThreadStatusCoalescer } from "./thread-status-coalescer";

type ThreadStatusFixture = {
  id: number;
  status: "in-progress" | "failed" | "stopped";
  errorSeen: boolean;
};

describe("ThreadStatusCoalescer", () => {
  it("sends the latest failed/stopped transition per thread without extending the window", async () => {
    const sent: ThreadStatusFixture[] = [];
    const coalescer = new ThreadStatusCoalescer<ThreadStatusFixture>({
      windowMs: 10,
      send: (thread) => sent.push(thread),
    });

    coalescer.enqueue({ id: 1, status: "in-progress", errorSeen: false });
    coalescer.enqueue({ id: 2, status: "in-progress", errorSeen: false });
    coalescer.enqueue({ id: 1, status: "failed", errorSeen: true });
    coalescer.enqueue({ id: 2, status: "stopped", errorSeen: false });

    expect(coalescer.pendingCount).toBe(2);

    await Bun.sleep(20);

    expect(coalescer.pendingCount).toBe(0);
    expect(sent).toEqual([
      { id: 1, status: "failed", errorSeen: true },
      { id: 2, status: "stopped", errorSeen: false },
    ]);
  });

  it("flushes pending in-progress updates immediately and ignores missing thread ids", () => {
    const sent: ThreadStatusFixture[] = [];
    const coalescer = new ThreadStatusCoalescer<ThreadStatusFixture>({
      windowMs: 60_000,
      send: (thread) => sent.push(thread),
    });

    coalescer.enqueue({ id: 1, status: "in-progress", errorSeen: false });
    coalescer.enqueue({ id: 1, status: "in-progress", errorSeen: true });

    coalescer.flush(404);
    expect(coalescer.pendingCount).toBe(1);

    coalescer.flush(1);

    expect(coalescer.pendingCount).toBe(0);
    expect(sent).toEqual([{ id: 1, status: "in-progress", errorSeen: true }]);
  });

  it("flushes all pending statuses in insertion order", () => {
    const sent: ThreadStatusFixture[] = [];
    const coalescer = new ThreadStatusCoalescer<ThreadStatusFixture>({
      windowMs: 60_000,
      send: (thread) => sent.push(thread),
    });

    coalescer.enqueue({ id: 1, status: "in-progress", errorSeen: false });
    coalescer.enqueue({ id: 2, status: "failed", errorSeen: true });
    coalescer.enqueue({ id: 3, status: "stopped", errorSeen: false });

    coalescer.flushAll();

    expect(coalescer.pendingCount).toBe(0);
    expect(sent).toEqual([
      { id: 1, status: "in-progress", errorSeen: false },
      { id: 2, status: "failed", errorSeen: true },
      { id: 3, status: "stopped", errorSeen: false },
    ]);
  });
});
