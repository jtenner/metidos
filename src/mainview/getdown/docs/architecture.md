# Architecture

The public API is:

```tsx
<GetDown content={markdown} />
```

Rendering can be customized at render time with per-node component props:

```tsx
<GetDown
  content={markdown}
  onLinkComponent={AppLink}
  onBoldComponent={AppBold}
  onCodeBlockComponent={AppCodeBlock}
  onTableComponent={AppTable}
/>
```

The parser does not execute or inject raw HTML. HTML-looking input is rendered as escaped text by default, which keeps the package appropriate for chat interfaces.

Internally, getdown is split into a pure parser core and a thin React renderer:

```txt
src/
  core/
    ast.ts       # immutable document/block/inline node types
    document.ts  # block parser + structural sharing between document versions
    inlines.ts   # inline parsing for text, escapes, entities, emphasis, breaks
  react/
    GetDown.tsx  # public component + memoized block rendering + renderer overrides
```

The performance invariant is that unchanged parsed blocks are reused by object
identity when `content` changes:

```ts
next.blocks[0] === previous.blocks[0]; // unchanged block
next.blocks[1] !== previous.blocks[1]; // changed block
```

`GetDown` stores the previous `ParsedDocument` in a ref, parses the new content
against it, and renders each block through `React.memo`. For streaming markdown,
this means appending to the final paragraph should only rerender that final block;
its key remains stable so React can patch the text node instead of replacing the
paragraph DOM element. Earlier blocks keep stable ids, stable object references,
and skip React render work.

New syntax should be added test-first by enabling a small set of fixture cases in
`src/getdown.test.tsx`, implementing the smallest parser/rendering slice, and
then expanding the enabled set.
