import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import type {
  ProjectProcedures,
  RpcThread,
  RpcThreadDetail,
  RpcThreadMessage,
} from "../../bun/rpc-schema";
import {
  type ThreadMessageHistoryController,
  useThreadMessageHistoryController,
} from "./use-thread-message-history-controller";

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    id: 11,
    projectId: 7,
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    worktreePath: "/repo",
    ...overrides,
  } as RpcThread;
}

function message(id: number, text: string): RpcThreadMessage {
  return {
    id,
    kind: "chat",
    role: "assistant",
    text,
  } as RpcThreadMessage;
}

function detail(options?: {
  messages?: RpcThreadMessage[];
  nextCursor?: number | null;
  openedThread?: RpcThread;
}): RpcThreadDetail {
  return {
    messages: options?.messages ?? [],
    nextCursor: options?.nextCursor ?? null,
    thread: options?.openedThread ?? thread(),
  };
}

function renderController(input?: {
  initialMessages?: RpcThreadMessage[];
  procedures?: Partial<ProjectProcedures>;
  selectedThreadDetailRefreshKeyRef?: { current: string | null };
  selectedThreadIdRef?: { current: number | null };
}): {
  controller: ThreadMessageHistoryController;
  readMessages: () => RpcThreadMessage[];
  selectedThreadDetailRefreshKeyRef: { current: string | null };
} {
  let controller: ThreadMessageHistoryController | null = null;
  let messages = input?.initialMessages ?? [];
  const selectedThreadDetailRefreshKeyRef =
    input?.selectedThreadDetailRefreshKeyRef ?? { current: null };
  const selectedThreadIdRef = input?.selectedThreadIdRef ?? { current: 11 };

  function TestHarness(): null {
    controller = useThreadMessageHistoryController({
      procedures: {
        getThread: async ({ threadId }) =>
          detail({ openedThread: thread({ id: threadId }) }),
        ...input?.procedures,
      } as ProjectProcedures,
      selectedThreadDetailRefreshKeyRef,
      selectedThreadIdRef,
      setThreadMessages: (value) => {
        messages = typeof value === "function" ? value(messages) : value;
      },
    });
    return null;
  }

  renderToString(<TestHarness />);
  if (!controller) {
    throw new Error("Expected test harness to expose controller.");
  }
  return {
    controller,
    readMessages: () => messages,
    selectedThreadDetailRefreshKeyRef,
  };
}

describe("useThreadMessageHistoryController", () => {
  it("replaces selected Thread messages and refresh key through the controller interface", () => {
    const selectedThread = thread({
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: "2026-01-01T00:00:00.000Z",
        state: "working",
        updatedAt: "2026-01-01T00:00:01.000Z",
      },
    });
    const { controller, readMessages, selectedThreadDetailRefreshKeyRef } =
      renderController({ initialMessages: [message(1, "old")] });

    controller.replaceSelectedThreadMessageHistory(
      detail({
        messages: [message(2, "new")],
        openedThread: selectedThread,
      }),
    );

    expect(readMessages().map((item) => item.id)).toEqual([2]);
    expect(selectedThreadDetailRefreshKeyRef.current).toContain("working");
    expect(selectedThreadDetailRefreshKeyRef.current).toContain(
      "2026-01-01T00:00:01.000Z",
    );
  });

  it("merges selected Thread messages without exposing retention ordering to App", () => {
    const { controller, readMessages } = renderController({
      initialMessages: [message(1, "first")],
    });

    controller.mergeSelectedThreadMessageHistory(
      detail({ messages: [message(1, "first updated"), message(2, "second")] }),
    );

    const messages = readMessages();
    expect(messages.map((item) => [item.id, item.kind])).toEqual([
      [1, "chat"],
      [2, "chat"],
    ]);
    expect(
      (messages[0] as Extract<RpcThreadMessage, { kind: "chat" }>).text,
    ).toBe("first updated");
  });
});
