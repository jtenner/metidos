/**
 * @file src/bun/html-to-markdown.ts
 * @description Shared bounded HTML/Markdown conversion helpers for fetched page content and plugins.
 */

import TurndownService from "turndown";

export const MARKUP_CONVERSION_MAX_CHARS = 10 * 1024 * 1024;

class MarkupConversionInputTooLargeError extends Error {
  code = "markup_conversion_input_too_large";

  constructor(inputLength: number) {
    super(
      `Markup conversion input is ${inputLength} characters; maximum is ${MARKUP_CONVERSION_MAX_CHARS} characters.`,
    );
    this.name = "MarkupConversionInputTooLargeError";
  }
}

function assertMarkupInputLimit(value: string): void {
  if (value.length > MARKUP_CONVERSION_MAX_CHARS) {
    throw new MarkupConversionInputTooLargeError(value.length);
  }
}

export function createDefaultHtmlToMarkdown(): (html: string) => string {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  return (html: string) => turndown.turndown(html);
}

const defaultHtmlToMarkdown = createDefaultHtmlToMarkdown();

export function convertHtmlToMarkdown(html: string): string {
  assertMarkupInputLimit(html);
  return defaultHtmlToMarkdown(html);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLinkUrl(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:|#|\/)/iu.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return "#";
}

function renderInlineMarkdown(markdown: string): string {
  let html = escapeHtml(markdown);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_match, label: string, href: string) =>
      `<a href="${safeLinkUrl(href)}" rel="nofollow noopener noreferrer">${label}</a>`,
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

function flushParagraph(lines: string[], output: string[]): void {
  if (lines.length === 0) {
    return;
  }
  output.push(`<p>${renderInlineMarkdown(lines.join(" ").trim())}</p>`);
  lines.length = 0;
}

function flushList(items: string[], ordered: boolean, output: string[]): void {
  if (items.length === 0) {
    return;
  }
  const tag = ordered ? "ol" : "ul";
  output.push(
    `<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`,
  );
  items.length = 0;
}

/**
 * Convert Markdown to safe HTML without executing or preserving raw HTML.
 *
 * This intentionally implements a conservative Markdown subset and escapes all
 * source text before adding generated tags. Raw HTML in markdown remains text,
 * links are limited to common safe URL schemes, and generated links get
 * noopener/noreferrer attributes for safe display in a browser context.
 */
export function convertMarkdownToHtml(markdown: string): string {
  assertMarkupInputLimit(markdown);

  const output: string[] = [];
  const paragraph: string[] = [];
  const listItems: string[] = [];
  let listOrdered = false;
  let fence: { info: string; lines: string[] } | null = null;

  const flushBlocks = () => {
    flushParagraph(paragraph, output);
    flushList(listItems, listOrdered, output);
  };

  for (const line of markdown.replaceAll("\r\n", "\n").split("\n")) {
    const fenceMatch = line.match(/^```\s*([^`]*)$/u);
    if (fence) {
      if (fenceMatch) {
        output.push(
          `<pre><code${fence.info ? ` class="language-${escapeHtml(fence.info)}"` : ""}>${escapeHtml(fence.lines.join("\n"))}</code></pre>`,
        );
        fence = null;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (fenceMatch) {
      flushBlocks();
      fence = {
        info: fenceMatch[1]?.trim().replace(/\s+/g, "-") ?? "",
        lines: [],
      };
      continue;
    }

    if (!line.trim()) {
      flushBlocks();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/u);
    if (heading) {
      flushBlocks();
      const level = heading[1]?.length ?? 1;
      output.push(
        `<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`,
      );
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.+)$/u);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    if (unordered || ordered) {
      flushParagraph(paragraph, output);
      const nextOrdered = Boolean(ordered);
      if (listItems.length > 0 && listOrdered !== nextOrdered) {
        flushList(listItems, listOrdered, output);
      }
      listOrdered = nextOrdered;
      listItems.push((ordered?.[1] ?? unordered?.[1] ?? "").trim());
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/u);
    if (quote) {
      flushBlocks();
      output.push(
        `<blockquote>${renderInlineMarkdown(quote[1] ?? "")}</blockquote>`,
      );
      continue;
    }

    flushList(listItems, listOrdered, output);
    paragraph.push(line.trim());
  }

  if (fence) {
    output.push(
      `<pre><code${fence.info ? ` class="language-${escapeHtml(fence.info)}"` : ""}>${escapeHtml(fence.lines.join("\n"))}</code></pre>`,
    );
  }
  flushBlocks();
  return output.join("\n");
}
