import { expect, test } from "bun:test";
import {
  extractRenderedPageWithWebView,
  WEBVIEW_BODY_HTML_SCRIPT,
} from "./webview-page-extractor";

test("extractRenderedPageWithWebView navigates, extracts document.body.innerHTML, and converts it to markdown", async () => {
  const calls: string[] = [];

  const result = await extractRenderedPageWithWebView({
    createWebView: () => ({
      close() {
        calls.push("close");
      },
      evaluate(script) {
        calls.push(`evaluate:${script}`);
        return "<main>Hello <strong>WebView</strong></main>";
      },
      navigate(url) {
        calls.push(`navigate:${url}`);
      },
    }),
    readyDelayMs: 0,
    url: "https://example.com/article",
  });

  expect(calls).toEqual([
    "navigate:https://example.com/article",
    `evaluate:${WEBVIEW_BODY_HTML_SCRIPT}`,
    "close",
  ]);
  expect(result).toEqual({
    html: "<main>Hello <strong>WebView</strong></main>",
    htmlTruncated: false,
    markdown: "Hello **WebView**",
    markdownTruncated: false,
  });
});

test("extractRenderedPageWithWebView honors the configured readiness delay before reading the DOM", async () => {
  const calls: string[] = [];

  await extractRenderedPageWithWebView({
    createWebView: () => ({
      close() {
        calls.push("close");
      },
      evaluate(script) {
        calls.push(`evaluate:${script}`);
        return "<p>ready</p>";
      },
      navigate(url) {
        calls.push(`navigate:${url}`);
      },
    }),
    htmlToMarkdown: (html) => html,
    readyDelayMs: 37,
    sleep: async (delayMs) => {
      calls.push(`sleep:${delayMs}`);
    },
    url: "https://example.com/rendered",
  });

  expect(calls).toEqual([
    "navigate:https://example.com/rendered",
    "sleep:37",
    `evaluate:${WEBVIEW_BODY_HTML_SCRIPT}`,
    "close",
  ]);
});

test("extractRenderedPageWithWebView truncates oversized HTML and markdown payloads", async () => {
  const result = await extractRenderedPageWithWebView({
    createWebView: () => ({
      close() {},
      evaluate() {
        return "0123456789ABCDE";
      },
      navigate() {},
    }),
    htmlToMarkdown: (html) => `${html}-markdown`,
    maxHtmlChars: 10,
    maxMarkdownChars: 8,
    readyDelayMs: 0,
    url: "https://example.com/truncate",
  });

  expect(result).toEqual({
    html: "0123456789",
    htmlTruncated: true,
    markdown: "01234567",
    markdownTruncated: true,
  });
});

test("extractRenderedPageWithWebView closes the WebView when extraction fails", async () => {
  let closed = false;

  const extraction = extractRenderedPageWithWebView({
    createWebView: () => ({
      close() {
        closed = true;
      },
      evaluate() {
        throw new Error("boom");
      },
      navigate() {},
    }),
    readyDelayMs: 0,
    url: "https://example.com/failure",
  });

  await expect(extraction).rejects.toThrow("boom");
  expect(closed).toBeTrue();
});
