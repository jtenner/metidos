/**
 * @file src/mainview/app/message-ui.test.tsx
 * @description Test file for message ui.
 */

import { describe, expect, it } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

import { loadRichMarkdownModule } from "./message-markdown-loader";
import { ReasoningMessage } from "./message-ui";

describe("ReasoningMessage", () => {
  it("renders markdown content without the status label", async () => {
    await loadRichMarkdownModule();

    const stream = await renderToReadableStream(
      <ReasoningMessage
        label="Thinking"
        text={"**Plan**\n\n- first\n- second"}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("<strong>Plan</strong>");
    expect(markup).toContain("<li>first</li>");
    expect(markup).toContain("<li>second</li>");
    expect(markup).toContain(">Thinking<");
    expect(markup).not.toContain(">Complete<");
    expect(markup).not.toContain(">Working<");
    expect(markup).not.toContain(">Stopped<");
  });
});
