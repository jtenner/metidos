/**
 * @file src/mainview/app/transcript-state.test.ts
 * @description Focused tests for transcript state projection and history merging.
 */

import { describe, expect, it } from "bun:test";

import type {
  RpcChatThreadMessage,
  RpcProject,
  RpcThread,
  RpcThreadMessage,
  RpcToolCallThreadMessage,
} from "../../bun/rpc-schema";
import {
  buildVisibleTranscriptState,
  compactTextSignature,
  createVisibleTranscriptStateCache,
  deriveVisibleTranscriptMediaPayloads,
  mergeThreadMessageHistory,
  pruneVisibleMessageCache,
  shouldRenderThreadMessageControl,
  stripThreadMessageMediaPayloadData,
  threadMessageVisibleSignature,
} from "./transcript-state";

function chatMessage(
  id: number,
  text: string,
  overrides?: Partial<RpcThreadMessage>,
): RpcThreadMessage {
  return {
    createdAt: `2026-04-12T16:18:${String(id).padStart(2, "0")}Z`,
    id,
    itemId: null,
    kind: "chat",
    role: "assistant",
    state: "completed",
    text,
    threadId: 7,
    updatedAt: `2026-04-12T16:18:${String(id).padStart(2, "0")}Z`,
    ...overrides,
  } as RpcThreadMessage;
}

describe("visible message signatures", () => {
  it("uses compact signatures instead of embedding large chat content", () => {
    const largeText = `${"x".repeat(8_000)}needle${"y".repeat(8_000)}`;
    const signature = threadMessageVisibleSignature(chatMessage(1, largeText));

    expect(signature).toStartWith("chat:completed:assistant:");
    expect(signature).not.toContain(largeText);
    expect(signature).not.toContain("needle");
  });

  it("changes compact signatures when content changes", () => {
    expect(compactTextSignature("alpha")).not.toBe(
      compactTextSignature("bravo"),
    );
    expect(threadMessageVisibleSignature(chatMessage(1, "alpha"))).not.toBe(
      threadMessageVisibleSignature(chatMessage(1, "bravo")),
    );
  });

  it("keeps compact signatures deterministic for uncached large text", () => {
    const largeText = `${"x".repeat(2_000)}uncached${"y".repeat(2_000)}`;

    expect(compactTextSignature(largeText)).toBe(
      compactTextSignature(largeText),
    );
    expect(compactTextSignature(largeText)).not.toBe(
      compactTextSignature(`${largeText}!`),
    );
  });

  it("uses compact signatures for command output", () => {
    const largeOutput = `${"a".repeat(5_000)}secret${"b".repeat(5_000)}`;
    const signature = threadMessageVisibleSignature({
      createdAt: "2026-04-12T16:19:00Z",
      id: 2,
      itemId: "cmd-2",
      kind: "command",
      role: "assistant",
      text: largeOutput,
      command: "bun test",
      exitCode: 0,
      output: largeOutput,
      state: "completed",
      threadId: 7,
      updatedAt: "2026-04-12T16:19:00Z",
    });

    expect(signature).not.toContain(largeOutput);
    expect(signature).not.toContain("secret");
    expect(signature).toContain(compactTextSignature(largeOutput));
  });
});

describe("stripThreadMessageMediaPayloadData", () => {
  it("removes loaded tool-call image bytes while preserving loaded output state", () => {
    const message = chatMessage(8, "browser screenshot", {
      argumentsText: "{}",
      kind: "tool_call",
      output: "Plugin image file: ~/screenshots/page.png",
      outputImages: [
        {
          byteSize: 3,
          data: "abc",
          dataLoaded: true,
          mimeType: "image/png",
          type: "image",
        },
      ],
      outputLoaded: true,
      server: "pi",
      state: "completed",
      tool: "browser_screenshot",
    }) as RpcToolCallThreadMessage;

    expect(stripThreadMessageMediaPayloadData(message)).toEqual({
      ...message,
      outputImages: [
        {
          byteSize: 3,
          data: "",
          dataLoaded: true,
          mimeType: "image/png",
          type: "image",
        },
      ],
    });
  });
});

