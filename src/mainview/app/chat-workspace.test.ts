import { describe, expect, it } from "bun:test";

import { deriveGroupedVisibleMessages } from "./chat-workspace";
import type { VisibleMessage } from "./state";

function assistantChatMessage(key: string, text: string): VisibleMessage {
  return {
    key,
    kind: "chat",
    speaker: "assistant",
    text,
    tone: "normal",
  };
}

function userChatMessage(key: string, text: string): VisibleMessage {
  return {
    key,
    kind: "chat",
    speaker: "user",
    text,
  };
}

function reasoningMessage(key: string, text: string): VisibleMessage {
  return {
    key,
    kind: "reasoning",
    state: "completed",
    text,
  };
}

describe("deriveGroupedVisibleMessages", () => {
  it("extends grouped transcript state from the append-only tail", () => {
    const initialMessages = [
      assistantChatMessage("assistant-1", "First"),
      reasoningMessage("assistant-2", "Reasoning"),
      userChatMessage("user-1", "Question"),
      assistantChatMessage("assistant-3", "Reply"),
    ];
    const initialCache = deriveGroupedVisibleMessages(
      12,
      initialMessages,
      null,
    );

    const appendedMessages = [
      ...initialMessages,
      reasoningMessage("assistant-4", "More detail"),
    ];
    const appendedCache = deriveGroupedVisibleMessages(
      12,
      appendedMessages,
      initialCache,
    );

    expect(initialCache.groups).toHaveLength(3);
    expect(initialCache.groups[0]).toEqual({
      endIndex: 2,
      key: "assistant-1",
      kind: "assistant",
      startIndex: 0,
    });
    expect(initialCache.groups[1]).toEqual({
      key: "user-1",
      kind: "user",
      messageIndex: 2,
    });
    expect(initialCache.groups[2]).toEqual({
      endIndex: 4,
      key: "assistant-3",
      kind: "assistant",
      startIndex: 3,
    });

    expect(appendedCache.groups).toHaveLength(3);
    expect(appendedCache.groups[0]).toBe(initialCache.groups[0]);
    expect(appendedCache.groups[1]).toBe(initialCache.groups[1]);
    expect(appendedCache.groups[2]).not.toBe(initialCache.groups[2]);
    expect(appendedCache.groups[2]).toEqual({
      endIndex: 5,
      key: "assistant-3",
      kind: "assistant",
      startIndex: 3,
    });
  });

  it("reuses grouping structure when message contents change without changing boundaries", () => {
    const initialMessages = [
      assistantChatMessage("assistant-1", "Old assistant text"),
      userChatMessage("user-1", "Old user text"),
      assistantChatMessage("assistant-2", "Second assistant"),
    ];
    const initialCache = deriveGroupedVisibleMessages(
      44,
      initialMessages,
      null,
    );

    const updatedMessages = [
      assistantChatMessage("assistant-1", "New assistant text"),
      userChatMessage("user-1", "New user text"),
      assistantChatMessage("assistant-2", "Second assistant"),
    ];
    const updatedCache = deriveGroupedVisibleMessages(
      44,
      updatedMessages,
      initialCache,
    );

    expect(updatedCache.groups).toBe(initialCache.groups);
    expect(updatedCache.messages).toBe(updatedMessages);
    expect(updatedCache.groups).toEqual([
      {
        endIndex: 1,
        key: "assistant-1",
        kind: "assistant",
        startIndex: 0,
      },
      {
        key: "user-1",
        kind: "user",
        messageIndex: 1,
      },
      {
        endIndex: 3,
        key: "assistant-2",
        kind: "assistant",
        startIndex: 2,
      },
    ]);
  });
});
