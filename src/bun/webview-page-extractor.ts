/**
 * @file src/bun/webview-page-extractor.ts
 * @description Prototype Bun.WebView page extraction for JS-rendered browser reads.
 */

import TurndownService from "turndown";

export const WEBVIEW_BODY_HTML_SCRIPT = "document.body.innerHTML";
export const DEFAULT_WEBVIEW_READY_DELAY_MS = 100;
export const DEFAULT_WEBVIEW_MAX_HTML_CHARS = 200_000;
export const DEFAULT_WEBVIEW_MAX_MARKDOWN_CHARS = 120_000;

export type BunWebViewLike = {
  close(): void;
  evaluate(script: string): Promise<unknown> | unknown;
  navigate(url: string): Promise<void> | void;
};

type BunWebViewConstructor = {
  new (): BunWebViewLike;
};

type BunWithWebView = typeof Bun & {
  WebView?: BunWebViewConstructor;
};

export type ExtractRenderedPageWithWebViewOptions = {
  createWebView?: () => BunWebViewLike;
  htmlToMarkdown?: (html: string) => string;
  maxHtmlChars?: number;
  maxMarkdownChars?: number;
  readyDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  url: string;
};

export type WebViewPageExtractionResult = {
  html: string;
  htmlTruncated: boolean;
  markdown: string;
  markdownTruncated: boolean;
};

function createDefaultHtmlToMarkdown(): (html: string) => string {
  const turndown = new TurndownService({
    codeBlockStyle: "fenced",
    headingStyle: "atx",
  });
  return (html) => turndown.turndown(html).trim();
}

function createRuntimeWebView(): BunWebViewLike {
  const webViewConstructor = (Bun as BunWithWebView).WebView;
  if (typeof webViewConstructor !== "function") {
    throw new Error("Bun.WebView is unavailable in this runtime.");
  }
  return new webViewConstructor();
}

function truncateText(
  value: string,
  maxChars: number,
): {
  text: string;
  truncated: boolean;
} {
  if (value.length <= maxChars) {
    return {
      text: value,
      truncated: false,
    };
  }
  return {
    text: value.slice(0, maxChars),
    truncated: true,
  };
}

export async function extractRenderedPageWithWebView(
  options: ExtractRenderedPageWithWebViewOptions,
): Promise<WebViewPageExtractionResult> {
  const createWebView = options.createWebView ?? createRuntimeWebView;
  const htmlToMarkdown =
    options.htmlToMarkdown ?? createDefaultHtmlToMarkdown();
  const sleep = options.sleep ?? ((delayMs: number) => Bun.sleep(delayMs));
  const readyDelayMs = options.readyDelayMs ?? DEFAULT_WEBVIEW_READY_DELAY_MS;
  const maxHtmlChars = options.maxHtmlChars ?? DEFAULT_WEBVIEW_MAX_HTML_CHARS;
  const maxMarkdownChars =
    options.maxMarkdownChars ?? DEFAULT_WEBVIEW_MAX_MARKDOWN_CHARS;
  const webView = createWebView();

  try {
    await Promise.resolve(webView.navigate(options.url));
    if (readyDelayMs > 0) {
      await sleep(readyDelayMs);
    }

    const extractedHtml = await Promise.resolve(
      webView.evaluate(WEBVIEW_BODY_HTML_SCRIPT),
    );
    if (typeof extractedHtml !== "string") {
      throw new Error(
        "Bun.WebView evaluate(document.body.innerHTML) must return a string.",
      );
    }

    const html = truncateText(extractedHtml, maxHtmlChars);
    const markdown = truncateText(htmlToMarkdown(html.text), maxMarkdownChars);
    return {
      html: html.text,
      htmlTruncated: html.truncated,
      markdown: markdown.text,
      markdownTruncated: markdown.truncated,
    };
  } finally {
    webView.close();
  }
}
