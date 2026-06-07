/**
 * @file src/mainview/app/message-ui.test.tsx
 * @description Test file for message ui.
 */

import { describe, expect, it } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

import { loadRichMarkdownModule } from "./message-markdown-loader";
import {
  CommandExecutionMessage,
  MarkdownMessage,
  ReasoningMessage,
  ToolCallMessage,
  TranscriptMessageContent,
} from "./message-ui";
import { buildTranscriptItemViewModels } from "./transcript-pipeline";
import type { VisibleMessage } from "./visible-message-state";

describe("MarkdownMessage", () => {
  const largeMarkdownText = `${"Intro text. ".repeat(220)}\n\n**Important:** [OpenAI](https://openai.com)`;

  it("keeps large in-progress markdown on the lightweight streaming path", async () => {
    await loadRichMarkdownModule();

    const stream = await renderToReadableStream(
      <MarkdownMessage state="in_progress" text={largeMarkdownText} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("**Important:**");
    expect(markup).toContain('href="https://openai.com"');
    expect(markup).not.toContain("<strong>Important:</strong>");
  });

  it("upgrades large completed markdown to rich rendering", async () => {
    await loadRichMarkdownModule();

    const stream = await renderToReadableStream(
      <MarkdownMessage state="completed" text={largeMarkdownText} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("<strong>Important:</strong>");
    expect(markup).toContain('href="https://openai.com"');
  });
});

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

describe("CommandExecutionMessage", () => {
  it("keeps empty command output rows expandable", async () => {
    const stream = await renderToReadableStream(
      <CommandExecutionMessage
        command="true"
        exitCode={0}
        expanded={true}
        output=""
        outputLoaded={true}
        state="completed"
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain('aria-expanded="true"');
    expect(markup.match(/Toggle command output for true/g)?.length).toBe(2);
    expect(markup).toContain("No command output.");
  });
});

describe("ToolCallMessage", () => {
  it("renders sqlite output through the markdown renderer", async () => {
    await loadRichMarkdownModule();

    const stream = await renderToReadableStream(
      <ToolCallMessage
        activeThreadId={1}
        argumentsText=""
        expanded={true}
        homeDirectory="/Users/example"
        mediaPayloads={new Map()}
        messageId={1}
        messageKey="tool-sqlite"
        onRequestMessageContent={() => undefined}
        output={"| id | title |\n| --- | --- |\n| 1 | Ship it |"}
        server="pi"
        state="completed"
        supportsTildePath={true}
        tool="sqlite"
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("message-markdown-table");
    expect(markup).toContain("<td>1</td>");
    expect(markup).toContain("<td>Ship it</td>");
  });

  it("renders web_server_host output through the markdown renderer", async () => {
    await loadRichMarkdownModule();

    const stream = await renderToReadableStream(
      <ToolCallMessage
        activeThreadId={1}
        argumentsText=""
        expanded={true}
        homeDirectory="/Users/example"
        mediaPayloads={new Map()}
        messageId={1}
        messageKey="tool-web-server"
        onRequestMessageContent={() => undefined}
        output={[
          "Hosted site as web server 1.",
          "",
          "- Bound on: `0.0.0.0:8123`",
          "- [http://notwindows:8123/](http://notwindows:8123/)",
        ].join("\n")}
        server="pi"
        state="completed"
        supportsTildePath={true}
        tool="web_server_host"
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("0.0.0.0:8123");
    expect(markup).toContain('href="http://notwindows:8123/"');
    expect(markup).toContain("Hosted site as web server 1.");
  });
});

describe("TranscriptMessageContent", () => {
  it("renders chat image attachments for assistant messages", async () => {
    const messages: VisibleMessage[] = [
      {
        images: [
          {
            byteSize: 68,
            mimeType: "image/png",
            payloadKey: "thread-message:42:image:0",
            type: "image",
          },
        ],
        key: "thread-message:42",
        kind: "chat",
        messageId: 42,
        speaker: "assistant",
        state: "completed",
        text: "",
      },
    ];
    const [item] = buildTranscriptItemViewModels(messages, new Set());
    if (!item) {
      throw new Error("Expected transcript item.");
    }

    const stream = await renderToReadableStream(
      <TranscriptMessageContent
        activeThreadId={7}
        extensionHiddenThinkingLabel={null}
        homeDirectory="/Users/example"
        item={item}
        mediaPayloads={new Map([["thread-message:42:image:0", ""]])}
        onRequestMessageContent={() => undefined}
        onToggleItemExpanded={() => undefined}
        supportsTildePath={true}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("Image preview unavailable");
    expect(markup).toContain("Open attachment 1 full size");
    expect(markup).toContain("68 B");
  });

  it("renders prepared transcript view-model items", async () => {
    const messages: VisibleMessage[] = [
      {
        argumentsText: "{}",
        key: "thread-message:12",
        kind: "tool_call",
        messageId: 12,
        output: "",
        outputLoaded: false,
        server: "pi",
        state: "completed",
        tool: "web_server_host",
      },
    ];
    const [item] = buildTranscriptItemViewModels(messages, new Set());
    if (!item) {
      throw new Error("Expected transcript item.");
    }

    const stream = await renderToReadableStream(
      <TranscriptMessageContent
        activeThreadId={7}
        extensionHiddenThinkingLabel={null}
        homeDirectory="/Users/example"
        item={item}
        mediaPayloads={new Map()}
        onRequestMessageContent={() => undefined}
        onToggleItemExpanded={() => undefined}
        supportsTildePath={true}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain(">Tool<");
    expect(markup).toContain(">web_server_host<");
    expect(markup).toContain(">Completed<");
    expect(markup).toContain("Loading output...");
  });
});
