/**
 * @file src/mainview/thread-send.test.ts
 * @description Test file for thread send.
 */

import { describe, expect, it } from "bun:test";

import type { RpcModelOption, RpcThreadDetail } from "../bun/rpc-schema";
import {
  finishChatComposerImageAttachmentRead,
  readChatComposerImageAttachments,
  resetChatComposerImageAttachmentStoreForTest,
  setChatComposerImageAttachments,
  startChatComposerImageAttachmentRead,
} from "./controls/chat-composer-image-attachments";
import {
  readChatComposerDraft,
  setChatComposerDraft,
} from "./controls/chat-composer-draft-store";
import {
  buildOptimisticUserThreadMessage,
  hydrateSentThreadDetailImagePayloads,
  isPersistedThreadId,
  removeOptimisticThreadMessageById,
  SEND_THREAD_MESSAGE_TIMEOUT_MS,
  sendThreadTurn,
  shouldApplySentThreadDetailToSelection,
  shouldApplyThreadSendFailureToSelection,
} from "./thread-send";

/**
 * Performs threadDetail operation.
 * @param threadId - Thread identifier.
 */

function threadDetail(threadId: number): RpcThreadDetail {
  return {
    thread: {
      id: threadId,
      runStatus: {
        error: null,
        hasUnreadError: false,
        startedAt: null,
        state: "idle",
        updatedAt: null,
      },
    },
    messages: [],
  } as unknown as RpcThreadDetail;
}

