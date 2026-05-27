import { describe, expect, it } from "bun:test";

import {
  encodePiWebSearchMarker,
  extractPiAssistantErrorMessage,
  extractPiAssistantMessageText,
  extractPiAssistantStopReason,
  extractPiAssistantThinkingText,
  extractPiAssistantUsage,
  extractPiAssistantWebSearchUpdates,
  extractPiMessageTimestamp,
  extractPiTextContent,
  extractPiToolExecutionOutput,
  splitPiAssistantInlineThinkingText,
  stripPiAssistantWebSearchMarkers,
} from "./pi-sdk-shapes";

describe("Pi SDK shape helpers", () => {
  it("extracts joined text blocks from Pi content arrays", () => {
    expect(
      extractPiTextContent([
        {
          text: "First block",
          type: "text",
        },
        {
          text: "ignored image",
          type: "image",
        },
        {
          text: "Second block",
          type: "text",
        },
      ]),
    ).toBe("First block\n\nSecond block");
  });

  it("extracts assistant message text from string and block content", () => {
    expect(
      extractPiAssistantMessageText({
        content: "Plain string reply",
      }),
    ).toBe("Plain string reply");
    expect(
      extractPiAssistantMessageText({
        content: [
          {
            text: "Structured reply",
            type: "text",
          },
        ],
      }),
    ).toBe("Structured reply");
  });

  it("extracts and strips embedded native web-search markers", () => {
    const startMarker = encodePiWebSearchMarker({
      id: "ws_1",
      query: "bun docs",
      state: "in_progress",
    });
    const endMarker = encodePiWebSearchMarker({
      id: "ws_1",
      query: "bun docs",
      state: "completed",
    });
    const text = `Before ${startMarker} after ${endMarker}`;

    expect(stripPiAssistantWebSearchMarkers(text)).toBe("Before  after ");
    expect(extractPiAssistantWebSearchUpdates(text)).toEqual([
      {
        id: "ws_1",
        query: "bun docs",
        state: "in_progress",
      },
      {
        id: "ws_1",
        query: "bun docs",
        state: "completed",
      },
    ]);
    expect(
      extractPiAssistantMessageText({
        content: text,
      }),
    ).toBe("Before  after ");
  });

  it("withholds suffixless and partial native web-search markers from assistant text", () => {
    const update = {
      id: "ws_1",
      query: "bun docs",
      state: "completed" as const,
    };
    const marker = encodePiWebSearchMarker(update);
    const suffixlessMarker = marker.slice(0, -1);
    const partialMarker = marker.slice(0, Math.floor(marker.length / 2));
    const partialPrefix = marker.slice(0, "\uE000metidos:web-".length);

    expect(stripPiAssistantWebSearchMarkers(suffixlessMarker)).toBe("");
    expect(extractPiAssistantWebSearchUpdates(suffixlessMarker)).toEqual([
      update,
    ]);
    expect(
      extractPiAssistantMessageText({
        content: suffixlessMarker,
      }),
    ).toBe("");

    expect(stripPiAssistantWebSearchMarkers(`Before ${partialMarker}`)).toBe(
      "Before ",
    );
    expect(
      stripPiAssistantWebSearchMarkers(`Before ${partialMarker} after`),
    ).toBe("Before  after");
    expect(extractPiAssistantWebSearchUpdates(partialMarker)).toEqual([]);
    expect(stripPiAssistantWebSearchMarkers(`Before ${partialPrefix}`)).toBe(
      "Before ",
    );
  });

  it("splits inline <think> tags into assistant and reasoning text", () => {
    const message = {
      content:
        "<think>Now let me plan the steps:\n1. Create directory structure</think>\nDone.",
    };
    expect(extractPiAssistantMessageText(message)).toBe("\nDone.");
    expect(extractPiAssistantThinkingText(message)).toBe(
      "Now let me plan the steps:\n1. Create directory structure",
    );
  });

  it("holds partial inline <think> tags until the stream becomes unambiguous", () => {
    expect(
      splitPiAssistantInlineThinkingText("   <thi", {
        finalize: false,
      }),
    ).toEqual({
      chatText: "",
      reasoningText: "",
    });
    expect(
      splitPiAssistantInlineThinkingText("   <thi", {
        finalize: true,
      }),
    ).toEqual({
      chatText: "   <thi",
      reasoningText: "",
    });
    expect(
      splitPiAssistantInlineThinkingText("<think>Plan first.</thi", {
        finalize: false,
      }),
    ).toEqual({
      chatText: "",
      reasoningText: "Plan first.",
    });
  });

  it("extracts provider error messages from failed assistant payloads", () => {
    expect(
      extractPiAssistantErrorMessage({
        errorMessage: "401 status code (no body)",
        stopReason: "error",
      }),
    ).toBe("401 status code (no body)");
    expect(
      extractPiAssistantErrorMessage({
        errorMessage: "ignored",
        stopReason: "stop",
      }),
    ).toBeNull();
  });

  it("extracts assistant stop reasons from Pi payloads", () => {
    expect(
      extractPiAssistantStopReason({
        stopReason: "aborted",
      }),
    ).toBe("aborted");
    expect(extractPiAssistantStopReason({ stopReason: "" })).toBeNull();
    expect(extractPiAssistantStopReason(null)).toBeNull();
  });

  it("extracts usage only when Pi reports finite token counts", () => {
    expect(
      extractPiAssistantUsage({
        usage: {
          cacheRead: 3,
          input: 11,
          output: 7,
        },
      }),
    ).toEqual({
      cachedInputTokens: 3,
      inputTokens: 11,
      outputTokens: 7,
    });
    expect(
      extractPiAssistantUsage({
        usage: {
          cacheRead: Number.NaN,
          input: "11",
          output: null,
        },
      }),
    ).toBeNull();
  });

  it("extracts timestamps and tool outputs from Pi-shaped payloads", () => {
    expect(
      extractPiMessageTimestamp({
        timestamp: 1234,
      }),
    ).toBe(1234);
    expect(
      extractPiToolExecutionOutput({
        content: [
          {
            text: "Tool output",
            type: "text",
          },
        ],
      }),
    ).toBe("Tool output");
    expect(extractPiToolExecutionOutput("plain tool output")).toBe(
      "plain tool output",
    );
    expect(
      extractPiToolExecutionOutput({
        markdown: "# Plugin markdown",
        type: "markdown",
      }),
    ).toBe("# Plugin markdown");
    expect(
      extractPiToolExecutionOutput({
        details: {
          result: {
            markdown: "# Nested plugin markdown",
            type: "markdown",
          },
        },
      }),
    ).toBe("# Nested plugin markdown");
  });
});
