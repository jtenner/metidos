import type { ThreadRecord } from "../db";
import { createPiThreadExtensionUiBridge } from "../pi/extension-ui";
import type { PiThreadRuntime } from "../pi/thread-runtime";
import type {
  RpcThread,
  RpcThreadDetail,
  RpcThreadRunStatus,
} from "../rpc-schema";
import { applyPiRuntimeTelemetry } from "./pi-session-telemetry";
import { readLruValue, writeLruValue } from "./shared";
import { threadRunStatusFromRecord } from "./thread-detail";

export type ThreadRunSettledEvent = {
  threadId: number;
  status: Extract<RpcThreadRunStatus["state"], "failed" | "idle" | "stopped">;
  startedAt: string | null;
  updatedAt: string | null;
};

type ThreadRuntimeLifecycleOptions = {
  createAbortError: (cause: unknown, message: string) => Error;
  getNow: () => string;
  notifyThreadStatusChanged: (threadId: number) => void;
  threadDetailCacheMaxEntries: number;
};

export class ThreadRuntimeLifecycle {
  readonly extensionUiBridge = createPiThreadExtensionUiBridge();

  private readonly abortControllers = new Map<number, AbortController>();
  private readonly completions = new Map<number, Promise<void>>();
  private readonly detailCache = new Map<number, RpcThreadDetail>();
  private readonly runtimes = new Map<number, PiThreadRuntime>();
  private readonly runSettledListeners = new Set<
    (event: ThreadRunSettledEvent) => void
  >();
  private readonly statuses = new Map<number, RpcThreadRunStatus>();

  constructor(private readonly options: ThreadRuntimeLifecycleOptions) {}

  applyRuntimeTelemetry(thread: RpcThread): RpcThread {
    return applyPiRuntimeTelemetry(thread, this.runtimes.get(thread.id));
  }

  clearThread(threadId: number): void {
    const activeController = this.abortControllers.get(threadId);
    if (activeController && !activeController.signal.aborted) {
      activeController.abort(
        this.options.createAbortError(
          null,
          "Thread runtime state was cleared.",
        ),
      );
    }
    this.abortControllers.delete(threadId);
    this.completions.delete(threadId);
    this.extensionUiBridge.clearThread(threadId);
    this.disposeRuntime(threadId);
    this.statuses.delete(threadId);
    this.invalidateDetail(threadId);
  }

  currentRunStatus(thread: ThreadRecord): RpcThreadRunStatus {
    return threadRunStatusFromRecord(thread, this.statuses.get(thread.id));
  }

  deleteCompletion(threadId: number): void {
    this.completions.delete(threadId);
  }

  deleteControllerIfCurrent(
    threadId: number,
    controller: AbortController,
  ): void {
    if (this.abortControllers.get(threadId) === controller) {
      this.abortControllers.delete(threadId);
    }
  }

  disposeRuntime(threadId: number): void {
    const runtime = this.runtimes.get(threadId);
    if (runtime) {
      runtime.session.dispose();
    }
    this.runtimes.delete(threadId);
  }

  getActiveTurns(): Array<{
    controller: AbortController;
    promise: Promise<void> | null;
    threadId: number;
  }> {
    return [...this.abortControllers.entries()].map(
      ([threadId, controller]) => ({
        controller,
        promise: this.completions.get(threadId) ?? null,
        threadId,
      }),
    );
  }

  getCompletion(threadId: number): Promise<void> | undefined {
    return this.completions.get(threadId);
  }

  getController(threadId: number): AbortController | undefined {
    return this.abortControllers.get(threadId);
  }

  getRuntime(threadId: number): PiThreadRuntime | undefined {
    return this.runtimes.get(threadId);
  }

  invalidateDetail(threadId: number): void {
    this.detailCache.delete(threadId);
  }

  onRunSettled(listener: (event: ThreadRunSettledEvent) => void): () => void {
    this.runSettledListeners.add(listener);
    return () => {
      this.runSettledListeners.delete(listener);
    };
  }

  async readDetailCached(
    threadId: number,
    options: {
      buildRaw: (threadId: number) => Promise<RpcThreadDetail>;
      expectedThread?: RpcThread | null;
    },
  ): Promise<RpcThreadDetail> {
    const expectedThread = options.expectedThread ?? null;
    const cached = readLruValue(this.detailCache, threadId);
    const cacheIsFresh =
      cached &&
      (!expectedThread ||
        buildThreadDetailCacheValidationKey(cached.thread) ===
          buildThreadDetailCacheValidationKey(expectedThread));

    if (cacheIsFresh && cached) {
      return {
        ...cached,
        thread: expectedThread ?? this.applyRuntimeTelemetry(cached.thread),
      };
    }

    const detail = await options.buildRaw(threadId);
    writeLruValue(
      this.detailCache,
      threadId,
      detail,
      this.options.threadDetailCacheMaxEntries,
    );
    return {
      ...detail,
      thread: this.applyRuntimeTelemetry(detail.thread),
    };
  }

  hasCompletion(threadId: number): boolean {
    return this.completions.has(threadId);
  }

  setCompletion(threadId: number, completion: Promise<void>): void {
    this.completions.set(threadId, completion);
  }

  setController(threadId: number, controller: AbortController): void {
    this.abortControllers.set(threadId, controller);
  }

  setRunStatus(threadId: number, status: RpcThreadRunStatus): void {
    this.statuses.set(threadId, status);
    this.invalidateDetail(threadId);
    this.options.notifyThreadStatusChanged(threadId);
    if (status.state !== "working") {
      const event = {
        threadId,
        status: status.state,
        startedAt: status.startedAt,
        updatedAt: status.updatedAt,
      } satisfies ThreadRunSettledEvent;
      for (const listener of this.runSettledListeners) {
        listener(event);
      }
    }
  }

  setRuntime(threadId: number, runtime: PiThreadRuntime): void {
    this.runtimes.set(threadId, runtime);
  }

  touchWorkingRunStatus(threadId: number): void {
    const current = this.statuses.get(threadId);
    if (!current || current.state !== "working") {
      return;
    }

    this.statuses.set(threadId, {
      ...current,
      updatedAt: this.options.getNow(),
    });
  }
}

function buildThreadDetailCacheValidationKey(
  thread: Pick<RpcThread, "id" | "runStatus" | "updatedAt">,
): string {
  return [
    thread.id,
    thread.updatedAt,
    thread.runStatus.state,
    thread.runStatus.startedAt ?? "",
    thread.runStatus.error ?? "",
    thread.runStatus.hasUnreadError ? "1" : "0",
  ].join(":");
}
