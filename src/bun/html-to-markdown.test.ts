import { describe, expect, it } from "bun:test";
import {
  MARKUP_CONVERSION_MAX_CHARS,
  convertHtmlToMarkdown,
  convertMarkdownToHtml,
} from "./html-to-markdown";

describe("markup conversion helpers", () => {
  it("converts HTML to Markdown with the shared Turndown configuration", () => {
    expect(
      convertHtmlToMarkdown(
        "<main><h1>Hello</h1><pre><code>const ok = true;</code></pre></main>",
      ),
    ).toContain("# Hello");
    expect(
      convertHtmlToMarkdown(
        "<main><h1>Hello</h1><pre><code>const ok = true;</code></pre></main>",
      ),
    ).toContain("```");
  });

  it("converts Markdown to safe generated HTML without preserving raw HTML", () => {
    expect(
      convertMarkdownToHtml(
        "# Hi\n\n<script>alert(1)</script> **safe** [link](javascript:alert)",
      ),
    ).toBe(
      '<h1>Hi</h1>\n<p>&lt;script&gt;alert(1)&lt;/script&gt; <strong>safe</strong> <a href="#" rel="nofollow noopener noreferrer">link</a></p>',
    );
  });

  it("rejects conversion input over the 10 MiB character limit", () => {
    const oversized = "x".repeat(MARKUP_CONVERSION_MAX_CHARS + 1);
    expect(() => convertHtmlToMarkdown(oversized)).toThrow(
      "maximum is 10485760 characters",
    );
    expect(() => convertMarkdownToHtml(oversized)).toThrow(
      "maximum is 10485760 characters",
    );
  });
});
