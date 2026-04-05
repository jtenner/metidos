import { describe, expect, it } from "bun:test";

import {
  shouldUseRichMarkdownRenderer,
  splitPlainTextMessage,
} from "./message-markdown-routing";

describe("message markdown routing helpers", () => {
  it("keeps ordinary text and bare URLs on the lightweight renderer", () => {
    expect(
      shouldUseRichMarkdownRenderer(
        "Plain update text with a link https://example.com/docs",
      ),
    ).toBeFalse();
    expect(shouldUseRichMarkdownRenderer("Just a short reply.")).toBeFalse();
  });

  it("routes markdown-heavy content to the rich renderer", () => {
    expect(
      shouldUseRichMarkdownRenderer("## Heading\n\n- item one\n- item two"),
    ).toBeTrue();
    expect(
      shouldUseRichMarkdownRenderer(
        "Here is `inline code` and [a link](https://example.com).",
      ),
    ).toBeTrue();
    expect(
      shouldUseRichMarkdownRenderer("```ts\nconsole.log('hello');\n```"),
    ).toBeTrue();
  });

  it("splits plain text into text and link segments", () => {
    expect(
      splitPlainTextMessage(
        "Docs: https://example.com/docs and https://example.com/api.",
      ),
    ).toEqual([
      {
        kind: "text",
        key: "0:6",
        text: "Docs: ",
      },
      {
        href: "https://example.com/docs",
        kind: "link",
        key: "6:30",
        text: "https://example.com/docs",
      },
      {
        kind: "text",
        key: "30:35",
        text: " and ",
      },
      {
        href: "https://example.com/api",
        kind: "link",
        key: "35:58",
        text: "https://example.com/api",
      },
      {
        kind: "text",
        key: "58:59",
        text: ".",
      },
    ]);
  });
});