describe("shouldRenderThreadMessageControl", () => {
  it("hides edit tool-call controls because file-change rows show the result", () => {
    const editToolCall = chatMessage(3, "edit result", {
      argumentsText: '{"path":"src/example.ts"}',
      kind: "tool_call",
      output: "2 edit blocks",
      outputLoaded: true,
      server: "pi",
      state: "completed",
      tool: "edit",
    }) as RpcToolCallThreadMessage;
    const readToolCall = {
      ...editToolCall,
      id: 4,
      tool: "read",
    } satisfies RpcToolCallThreadMessage;

    expect(shouldRenderThreadMessageControl(editToolCall)).toBe(false);
    expect(shouldRenderThreadMessageControl(readToolCall)).toBe(true);
  });
});

describe("pruneVisibleMessageCache", () => {
  it("removes retired rows while preserving current visible row entries", () => {
    const currentVisibleRow = { key: "thread-message:3" };
    const cache = new Map<string, unknown>([
      ["thread-message:1", { value: { key: "thread-message:1" } }],
      ["thread-message:2", { value: { key: "thread-message:2" } }],
      ["thread-message:3", currentVisibleRow],
      ["thread-working:7", { value: { key: "thread-working:7" } }],
    ]);

    pruneVisibleMessageCache(cache, ["thread-message:3", "thread-working:7"]);

    expect(cache.has("thread-message:1")).toBe(false);
    expect(cache.has("thread-message:2")).toBe(false);
    expect(cache.get("thread-message:3")).toBe(currentVisibleRow);
    expect(cache.has("thread-working:7")).toBe(true);
    expect(cache.size).toBe(2);
  });
});

