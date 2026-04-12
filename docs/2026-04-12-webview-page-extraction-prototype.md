# Design: WebView-Backed Page Extraction Prototype

Date: 2026-04-12  
Repository: `metidos`

## Summary

- Metidos already has two current-information paths in the Pi runtime:
  - provider-native web search for supported OpenAI/xAI models
  - Ollama-backed `web_search` / `web_fetch` tools for other runtimes
- Those paths are useful, but they still depend on fetch-oriented page retrieval and do not guarantee access to the final DOM of JS-rendered pages.
- A local Bun 1.3.12 probe in this repo confirmed that `Bun.WebView` is available and exposes the methods needed for a browser-backed read path, including `navigate()`, `evaluate()`, and `screenshot()`.
- A minimal prototype helper now exists at [src/bun/webview-page-extractor.ts](../src/bun/webview-page-extractor.ts). It follows the intended shape directly:
  - navigate with `Bun.WebView`
  - read `document.body.innerHTML`
  - convert the extracted HTML to markdown-like text with `turndown`
  - cap large payloads so browser reads stay bounded
- This should remain a fallback path for navigation-heavy or JS-rendered pages, not a replacement for provider-native web search or Ollama `web_fetch`.

## Problem

Metidos's current web tooling is strongest when:

- the provider offers first-party web search
- Ollama's web endpoints can fetch and summarize a page directly
- the target page is mostly server-rendered and readable through ordinary HTTP fetch

It is weaker when the page body is assembled after navigation by client-side JavaScript.

That gap matters for:

- pages that render article content after hydration
- flows where browser state or page navigation determines what content appears
- future browser-navigation tools that already have a rendered page open and need a "read the current page" operation

The missing capability is not search. It is browser-backed DOM extraction.

## Current State

Existing runtime wiring lives in:

- [src/bun/pi-native-web-search.ts](../src/bun/pi-native-web-search.ts)
- [src/bun/pi-ollama-web-search.ts](../src/bun/pi-ollama-web-search.ts)
- [src/bun/pi-thread-runtime.ts](../src/bun/pi-thread-runtime.ts)

Current behavior:

- supported OpenAI/xAI models use provider-native web search
- other web-enabled runtimes install Ollama `web_search` and `web_fetch`
- no Metidos-owned helper currently reads the rendered DOM from a browser surface

The new helper is intentionally still a prototype:

- it is implemented and tested
- it is not wired into a runtime tool yet
- it defines the extraction contract a later integration can reuse

## Prototype Shape

The prototype helper is [src/bun/webview-page-extractor.ts](../src/bun/webview-page-extractor.ts), with focused coverage in [src/bun/webview-page-extractor.test.ts](../src/bun/webview-page-extractor.test.ts).

The contract is intentionally small:

```ts
const result = await extractRenderedPageWithWebView({
  url,
  readyDelayMs: 100,
});
```

Internally it does exactly this:

1. create a `Bun.WebView`
2. `navigate(url)`
3. optionally wait a small readiness delay
4. `evaluate("document.body.innerHTML")`
5. convert the HTML to markdown-like text with `turndown`
6. truncate oversized HTML or markdown payloads
7. always `close()` the WebView

That keeps the core extraction path explicit instead of hiding it behind a larger browser framework too early.

## Local Runtime Probes

Two local probes were run in this repo on Bun `1.3.12`.

### Probe 1: basic HTML extraction works

This script succeeded:

```ts
const webview = new Bun.WebView();
await webview.navigate(
  "data:text/html,<html><body><main>Hello <strong>WebView</strong></main></body></html>",
);
const html = await webview.evaluate("document.body.innerHTML");
webview.close();
```

Observed result:

```json
{
  "html": "<main>Hello <strong>WebView</strong></main>"
}
```

### Probe 2: JS-rendered pages need readiness handling

This probe navigated to a page that rewrote the DOM after a short timeout.

Observed results:

```json
{
  "immediate": "<div id=\"root\">Loading</div><script>setTimeout(()=>{document.body.innerHTML='<main>Rendered later</main>';},50)</script>",
  "delayed": "<main>Rendered later</main>"
}
```

That confirms a later integration cannot assume `navigate()` alone means the page body is ready for extraction.

## When To Use The WebView Path

Prefer the WebView-backed path when:

- a plain fetch-style read returns mostly shell HTML, placeholders, or script tags
- the page content appears only after client-side rendering
- the runtime already opened the page in a browser-oriented workflow and needs the rendered body
- session/cookie state inside the browser context matters to what the page shows

Do not prefer it when:

- provider-native web search can answer the question directly with fresher citations
- Ollama `web_fetch` already returns a good page read
- the page is static and fetch-readable
- the caller needs high-throughput bulk retrieval rather than one deliberate browser read

## Practical Concerns For Later Integration

### Readiness

The prototype uses a fixed `readyDelayMs` option because it is simple and testable, but a production integration should probably add a better wait strategy such as:

- polling for stable body text length
- waiting for a caller-supplied readiness predicate
- reusing a browser-navigation tool's existing page-ready signal

### HTML noise

The prototype deliberately extracts raw `document.body.innerHTML` first and converts that result with Turndown. A later integration may want a cleanup pass for:

- `script`
- `style`
- `noscript`
- repeated nav/footer boilerplate

### Truncation and budgets

The helper already caps both HTML and markdown output, but a tool-facing integration still needs explicit policy for:

- maximum DOM size
- maximum markdown size
- timeout budgets for slow pages
- whether screenshots and DOM extraction share one budget

### Session reuse

The prototype creates one `Bun.WebView` per extraction. That keeps the contract simple, but a browser-navigation integration may want to reuse an existing WebView so page reads can inherit:

- cookies
- login state
- current tab URL
- already-completed navigation

## Recommended Integration Point

The likely progression is:

1. keep provider-native web search as the first choice for "find current information"
2. keep Ollama `web_fetch` as the light-weight fetch-based page reader
3. add a browser-backed read path only for cases where rendered DOM matters

That keeps the expensive browser path exceptional and measurable.

## Files Added In This Slice

- [src/bun/webview-page-extractor.ts](../src/bun/webview-page-extractor.ts)
- [src/bun/webview-page-extractor.test.ts](../src/bun/webview-page-extractor.test.ts)
- [docs/2026-04-12-webview-page-extraction-prototype.md](./2026-04-12-webview-page-extraction-prototype.md)