describe("thread send selection helpers", () => {
  it("applies a send completion when the original thread is still selected", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(17),
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeTrue();
  });

  it("ignores a send completion after the user switches to another thread", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(17),
        requestedThreadId: 17,
        selectedThreadId: 42,
      }),
    ).toBeFalse();
  });

  it("ignores a completion that resolves with a different thread id", () => {
    expect(
      shouldApplySentThreadDetailToSelection({
        detail: threadDetail(42),
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeFalse();
  });

  it("only surfaces send failures while the failed thread remains selected", () => {
    expect(
      shouldApplyThreadSendFailureToSelection({
        requestedThreadId: 17,
        selectedThreadId: 17,
      }),
    ).toBeTrue();
    expect(
      shouldApplyThreadSendFailureToSelection({
        requestedThreadId: 17,
        selectedThreadId: 42,
      }),
    ).toBeFalse();
  });
});

describe("optimistic thread send helpers", () => {
  it("recognizes only persisted thread ids as send targets", () => {
    expect(isPersistedThreadId(17)).toBeTrue();
    expect(isPersistedThreadId(0)).toBeFalse();
    expect(isPersistedThreadId(-1)).toBeFalse();
    expect(isPersistedThreadId(null)).toBeFalse();
  });

  it("builds a local user message that can render before the send RPC settles", () => {
    expect(
      buildOptimisticUserThreadMessage({
        createdAt: "2026-04-23T12:00:00.000Z",
        id: -1,
        images: [{ data: "aGVsbG8=", mimeType: "image/png", type: "image" }],
        text: "hello",
        threadId: 17,
      }),
    ).toEqual({
      id: -1,
      threadId: 17,
      role: "user",
      kind: "chat",
      itemId: null,
      text: "hello",
      images: [{ data: "aGVsbG8=", mimeType: "image/png", type: "image" }],
      state: null,
      createdAt: "2026-04-23T12:00:00.000Z",
      updatedAt: "2026-04-23T12:00:00.000Z",
    });
  });

  it("removes only the matching optimistic message id", () => {
    const messages = [
      { id: 1, text: "persisted" },
      { id: -7, text: "optimistic" },
      { id: 2, text: "persisted again" },
    ];

    expect(removeOptimisticThreadMessageById(messages, -7)).toEqual([
      { id: 1, text: "persisted" },
      { id: 2, text: "persisted again" },
    ]);
    expect(removeOptimisticThreadMessageById(messages, -99)).toEqual(messages);
  });

  it("hydrates just-sent image payloads when backend detail omits heavy content", () => {
    const detail = threadDetail(17);
    detail.messages = [
      {
        id: 11,
        threadId: 17,
        role: "user",
        kind: "chat",
        itemId: null,
        text: "Describe this image.",
        images: [
          {
            byteSize: 8,
            data: "",
            dataLoaded: false,
            mimeType: "image/png",
            type: "image",
          },
        ],
        state: null,
        createdAt: "2026-04-23T12:00:00.000Z",
        updatedAt: "2026-04-23T12:00:00.000Z",
      },
    ];

    const hydrated = hydrateSentThreadDetailImagePayloads(
      detail,
      "Describe this image.",
      [{ data: "iVBORw0KGgo=", mimeType: "image/png", type: "image" }],
    );
    const message = hydrated.messages[0];

    expect(message?.kind === "chat" ? message.images?.[0]?.data : null).toBe(
      "iVBORw0KGgo=",
    );
    expect(
      message?.kind === "chat" ? message.images?.[0]?.dataLoaded : null,
    ).toBe(true);
  });

  it("sets a timeout on the send-message RPC", async () => {
    const sendCalls: Array<{
      options: unknown;
      params: { images?: unknown[]; input: string; threadId: number };
    }> = [];
    let isSending = false;

    setChatComposerDraft("hello");
    setChatComposerImageAttachments([]);

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [],
      initialChatInput: "",
      isSending: false,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async (params, options) => {
          sendCalls.push({ params, options });
          return threadDetail(params.threadId);
        },
      },
      selectedThread: threadDetail(17).thread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef: { current: 17 },
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef: { current: "idle" },
      setChatError: () => {},
      setIsSending: (value) => {
        isSending = typeof value === "function" ? value(isSending) : value;
      },
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sendCalls).toEqual([
      {
        options: { timeoutMs: SEND_THREAD_MESSAGE_TIMEOUT_MS },
        params: { images: [], input: "hello", threadId: 17 },
      },
    ]);
    expect(isSending).toBeFalse();
  });

  it("waits for a persisted thread before sending an image-only first turn", async () => {
    let resolveCreatedThread!: (detail: RpcThreadDetail) => void;
    const createdThread = new Promise<RpcThreadDetail>((resolve) => {
      resolveCreatedThread = resolve;
    });
    const selectedThreadIdRef = { current: -1 as number | null };
    const sendCalls: Array<{
      images?: unknown[];
      input: string;
      threadId: number;
    }> = [];
    let chatError = "";
    let isSending = false;

    setChatComposerDraft("");
    setChatComposerImageAttachments([
      {
        byteSize: 8,
        data: "iVBORw0KGgo=",
        id: "image-1",
        mimeType: "image/png",
        type: "image",
      },
    ]);

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [
        {
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          supportsImageInput: true,
        } as unknown as RpcModelOption,
      ],
      ensureSelectedThread: async () => {
        const detail = await createdThread;
        selectedThreadIdRef.current = detail.thread.id;
        return detail;
      },
      initialChatInput: "",
      isSending,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async (params) => {
          sendCalls.push(params);
          return threadDetail(params.threadId);
        },
      },
      selectedThread: null,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef,
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef: { current: "idle" },
      setChatError: (value) => {
        chatError = typeof value === "function" ? value(chatError) : value;
      },
      setIsSending: (value) => {
        isSending = typeof value === "function" ? value(isSending) : value;
      },
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    expect(sendCalls).toEqual([]);
    expect(isSending).toBeTrue();

    resolveCreatedThread(threadDetail(31));
    await createdThread;
    await Promise.resolve();
    await Promise.resolve();

    expect(sendCalls).toEqual([
      {
        images: [
          {
            data: "iVBORw0KGgo=",
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "Describe this image.",
        threadId: 31,
      },
    ]);
    expect(chatError).toBe("");
    expect(isSending).toBeFalse();
  });

  it("reads images from the rendered composer key even when selection refs advance", async () => {
    resetChatComposerImageAttachmentStoreForTest();
    const renderedDraftKey = "thread:-999";
    const sendCalls: Array<{
      images?: unknown[];
      input: string;
      threadId: number;
    }> = [];
    setChatComposerDraft("", renderedDraftKey);
    setChatComposerImageAttachments(
      [
        {
          byteSize: 8,
          data: "iVBORw0KGgo=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      renderedDraftKey,
    );

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [
        {
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          supportsImageInput: true,
        } as unknown as RpcModelOption,
      ],
      draftKey: renderedDraftKey,
      initialChatInput: "",
      isSending: false,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async (params) => {
          sendCalls.push(params);
          return threadDetail(params.threadId);
        },
      },
      selectedThread: threadDetail(31).thread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef: { current: 31 },
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef: { current: "idle" },
      setChatError: () => {},
      setIsSending: () => {},
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sendCalls).toEqual([
      {
        images: [
          {
            data: "iVBORw0KGgo=",
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "Describe this image.",
        threadId: 31,
      },
    ]);
  });

  it("preserves draft-scoped text and images when the selected Thread is already working", async () => {
    resetChatComposerImageAttachmentStoreForTest();
    const draftKey = "thread:17";
    const sendCalls: unknown[] = [];
    let chatError = "existing error";
    let isSending = false;

    setChatComposerDraft("Please wait", draftKey);
    setChatComposerImageAttachments(
      [
        {
          byteSize: 8,
          data: "iVBORw0KGgo=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      draftKey,
    );

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [
        {
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          supportsImageInput: true,
        } as unknown as RpcModelOption,
      ],
      draftKey,
      initialChatInput: "",
      isSending: false,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async (params) => {
          sendCalls.push(params);
          return threadDetail(params.threadId);
        },
      },
      selectedThread: threadDetail(17).thread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef: { current: 17 },
      selectedThreadIsWorking: true,
      selectedThreadRunStateRef: { current: "working" },
      setChatError: (value) => {
        chatError = typeof value === "function" ? value(chatError) : value;
      },
      setIsSending: (value) => {
        isSending = typeof value === "function" ? value(isSending) : value;
      },
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sendCalls).toEqual([]);
    expect(chatError).toBe("existing error");
    expect(readChatComposerDraft("", draftKey)).toBe("Please wait");
    expect(readChatComposerImageAttachments(draftKey)).toHaveLength(1);
    expect(isSending).toBeFalse();
  });

  it("rejects image sends for models without image input support before calling the RPC", async () => {
    resetChatComposerImageAttachmentStoreForTest();
    const draftKey = "thread:17";
    const sendCalls: unknown[] = [];
    let chatError = "";
    let isSending = false;

    setChatComposerDraft("Please inspect this", draftKey);
    setChatComposerImageAttachments(
      [
        {
          byteSize: 8,
          data: "iVBORw0KGgo=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      draftKey,
    );

    const originalConsoleWarn = console.warn;
    console.warn = () => {};
    try {
      sendThreadTurn({
        activeCodexModel: "openai:text-only",
        codexModels: [
          {
            id: "openai:text-only",
            label: "Text only",
            supportsImageInput: false,
          } as unknown as RpcModelOption,
        ],
        draftKey,
        initialChatInput: "",
        isSending: false,
        optimisticThreadMessageIdRef: { current: -1 },
        procedures: {
          sendThreadMessage: async (params) => {
            sendCalls.push(params);
            return threadDetail(params.threadId);
          },
        },
        selectedThread: threadDetail(17).thread,
        selectedThreadDetailRefreshKeyRef: { current: null },
        selectedThreadIdRef: { current: 17 },
        selectedThreadIsWorking: false,
        selectedThreadRunStateRef: { current: "idle" },
        setChatError: (value) => {
          chatError = typeof value === "function" ? value(chatError) : value;
        },
        setIsSending: (value) => {
          isSending = typeof value === "function" ? value(isSending) : value;
        },
        setThreadMessages: () => {},
        upsertThread: () => {},
      });

      await Promise.resolve();
      await Promise.resolve();
    } finally {
      console.warn = originalConsoleWarn;
    }

    expect(sendCalls).toEqual([]);
    expect(chatError).toBe("Current model does not support images.");
    expect(readChatComposerDraft("", draftKey)).toBe("Please inspect this");
    expect(readChatComposerImageAttachments(draftKey)).toHaveLength(1);
    expect(isSending).toBeFalse();
  });

  it("waits for in-flight image attachment reads before sending", async () => {
    const sendCalls: Array<{
      images?: unknown[];
      input: string;
      threadId: number;
    }> = [];
    let isSending = false;

    setChatComposerDraft("");
    setChatComposerImageAttachments([]);
    startChatComposerImageAttachmentRead();

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [
        {
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          supportsImageInput: true,
        } as unknown as RpcModelOption,
      ],
      initialChatInput: "",
      isSending: false,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async (params) => {
          sendCalls.push(params);
          return threadDetail(params.threadId);
        },
      },
      selectedThread: threadDetail(17).thread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef: { current: 17 },
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef: { current: "idle" },
      setChatError: () => {},
      setIsSending: (value) => {
        isSending = typeof value === "function" ? value(isSending) : value;
      },
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    await Promise.resolve();
    expect(sendCalls).toEqual([]);
    expect(isSending).toBeTrue();

    setChatComposerImageAttachments([
      {
        byteSize: 16_384,
        data: "iVBORw0KGgo=",
        id: "image-1",
        mimeType: "image/png",
        type: "image",
      },
    ]);
    finishChatComposerImageAttachmentRead();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendCalls).toEqual([
      {
        images: [
          {
            data: "iVBORw0KGgo=",
            mimeType: "image/png",
            type: "image",
          },
        ],
        input: "Describe this image.",
        threadId: 17,
      },
    ]);
    expect(isSending).toBeFalse();
  });

  it("restores a failed stale send to the initiating draft key", async () => {
    let rejectSend!: (error: Error) => void;
    const sendPromise = new Promise<RpcThreadDetail>((_, reject) => {
      rejectSend = reject;
    });
    const draftKey = "thread:17";
    const selectedThreadIdRef = { current: 17 as number | null };
    let isSending = false;

    setChatComposerDraft("hello", draftKey);
    setChatComposerImageAttachments(
      [
        {
          byteSize: 8,
          data: "iVBORw0KGgo=",
          id: "image-1",
          mimeType: "image/png",
          type: "image",
        },
      ],
      draftKey,
    );

    sendThreadTurn({
      activeCodexModel: "openai:gpt-5.4",
      codexModels: [
        {
          id: "openai:gpt-5.4",
          label: "GPT-5.4",
          supportsImageInput: true,
        } as unknown as RpcModelOption,
      ],
      draftKey,
      initialChatInput: "",
      isSending: false,
      optimisticThreadMessageIdRef: { current: -1 },
      procedures: {
        sendThreadMessage: async () => sendPromise,
      },
      selectedThread: threadDetail(17).thread,
      selectedThreadDetailRefreshKeyRef: { current: null },
      selectedThreadIdRef,
      selectedThreadIsWorking: false,
      selectedThreadRunStateRef: { current: "idle" },
      setChatError: () => {},
      setIsSending: (value) => {
        isSending = typeof value === "function" ? value(isSending) : value;
      },
      setThreadMessages: () => {},
      upsertThread: () => {},
    });

    await Promise.resolve();
    expect(readChatComposerDraft("", draftKey)).toBe("");
    expect(readChatComposerImageAttachments(draftKey)).toEqual([]);

    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      selectedThreadIdRef.current = 42;
      rejectSend(new Error("send failed"));
      await sendPromise.catch(() => null);
      await Promise.resolve();
    } finally {
      console.error = originalConsoleError;
    }

    expect(readChatComposerDraft("", draftKey)).toBe("hello");
    expect(readChatComposerImageAttachments(draftKey)).toHaveLength(1);
    expect(readChatComposerDraft("", "thread:42")).toBe("");
    expect(readChatComposerImageAttachments("thread:42")).toEqual([]);
    expect(isSending).toBeFalse();
  });
});