describe("mergeThreadMessageHistory", () => {
  it("appends strictly newer ranges without reordering existing messages", () => {
    const current = [chatMessage(1, "alpha"), chatMessage(2, "beta")];
    const incoming = [chatMessage(3, "gamma"), chatMessage(4, "delta")];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3, 4]);
    expect(merged[0]).toBe(current[0]);
    expect(merged[1]).toBe(current[1]);
    expect(merged[2]).toBe(incoming[0]);
    expect(merged[3]).toBe(incoming[1]);
  });

  it("prepends strictly older ranges without rebuilding the newer tail", () => {
    const current = [chatMessage(5, "epsilon"), chatMessage(6, "zeta")];
    const incoming = [chatMessage(3, "gamma"), chatMessage(4, "delta")];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => message.id)).toEqual([3, 4, 5, 6]);
    expect(merged[0]).toBe(incoming[0]);
    expect(merged[1]).toBe(incoming[1]);
    expect(merged[2]).toBe(current[0]);
    expect(merged[3]).toBe(current[1]);
  });

  it("sorts out-of-order incoming ranges before merging", () => {
    const current = [chatMessage(2, "beta"), chatMessage(4, "delta")];
    const incoming = [
      chatMessage(5, "epsilon"),
      chatMessage(1, "alpha"),
      chatMessage(3, "gamma"),
    ];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => message.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("deduplicates overlapping histories and keeps the newest copy for repeated ids", () => {
    const current = [chatMessage(1, "alpha"), chatMessage(3, "old gamma")];
    const incoming = [chatMessage(2, "beta"), chatMessage(3, "new gamma")];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged.map((message) => [message.id, message.text])).toEqual([
      [1, "alpha"],
      [2, "beta"],
      [3, "new gamma"],
    ]);
    expect(merged[2]).toBe(incoming[1]);
  });

  it("does not replace loaded tool output with a deferred thread refresh copy", () => {
    const currentMessage = chatMessage(1, "tool result", {
      argumentsText: "{}",
      kind: "tool_call",
      output: "loaded output",
      outputLoaded: true,
      server: "pi",
      state: "completed",
      tool: "read",
    }) as RpcToolCallThreadMessage;
    const incomingMessage = chatMessage(1, "tool result", {
      argumentsText: "{}",
      kind: "tool_call",
      output: "",
      outputLoaded: false,
      server: "pi",
      state: "completed",
      tool: "read",
      updatedAt: "2026-04-12T16:19:00Z",
    }) as RpcToolCallThreadMessage;
    const current = [currentMessage];
    const incoming = [incomingMessage];

    const merged = mergeThreadMessageHistory(current, incoming);

    expect(merged[0]).toEqual({
      ...incomingMessage,
      output: "loaded output",
      outputLoaded: true,
    });
  });

  it("backfills older history without replacing cached visible rows", () => {
    const cache = createVisibleTranscriptStateCache();
    const current = [chatMessage(5, "epsilon"), chatMessage(6, "zeta")];
    const firstState = buildVisibleTranscriptState({
      activeChatError: "",
      activeChatNotice: "",
      activeSelectedWorktreeFolder: "repo",
      activeSelectedWorktreePath: "/repo",
      activeThreadWorkingMessage: null,
      activeThreadWorkingVisible: true,
      cache,
      initialTranscriptIsBusy: false,
      isCreatingThread: false,
      isThreadLoading: false,
      selectedProject: project(),
      selectedThread: thread(),
      selectedThreadId: 7,
      threadMessages: current,
    });
    const olderHistory = [chatMessage(3, "gamma"), chatMessage(4, "delta")];

    const merged = mergeThreadMessageHistory(current, olderHistory);
    const nextState = buildVisibleTranscriptState({
      activeChatError: "",
      activeChatNotice: "",
      activeSelectedWorktreeFolder: "repo",
      activeSelectedWorktreePath: "/repo",
      activeThreadWorkingMessage: null,
      activeThreadWorkingVisible: true,
      cache,
      initialTranscriptIsBusy: false,
      isCreatingThread: false,
      isThreadLoading: false,
      selectedProject: project(),
      selectedThread: thread(),
      selectedThreadId: 7,
      threadMessages: merged,
    });

    expect(nextState.messages.map((message) => message.key)).toEqual([
      "thread-message:3",
      "thread-message:4",
      "thread-message:5",
      "thread-message:6",
    ]);
    expect(nextState.messages[2]).toBe(firstState.messages[0]);
    expect(nextState.messages[3]).toBe(firstState.messages[1]);
  });
});

function project(overrides?: Partial<RpcProject>): RpcProject {
  return {
    createdAt: "2026-04-12T16:00:00Z",
    id: 12,
    isOpen: 1,
    lastOpenedAt: "2026-04-12T16:00:00Z",
    name: "Example",
    path: "/repo",
    updatedAt: "2026-04-12T16:00:00Z",
    ...overrides,
  };
}

function thread(overrides?: Partial<RpcThread>): RpcThread {
  return {
    agentsAccess: true,
    compaction: {
      estimatedTriggerSource: "heuristic",
      estimatedTriggerTokens: 200_000,
      inferredCount: 0,
      lastInferredAfterInputTokens: null,
      lastInferredAt: null,
      lastInferredBeforeInputTokens: null,
      maxObservedInputTokens: null,
    },
    createdAt: "2026-04-12T16:00:00Z",
    githubAccess: true,
    lastRunAt: null,
    metidosAccess: true,
    model: "test-model",
    permissions: [],
    piLeafEntryId: null,
    piSessionFile: null,
    piSessionId: null,
    pinnedAt: null,
    pluginAccessGroups: [],
    projectId: 12,
    reasoningEffort: "medium",
    runStatus: {
      error: null,
      hasUnreadError: false,
      startedAt: null,
      state: "idle",
      updatedAt: null,
    },
    summary: null,
    title: "Thread",
    unsafeMode: false,
    updatedAt: "2026-04-12T16:00:00Z",
    usage: null,
    webSearchAccess: true,
    worktreePath: "/repo",
    id: 7,
    ...overrides,
  };
}

