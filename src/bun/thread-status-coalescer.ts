/**
 * @file src/bun/thread-status-coalescer.ts
 * @description Narrow coalescing helper for high-frequency thread status pushes.
 */

export type ThreadStatusCoalescerOptions<Thread extends { id: number }> = {
  readonly windowMs: number;
  readonly send: (thread: Thread) => void;
};

type PendingThreadStatus<Thread extends { id: number }> = {
  thread: Thread;
  timer: ReturnType<typeof setTimeout>;
};

export class ThreadStatusCoalescer<Thread extends { id: number }> {
  private readonly pending = new Map<number, PendingThreadStatus<Thread>>();
  private readonly send: (thread: Thread) => void;
  private readonly windowMs: number;

  constructor(options: ThreadStatusCoalescerOptions<Thread>) {
    this.send = options.send;
    this.windowMs = options.windowMs;
  }

  enqueue(thread: Thread): void {
    const existing = this.pending.get(thread.id);
    if (existing) {
      // Leading-edge coalescing is intentional: the first update opens the
      // window and later updates replace the payload without extending latency.
      existing.thread = thread;
      return;
    }

    const timer = setTimeout(() => {
      this.flush(thread.id);
    }, this.windowMs);
    timer.unref?.();
    this.pending.set(thread.id, {
      thread,
      timer,
    });
  }

  flush(threadId: number): void {
    const pending = this.pending.get(threadId);
    if (!pending) {
      return;
    }
    this.pending.delete(threadId);
    clearTimeout(pending.timer);
    this.send(pending.thread);
  }

  flushAll(): void {
    for (const threadId of Array.from(this.pending.keys())) {
      this.flush(threadId);
    }
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
