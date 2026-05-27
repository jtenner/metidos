import type { ThreadRecord } from "../db";
import type { PiThreadRuntime } from "../pi/thread-runtime";
import type { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle";

export type ThreadTurnRuntimeManager = {
  abortRuntimeSession(threadId: number): void;
  ensureRuntime(
    thread: ThreadRecord,
    sessionId: string | null,
  ): Promise<PiThreadRuntime>;
};

export type ThreadTurnRuntimeCoordinatorOptions = {
  createRuntime: (thread: ThreadRecord) => Promise<PiThreadRuntime>;
  lifecycle: Pick<ThreadRuntimeLifecycle, "getRuntime" | "setRuntime">;
  syncRuntimeSessionState: (
    thread: ThreadRecord,
    runtime: PiThreadRuntime,
  ) => void;
};

export class ThreadTurnRuntimeCoordinator implements ThreadTurnRuntimeManager {
  constructor(private readonly options: ThreadTurnRuntimeCoordinatorOptions) {}

  abortRuntimeSession(threadId: number): void {
    void this.options.lifecycle
      .getRuntime(threadId)
      ?.session.abort()
      .catch(() => {});
  }

  async ensureRuntime(
    thread: ThreadRecord,
    _sessionId: string | null,
  ): Promise<PiThreadRuntime> {
    const active = this.options.lifecycle.getRuntime(thread.id);
    if (active) {
      this.options.syncRuntimeSessionState(thread, active);
      await active.reloadResources();
      return active;
    }

    const next = await this.options.createRuntime(thread);
    this.options.lifecycle.setRuntime(thread.id, next);
    this.options.syncRuntimeSessionState(thread, next);
    return next;
  }
}
