import type { ChatImageAttachment } from "../../shared/chat-images";
import type { ThreadRecord } from "../db";
import type { PiThreadRuntime } from "../pi/thread-runtime";
import type { RpcThreadDetail } from "../rpc-schema";
import type { ThreadRuntimeLifecycle } from "./thread-runtime-lifecycle";
import type { ThreadTurnPersistenceManager } from "./thread-turn-persistence";
import type { ThreadTurnRuntimeManager } from "./thread-turn-runtime";

export type InterruptedThreadMessageState = {
  lastUpdatedAt: string | null;
  threadId: number;
};

export type ThreadTurnRecoverySource = {
  listInterruptedMessageStates: () => readonly InterruptedThreadMessageState[];
  listThreads: () => readonly ThreadRecord[];
};

export type ThreadTurnRunnerOptions = {
  createAbortError: (cause: unknown, message: string) => Error;
  getNow: () => string;
  lifecycle: ThreadRuntimeLifecycle;
  persistence: ThreadTurnPersistenceManager;
  recovery: ThreadTurnRecoverySource;
  runInBackground: (params: {
    controller: AbortController;
    images: ChatImageAttachment[];
    input: string;
    sessionId: string | null;
    startedAt: string;
    threadId: number;
  }) => Promise<void>;
  stopCompletionWaitMs: number;
  stoppedMessage: string;
  runtimeManager: ThreadTurnRuntimeManager;
  interruptedMessage: string;
  assertModelProviderAvailable: (model: string | null | undefined) => void;
};

export class ThreadTurnRunner {
  constructor(private readonly options: ThreadTurnRunnerOptions) {}

  async ensureRuntime(
    thread: ThreadRecord,
    _sessionId: string | null,
  ): Promise<PiThreadRuntime> {
    return this.options.runtimeManager.ensureRuntime(thread, _sessionId);
  }

  recoverInterruptedTurnsOnStartup(): void {
    const threads = this.options.recovery.listThreads();
    if (threads.length === 0) {
      return;
    }

    this.recoverInterruptedTurns({
      inProgressMessages: this.options.recovery.listInterruptedMessageStates(),
      threads,
    });
  }

  recoverInterruptedTurns(params: {
    inProgressMessages: readonly InterruptedThreadMessageState[];
    threads: readonly ThreadRecord[];
  }): void {
    const threadsById = new Map(
      params.threads.map((thread) => [thread.id, thread]),
    );
    const recoveredThreadIds = new Set<number>();

    for (const interrupted of params.inProgressMessages) {
      const thread = threadsById.get(interrupted.threadId);
      if (!thread) {
        continue;
      }

      const shouldRecoverThread = shouldRecoverInterruptedThread(
        thread,
        interrupted.lastUpdatedAt,
      );
      // Stale in-progress activity can outlive an already-settled thread. In
      // that case only clean up the activity/cron run metadata; do not mark the
      // thread stopped again after a newer successful or failed settlement.
      this.options.persistence.persistStoppedTurn(
        thread.id,
        this.options.interruptedMessage,
        {
          markThreadStopped: shouldRecoverThread,
          stopCronJobId: thread.cronJobId,
        },
      );
      if (shouldRecoverThread) {
        recoveredThreadIds.add(thread.id);
      }
    }

    for (const thread of params.threads) {
      if (!thread.activeTurnStartedAt || recoveredThreadIds.has(thread.id)) {
        continue;
      }

      // Startup recovery runs before this process accepts new turns, and
      // Metidos uses one local backend writer for active Thread turns. A
      // persisted active_turn_started_at with no live lifecycle controller is
      // therefore a stale interrupted turn, not another process's active work.
      this.options.persistence.persistStoppedTurn(
        thread.id,
        this.options.interruptedMessage,
        {
          stopCronJobId: thread.cronJobId,
        },
      );
    }
  }

  async queueMessage(
    thread: ThreadRecord,
    input: string,
    images: ChatImageAttachment[],
    sessionId: string | null,
  ): Promise<RpcThreadDetail> {
    if (this.options.lifecycle.currentRunStatus(thread).state === "working") {
      throw new Error("Thread is already processing a message.");
    }
    if (this.options.lifecycle.hasCompletion(thread.id)) {
      throw new Error("Thread is still stopping. Try again in a moment.");
    }
    this.options.assertModelProviderAvailable(thread.model);
    const startedAt = this.options.getNow();
    await this.options.persistence.persistQueuedUserMessage(
      thread,
      input,
      images,
      startedAt,
    );

    const controller = new AbortController();
    this.options.lifecycle.setController(thread.id, controller);
    this.options.lifecycle.setRunStatus(thread.id, {
      state: "working",
      startedAt,
      updatedAt: startedAt,
      error: null,
      hasUnreadError: false,
    });

    const completion = this.options.runInBackground({
      controller,
      images,
      input,
      sessionId,
      startedAt,
      threadId: thread.id,
    });
    this.options.lifecycle.setCompletion(thread.id, completion);
    void completion;

    return this.options.persistence.readDetail(thread.id);
  }

  async stopTurn(thread: ThreadRecord): Promise<RpcThreadDetail> {
    const currentRunStatus = this.options.lifecycle.currentRunStatus(thread);
    if (currentRunStatus.state !== "working") {
      return this.options.persistence.readDetail(thread.id);
    }

    const controller = this.options.lifecycle.getController(thread.id);
    if (!controller) {
      throw new Error(
        "Thread stop is unavailable because no active run was found.",
      );
    }

    if (!controller.signal.aborted) {
      controller.abort(
        this.options.createAbortError(null, this.options.stoppedMessage),
      );
    }
    this.options.runtimeManager.abortRuntimeSession(thread.id);

    const stoppedAt = this.options.getNow();
    this.options.persistence.persistStoppedTurn(
      thread.id,
      this.options.stoppedMessage,
      {
        stoppedAt,
      },
    );
    this.options.lifecycle.setRunStatus(thread.id, {
      state: "stopped",
      startedAt: currentRunStatus.startedAt,
      updatedAt: stoppedAt,
      error: this.options.stoppedMessage,
      hasUnreadError: false,
    });

    const completion = this.options.lifecycle.getCompletion(thread.id);
    if (completion) {
      await Promise.race([
        completion,
        new Promise<void>((resolve) =>
          setTimeout(resolve, this.options.stopCompletionWaitMs),
        ),
      ]);
    }
    return this.options.persistence.readDetail(thread.id);
  }
}

function latestSettledThreadTimestamp(
  thread: Pick<ThreadRecord, "lastErrorAt" | "lastRunAt">,
): string | null {
  if (thread.lastRunAt && thread.lastErrorAt) {
    return thread.lastRunAt >= thread.lastErrorAt
      ? thread.lastRunAt
      : thread.lastErrorAt;
  }

  return thread.lastRunAt ?? thread.lastErrorAt ?? null;
}

function shouldRecoverInterruptedThread(
  thread: ThreadRecord,
  lastInProgressMessageUpdatedAt: string | null,
): boolean {
  if (thread.activeTurnStartedAt) {
    return true;
  }

  if (!lastInProgressMessageUpdatedAt) {
    return false;
  }

  const lastSettledAt = latestSettledThreadTimestamp(thread);
  if (!lastSettledAt) {
    return true;
  }

  return lastInProgressMessageUpdatedAt >= lastSettledAt;
}
