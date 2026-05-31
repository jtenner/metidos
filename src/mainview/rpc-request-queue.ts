import type { RpcRequestPriority } from "../bun/rpc-schema";

export type RpcRequestQueuePermit = {
  release: () => void;
};

type QueuedRpcRequest = {
  reject: (reason: unknown) => void;
  resolve: (permit: RpcRequestQueuePermit) => void;
  sequence: number;
  priority: RpcRequestPriority;
  signal: AbortSignal | null;
  removeAbortListener: () => void;
};

const RPC_PRIORITY_RANK: Record<RpcRequestPriority, number> = {
  background: 0,
  default: 1,
  foreground: 2,
};

function createAbortError(reason: unknown): unknown {
  return reason instanceof Error
    ? reason
    : new DOMException("RPC request aborted while queued.", "AbortError");
}

export class RpcRequestQueue {
  #activeCount = 0;
  #nextSequence = 1;
  #queue: QueuedRpcRequest[] = [];

  constructor(readonly maxActiveCount: number) {}

  get activeCount(): number {
    return this.#activeCount;
  }

  get queuedCount(): number {
    return this.#queue.length;
  }

  acquire(
    priority: RpcRequestPriority,
    signal: AbortSignal | null,
  ): Promise<RpcRequestQueuePermit> {
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal.reason));
    }

    if (this.#activeCount < this.maxActiveCount) {
      this.#activeCount += 1;
      return Promise.resolve(this.#createPermit());
    }

    return new Promise((resolve, reject) => {
      const entry: QueuedRpcRequest = {
        reject,
        resolve,
        sequence: this.#nextSequence++,
        priority,
        signal,
        removeAbortListener: () => {},
      };
      if (signal) {
        const handleAbort = () => {
          const index = this.#queue.indexOf(entry);
          if (index >= 0) {
            this.#queue.splice(index, 1);
          }
          entry.removeAbortListener();
          reject(createAbortError(signal.reason));
        };
        signal.addEventListener("abort", handleAbort, { once: true });
        entry.removeAbortListener = () => {
          signal.removeEventListener("abort", handleAbort);
        };
      }
      this.#queue.push(entry);
    });
  }

  #createPermit(): RpcRequestQueuePermit {
    let released = false;
    return {
      release: () => {
        if (released) {
          return;
        }
        released = true;
        this.#activeCount = Math.max(0, this.#activeCount - 1);
        this.#drain();
      },
    };
  }

  #drain(): void {
    while (this.#activeCount < this.maxActiveCount && this.#queue.length > 0) {
      const nextIndex = this.#nextQueueIndex();
      const [entry] = this.#queue.splice(nextIndex, 1);
      if (!entry) {
        return;
      }
      entry.removeAbortListener();
      if (entry.signal?.aborted) {
        entry.reject(createAbortError(entry.signal.reason));
        continue;
      }
      this.#activeCount += 1;
      entry.resolve(this.#createPermit());
    }
  }

  #nextQueueIndex(): number {
    let selectedIndex = 0;
    for (let index = 1; index < this.#queue.length; index += 1) {
      const selected = this.#queue[selectedIndex];
      const candidate = this.#queue[index];
      if (!selected || !candidate) {
        continue;
      }
      const selectedRank = RPC_PRIORITY_RANK[selected.priority];
      const candidateRank = RPC_PRIORITY_RANK[candidate.priority];
      if (
        candidateRank > selectedRank ||
        (candidateRank === selectedRank &&
          candidate.sequence < selected.sequence)
      ) {
        selectedIndex = index;
      }
    }
    return selectedIndex;
  }
}
