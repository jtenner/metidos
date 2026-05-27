/**
 * @file src/mainview/app/message-markdown.test.tsx
 * @description Test file for message markdown rendering.
 */

import { describe, expect, it } from "bun:test";
import { renderToReadableStream } from "react-dom/server";

import {
  PreparedRichMarkdownMessage,
  RichMarkdownMessage,
} from "./message-markdown";
import { prepareMessageRenderPlan } from "./message-preprocessing";

describe("RichMarkdownMessage", () => {
  it("renders markdown links with explicit noopener protection", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage text={"[Docs](https://example.com/docs)"} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain('href="https://example.com/docs"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("renders code blocks through the GetDown renderer override", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage text={"```ts\nconst ok = true;\n```"} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("message-markdown-code-block");
    expect(markup).toContain("language-ts");
    expect(markup).toContain("const ok = true;");
    expect(markup).not.toContain("react-syntax-highlighter");
    expect(markup).not.toContain("data-streamdown");
  });

  it("renders prepared code blocks whose opening fence has a full info string", async () => {
    const plan = prepareMessageRenderPlan(
      [
        "Actually wait, looking at the code again:",
        "",
        "```javascript const measureTranscriptRowElement = useCallback(",
        "const nextHeight = element.offsetHeight;",
        "```",
        "",
        "This is in the dep array.",
      ].join("\n"),
    );
    if (plan.kind !== "rich") {
      throw new Error("Expected rich render plan");
    }

    const stream = await renderToReadableStream(
      <PreparedRichMarkdownMessage plan={plan} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("message-markdown-code-block");
    expect(markup).toContain("language-javascript");
    expect(markup).toContain("const nextHeight = element.offsetHeight;");
    expect(markup).toContain("This is in the dep array.");
    expect(markup).not.toContain(
      "javascript const measureTranscriptRowElement",
    );
  });

  it("repairs a missing leading bold marker in assistant heading text", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage text={"*Navigating handoff procedure**"} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("<strong>Navigating handoff procedure</strong>");
    expect(markup).not.toContain("<em>Navigating handoff procedure</em>");
    expect(markup).not.toContain("procedure</em>*");
  });

  it("omits unsafe markdown link hrefs", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage text={"[Bad](javascript:alert(1))"} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain(">Bad</a>");
    expect(markup).not.toContain("javascript:alert");
  });

  it("blocks remote markdown images until the user explicitly loads them", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage
        text={"![Architecture diagram](https://example.com/diagram.png)"}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("External");
    expect(markup).toContain("image blocked");
    expect(markup).toContain("example.com");
    expect(markup).toContain("Architecture diagram");
    expect(markup).toContain("Load image");
    expect(markup).toContain("Load image from example.com");
    expect(markup).toContain('href="https://example.com/diagram.png"');
    expect(markup).not.toContain('<img src="https://example.com/diagram.png"');
  });

  it("allows generated embedded image data only behind the load affordance", async () => {
    const png = "iVBORw0KGgo=";
    const stream = await renderToReadableStream(
      <RichMarkdownMessage
        text={`![Generated cat](data:image/png;base64,${png})`}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("Embedded");
    expect(markup).toContain("image blocked");
    expect(markup).toContain("embedded generated image");
    expect(markup).toContain("Generated cat");
    expect(markup).toContain("Load image from embedded generated image");
    expect(markup).not.toContain("Open image");
    expect(markup).not.toContain("<img");
  });

  it("does not offer a load action for unsafe markdown image schemes", async () => {
    const stream = await renderToReadableStream(
      <RichMarkdownMessage text={"![Bad](javascript:alert(1))"} />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();

    expect(markup).toContain("External");
    expect(markup).toContain("image blocked");
    expect(markup).toContain("Bad");
    expect(markup).not.toContain("Load image");
    expect(markup).not.toContain("javascript:alert");
  });
});
