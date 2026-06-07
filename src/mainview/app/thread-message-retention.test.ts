import { describe, expect, it } from "bun:test";
import type {
  RpcChatThreadMessage,
  RpcThreadMessage,
  RpcToolCallThreadMessage,
} from "../../bun/rpc-schema";
import {
  estimateThreadMessageRetainedBytes,
  estimateThreadMessagesRetainedBytes,
  MAX_RETAINED_THREAD_MESSAGES,
  MAX_RETAINED_THREAD_MESSAGE_TEXT_BYTES,
  retainRecentThreadMessages,
} from "./thread-message-retention";

function message(id: number): RpcChatThreadMessage {
  return {
    id,
    threadId: 1,
    role: "assistant",
    kind: "chat",
    itemId: null,
    text: `message ${id}`,
    state: "completed",
    createdAt: `2026-05-02T10:${String(id % 60).padStart(2, "0")}:00.000Z`,
    updatedAt: `2026-05-02T10:${String(id % 60).padStart(2, "0")}:00.000Z`,
  };
}

describe("retainRecentThreadMessages", () => {
  it("returns the existing array when it is already within the retention cap", () => {
    const messages = [message(1), message(2)];

    expect(retainRecentThreadMessages(messages)).toBe(messages);
  });

  it("estimates base64 media by decoded bytes", () => {
    const chat = {
      ...message(1),
      images: [
        {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
      ],
    } satisfies RpcThreadMessage;
    expect(estimateThreadMessageRetainedBytes(chat)).toBe(
      "message 1".length * 2 + 5,
    );
  });

  it("keeps media payloads out of retained thread message state", () => {
    const retained = retainRecentThreadMessages([
      {
        ...message(1),
        images: [
          {
            type: "image",
            data: "a".repeat(4096),
            mimeType: "image/png",
          },
        ],
      } as RpcThreadMessage,
    ]);

    const chatMessage = retained[0];
    expect(
      chatMessage?.kind === "chat" ? chatMessage.images?.[0]?.data : null,
    ).toBe("");
    expect(
      chatMessage?.kind === "chat" ? chatMessage.images?.[0]?.dataLoaded : null,
    ).toBe(false);
  });

  it("keeps tool-call output image payloads out of retained state", () => {
    const toolCall = {
      id: 2,
      threadId: 1,
      kind: "tool_call",
      server: "pi",
      tool: "browser_screenshot",
      argumentsText: "{}",
      output: "screenshot",
      outputImages: [
        {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png",
        },
      ],
      state: "completed",
      createdAt: "2026-05-02T10:02:00.000Z",
      updatedAt: "2026-05-02T10:02:00.000Z",
    } as RpcToolCallThreadMessage;

    expect(estimateThreadMessageRetainedBytes(toolCall)).toBe(
      "{}".length * 2 + "screenshot".length * 2 + 5,
    );

    const retained = retainRecentThreadMessages([toolCall]);
    const retainedToolCall = retained[0];

    expect(
      retainedToolCall?.kind === "tool_call"
        ? retainedToolCall.outputImages?.[0]?.data
        : null,
    ).toBe("");
    expect(
      retainedToolCall?.kind === "tool_call"
        ? retainedToolCall.outputImages?.[0]?.dataLoaded
        : null,
    ).toBe(false);
  });

  it("bounds retained message text by bytes", () => {
    const retained = retainRecentThreadMessages(
      Array.from({ length: 40 }, (_value, index) => ({
        ...message(index + 1),
        text: "x".repeat(200_000),
      })),
    );

    expect(estimateThreadMessagesRetainedBytes(retained)).toBeLessThanOrEqual(
      MAX_RETAINED_THREAD_MESSAGE_TEXT_BYTES,
    );
    expect(retained.length).toBeLessThan(40);
  });

  it("truncates a single oversized message body", () => {
    const retained = retainRecentThreadMessages([
      {
        ...message(1),
        text: "x".repeat(400_000),
      },
    ]);

    expect(estimateThreadMessagesRetainedBytes(retained)).toBeLessThanOrEqual(
      MAX_RETAINED_THREAD_MESSAGE_TEXT_BYTES,
    );
    expect(retained[0]?.kind === "chat" ? retained[0].text : "").toContain(
      "truncated from browser memory",
    );
  });

  it("keeps only the most recent messages in original order", () => {
    const messages = Array.from(
      { length: MAX_RETAINED_THREAD_MESSAGES + 25 },
      (_, index) => message(index + 1),
    );

    const retained = retainRecentThreadMessages(messages);

    expect(retained).toHaveLength(MAX_RETAINED_THREAD_MESSAGES);
    expect(retained[0]?.id).toBe(26);
    expect(retained.at(-1)?.id).toBe(MAX_RETAINED_THREAD_MESSAGES + 25);
  });
});
