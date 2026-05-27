import type { ChatImageAttachment } from "../../shared/chat-images";
import type { ThreadRecord } from "../db";
import type { RpcThreadDetail } from "../rpc-schema";

export type PersistStoppedThreadTurnOptions = {
  markThreadStopped?: boolean;
  stopCronJobId?: number | null;
  stoppedAt?: string;
};

export type ThreadTurnPersistenceManager = {
  persistQueuedUserMessage: (
    thread: ThreadRecord,
    input: string,
    images: ChatImageAttachment[],
    startedAt: string,
  ) => Promise<void>;
  persistStoppedTurn: (
    threadId: number,
    message: string,
    options?: PersistStoppedThreadTurnOptions,
  ) => void;
  readDetail: (threadId: number) => Promise<RpcThreadDetail>;
};

export type ThreadTurnPersistenceCoordinatorOptions = {
  invalidateThreadDetail: (threadId: number) => void;
  markThreadStopped: (
    threadId: number,
    message: string,
    stoppedAt?: string,
  ) => void;
  persistQueuedUserMessage: ThreadTurnPersistenceManager["persistQueuedUserMessage"];
  readDetail: ThreadTurnPersistenceManager["readDetail"];
  stopInProgressCronRuns: (cronJobId: number) => void;
  stopInProgressMessages: (threadId: number) => void;
};

export class ThreadTurnPersistenceCoordinator
  implements ThreadTurnPersistenceManager
{
  constructor(
    private readonly options: ThreadTurnPersistenceCoordinatorOptions,
  ) {}

  persistQueuedUserMessage(
    thread: ThreadRecord,
    input: string,
    images: ChatImageAttachment[],
    startedAt: string,
  ): Promise<void> {
    return this.options.persistQueuedUserMessage(
      thread,
      input,
      images,
      startedAt,
    );
  }

  persistStoppedTurn(
    threadId: number,
    message: string,
    options?: PersistStoppedThreadTurnOptions,
  ): void {
    this.options.stopInProgressMessages(threadId);
    if (
      options?.stopCronJobId !== undefined &&
      options.stopCronJobId !== null
    ) {
      this.options.stopInProgressCronRuns(options.stopCronJobId);
    }
    this.options.invalidateThreadDetail(threadId);
    if (options?.markThreadStopped !== false) {
      this.options.markThreadStopped(threadId, message, options?.stoppedAt);
    }
  }

  readDetail(threadId: number): Promise<RpcThreadDetail> {
    return this.options.readDetail(threadId);
  }
}
