import { describe, expect, it } from "bun:test";

import {
  extractPiAssistantMessageText,
  extractPiAssistantUsage,
  extractPiMessageTimestamp,
  extractPiTextContent,
  extractPiToolExecutionOutput,
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
  });
});
