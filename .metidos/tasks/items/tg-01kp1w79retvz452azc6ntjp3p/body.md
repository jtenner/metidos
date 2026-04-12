Capture the follow-up idea to use `Bun.WebView` itself as the browser-read path for navigation-heavy or JS-rendered pages.

## Scope

- navigate with `Bun.WebView`, then evaluate `document.body.innerHTML` to capture the rendered page DOM
- convert the extracted HTML with Turndown so downstream tools and models receive markdown-like content instead of raw HTML
- define when this browser-backed path should run instead of plain `fetch()` or simpler page-read logic
- note the practical concerns for a later implementation, including page readiness, script/style noise, large DOM truncation, and session reuse

## Acceptance

- the task preserves the concrete extraction approach: `WebView` navigation plus `document.body.innerHTML` plus Turndown conversion
- a later implementation can tell where this fits relative to provider-native web search, Ollama `web_fetch`, and other browser tools
- follow-up work has enough detail to implement the idea without rediscovering the original reasoning