describe("buildVisibleTranscriptState", () => {
  it("reuses stable row objects while deriving media payloads from current thread messages", () => {
    const cache = createVisibleTranscriptStateCache();
    const firstMessage = chatMessage(1, "first", {
      images: [
        {
          byteSize: 8,
          data: "first-image-data",
          dataLoaded: true,
          mimeType: "image/png",
          type: "image",
        },
      ],
      role: "user",
    }) as RpcChatThreadMessage;
    const secondMessage = chatMessage(2, "second");

    const firstState = buildVisibleTranscriptState({
      activeChatError: "",
      activeChatNotice: "",
      activeSelectedWorktreeFolder: "repo",
      activeSelectedWorktreePath: "/repo",
      activeThreadWorkingMessage: null,
      activeThreadWorkingVisible: true,
      cache,
      initialTranscriptIsBusy: false,
      isCreatingThread: false,
      isThreadLoading: false,
      selectedProject: project(),
      selectedThread: thread(),
      selectedThreadId: 7,
      threadMessages: [firstMessage, secondMessage],
    });
    const firstUserRow = firstState.messages[0];

    const nextState = buildVisibleTranscriptState({
      activeChatError: "",
      activeChatNotice: "",
      activeSelectedWorktreeFolder: "repo",
      activeSelectedWorktreePath: "/repo",
      activeThreadWorkingMessage: null,
      activeThreadWorkingVisible: true,
      cache,
      initialTranscriptIsBusy: false,
      isCreatingThread: false,
      isThreadLoading: false,
      selectedProject: project(),
      selectedThread: thread(),
      selectedThreadId: 7,
      threadMessages: [firstMessage, secondMessage],
    });

    expect(nextState.messages[0]).toBe(firstUserRow);
    expect(nextState.messages.map((message) => message.key)).toEqual([
      "thread-message:1",
      "thread-message:2",
    ]);
    expect(nextState.mediaPayloads.get("thread-message:1:image:0")).toBe(
      "first-image-data",
    );
  });

  it("keeps busy state and synthetic working row inside the transcript state interface", () => {
    const state = buildVisibleTranscriptState({
      activeChatError: "",
      activeChatNotice: "",
      activeSelectedWorktreeFolder: "repo",
      activeSelectedWorktreePath: "/repo",
      activeThreadWorkingMessage: "Running checks",
      activeThreadWorkingVisible: true,
      cache: createVisibleTranscriptStateCache(),
      initialTranscriptIsBusy: false,
      isCreatingThread: false,
      isThreadLoading: false,
      selectedProject: project(),
      selectedThread: thread({
        runStatus: {
          error: null,
          hasUnreadError: false,
          startedAt: "2026-04-12T16:20:00Z",
          state: "working",
          updatedAt: "2026-04-12T16:20:00Z",
        },
      }),
      selectedThreadId: 7,
      threadMessages: [chatMessage(1, "Done")],
    });

    expect(state.transcriptIsBusy).toBe(true);
    expect(state.messages.at(-1)).toMatchObject({
      key: "thread-working:7",
      kind: "chat",
      speaker: "assistant",
      state: "in_progress",
      text: "Running checks",
      tone: "working",
    });
  });
});

describe("deriveVisibleTranscriptMediaPayloads", () => {
  it("extracts only loaded chat image payload data", () => {
    const payloads = deriveVisibleTranscriptMediaPayloads([
      chatMessage(1, "image", {
        images: [
          {
            byteSize: 1,
            data: "loaded",
            dataLoaded: true,
            mimeType: "image/png",
            type: "image",
          },
          {
            byteSize: 2,
            data: "",
            dataLoaded: false,
            mimeType: "image/jpeg",
            type: "image",
          },
        ],
        role: "user",
      }) as RpcChatThreadMessage,
    ]);

    expect([...payloads.entries()]).toEqual([
      ["thread-message:1:image:0", "loaded"],
    ]);
  });
});
