# getdown

A chat-safe React component API for rendering GitHub Flavored Markdown.

## API

```tsx
import { GetDown, type GetDownLinkProps } from "../getdown";

function AppLink({ href, title, children }: GetDownLinkProps) {
  return (
    <a className="app-link" href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function MarkdownView({ markdown }: { markdown: string }) {
  return <GetDown content={markdown} onLinkComponent={AppLink} />;
}
```

`content` is the complete GitHub Flavored Markdown string for the current render.

Renderer output can be customized with per-node component props such as `onLinkComponent`, `onBoldComponent`, `onInlineCodeComponent`, `onCodeBlockComponent`, `onTableComponent`, and `onTableCellComponent`.

Raw HTML is not injected. HTML-like markdown is rendered as escaped text by default, and link/image URLs are filtered with safe defaults. Use `onSanitizeLinkHref` and `onSanitizeImageSrc` to provide app-specific URL policy.

## Development

Run these from the repository root:

```bash
bun test src/mainview/getdown
bun run typecheck
bun run src/mainview/getdown/perf/baseline.tsx
```

Performance baselines live in `perf/baseline.tsx`. Use `bun run src/mainview/getdown/perf/baseline.tsx --save` to write a timestamped JSON snapshot under `perf/baselines/` for comparing streaming parser speed and GC pressure over time.
