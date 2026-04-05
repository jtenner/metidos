import type { CSSProperties, JSX } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

const CODE_FONT_STACK =
  '"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const LINK_CLASS_NAME =
  "text-[#c6dae9] underline decoration-[#7aa5c4] underline-offset-2 transition-colors hover:text-[#e3edf5]";
const MAX_HIGHLIGHTED_CODE_BLOCK_CHARACTERS = 12_000;
const MAX_HIGHLIGHTED_CODE_BLOCK_LINES = 240;

const codeBlockStyle = {
  margin: 0,
  border: "1px solid rgba(153, 190, 217, 0.18)",
  borderRadius: "0.5rem",
  background: "#111213",
  padding: "0.875rem 1rem",
  fontSize: "0.8125rem",
  lineHeight: "1.6",
} satisfies CSSProperties;

const codeTagStyle = {
  fontFamily: CODE_FONT_STACK,
} satisfies CSSProperties;

function shouldSkipSyntaxHighlighting(code: string): boolean {
  if (code.length > MAX_HIGHLIGHTED_CODE_BLOCK_CHARACTERS) {
    return true;
  }

  return code.split("\n").length > MAX_HIGHLIGHTED_CODE_BLOCK_LINES;
}

const markdownComponents: Components = {
  a({ href, children, ...props }) {
    return (
      <a
        {...props}
        href={href}
        target="_blank"
        rel="noreferrer"
        className={LINK_CLASS_NAME}
      >
        {children}
      </a>
    );
  },
  code({ children, className, node: _node, ...props }) {
    const code = String(children).replace(/\n$/, "");
    const languageMatch = /language-([\w-]+)/.exec(className ?? "");
    const isBlockCode = Boolean(languageMatch) || code.includes("\n");

    if (isBlockCode) {
      if (shouldSkipSyntaxHighlighting(code)) {
        return (
          <div style={codeBlockStyle}>
            <code
              {...props}
              className={`block whitespace-pre-wrap break-words ${className ?? ""}`.trim()}
              style={codeTagStyle}
            >
              {code}
            </code>
          </div>
        );
      }

      return (
        <SyntaxHighlighter
          PreTag="div"
          language={languageMatch?.[1] ?? "text"}
          style={vscDarkPlus}
          customStyle={codeBlockStyle}
          codeTagProps={{ style: codeTagStyle }}
          wrapLongLines
        >
          {code}
        </SyntaxHighlighter>
      );
    }

    return (
      <code
        {...props}
        className={`bg-[#1d2022] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#e1ecf3] ${className ?? ""}`.trim()}
      >
        {children}
      </code>
    );
  },
  pre({ children }) {
    return <div className="my-3 overflow-x-auto">{children}</div>;
  },
  table({ children }) {
    return (
      <div className="my-3 overflow-x-auto">
        <table className="message-markdown-table">{children}</table>
      </div>
    );
  },
};

export function RichMarkdownMessage({ text }: { text: string }): JSX.Element {
  return (
    <div className="message-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
