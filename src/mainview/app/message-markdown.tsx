/**
 * @file src/mainview/app/message-markdown.tsx
 * @description Module for message markdown.
 */

import {
  GetDown,
  type GetDownCodeBlockProps,
  type GetDownImageProps,
  type GetDownInlineCodeProps,
  type GetDownLinkProps,
  type GetDownTableCellProps,
  type GetDownTableHeaderCellProps,
  type GetDownTableProps,
} from "../getdown";
import { AppButton } from "../controls/button";
import { useState, type JSX } from "react";
import { type Theme, useShikiHighlighter } from "react-shiki";
import { parseChatImageDataUrl } from "../../shared/chat-images";
import type { PreparedMessageRenderPlan } from "./message-preprocessing";

const LINK_CLASS_NAME =
  "text-text-secondary underline decoration-accent underline-offset-2 transition-colors hover:text-text-primary";
const HTTPS_ROOT_URL_WITH_TRAILING_SLASH_PATTERN = /^(https:\/\/[^/?#]+)\/$/;
const INLINE_CODE_CLASS_NAME =
  "bg-surface-2 px-2 py-1 font-mono text-[13px] text-text-secondary";
const CODE_BLOCK_CLASS_NAME = "message-markdown-code-block";
const CODE_BLOCK_THEME: Theme = {
  name: "metidos-dark",
  type: "dark",
  colors: {
    "editor.background": "var(--color-bg-canvas)",
    "editor.foreground": "var(--color-text-secondary)",
  },
  settings: [
    {
      settings: {
        foreground: "var(--color-text-secondary)",
      },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: {
        foreground: "var(--color-text-faint)",
        fontStyle: "italic",
      },
    },
    {
      scope: ["keyword", "storage", "storage.type", "support.type"],
      settings: {
        foreground: "var(--color-accent-strong)",
      },
    },
    {
      scope: ["entity.name.function", "support.function"],
      settings: {
        foreground: "var(--color-accent)",
      },
    },
    {
      scope: ["string", "constant.other.symbol"],
      settings: {
        foreground: "var(--color-success-text)",
      },
    },
    {
      scope: ["constant", "constant.numeric", "constant.language"],
      settings: {
        foreground: "var(--color-warning-text)",
      },
    },
    {
      scope: ["variable", "variable.parameter", "meta.definition.variable"],
      settings: {
        foreground: "var(--color-text-primary)",
      },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.class"],
      settings: {
        foreground: "var(--color-access-metidos)",
      },
    },
    {
      scope: ["invalid", "invalid.illegal"],
      settings: {
        foreground: "var(--color-danger-text)",
      },
    },
  ],
};

function codeFenceFor(code: string): string {
  let longestBacktickRun = 2;
  for (const match of code.matchAll(/`+/g)) {
    longestBacktickRun = Math.max(longestBacktickRun, match[0].length);
  }
  return "`".repeat(Math.max(3, longestBacktickRun + 1));
}

function fencedCodeBlockMarkdown({
  code,
  language,
}: {
  code: string;
  language: string | null;
}): string {
  const fence = codeFenceFor(code);
  return `${fence}${language ?? ""}\n${code}\n${fence}`;
}

function sanitizeExternalHttpUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }

    return parsed.href.replace(
      HTTPS_ROOT_URL_WITH_TRAILING_SLASH_PATTERN,
      "$1",
    );
  } catch {
    return undefined;
  }
}

function MarkdownLink({
  href,
  title,
  children,
}: GetDownLinkProps): JSX.Element {
  return (
    <a
      href={href}
      title={title}
      target={href ? "_blank" : undefined}
      rel={href ? "noopener noreferrer" : undefined}
      className={LINK_CLASS_NAME}
    >
      {children}
    </a>
  );
}

function MarkdownInlineCode({ value }: GetDownInlineCodeProps): JSX.Element {
  return <code className={INLINE_CODE_CLASS_NAME}>{value}</code>;
}

function MarkdownCodeBlock({
  code,
  language,
}: GetDownCodeBlockProps): JSX.Element {
  const highlightedCode = useShikiHighlighter(
    code,
    language ?? "text",
    CODE_BLOCK_THEME,
    {
      defaultColor: "dark",
      structure: "inline",
    },
  );

  return (
    <pre
      className={
        language
          ? `${CODE_BLOCK_CLASS_NAME} language-${language}`
          : CODE_BLOCK_CLASS_NAME
      }
    >
      <code>{highlightedCode ?? code}</code>
    </pre>
  );
}

function MarkdownTable({ children }: GetDownTableProps): JSX.Element {
  return (
    <div className="my-3 overflow-x-auto">
      <table className="message-markdown-table">{children}</table>
    </div>
  );
}

function MarkdownTableCell({
  align,
  children,
}: GetDownTableCellProps): JSX.Element {
  return <td align={align}>{children}</td>;
}

function MarkdownTableHeaderCell({
  align,
  children,
}: GetDownTableHeaderCellProps): JSX.Element {
  return <th align={align}>{children}</th>;
}

function blockedImageHostname(src: string): string {
  try {
    return new URL(src).hostname || "external image";
  } catch {
    return "external image";
  }
}

function trustedMarkdownImageSrc(src: string):
  | {
      kind: "embedded";
      label: string;
      openHref?: undefined;
      src: string;
    }
  | { kind: "remote"; label: string; openHref: string; src: string }
  | null {
  const remoteSrc = sanitizeExternalHttpUrl(src);
  if (remoteSrc) {
    return {
      kind: "remote",
      label: blockedImageHostname(remoteSrc),
      openHref: remoteSrc,
      src: remoteSrc,
    };
  }

  const embeddedImage = parseChatImageDataUrl(src);
  if (!("error" in embeddedImage)) {
    return {
      kind: "embedded",
      label: "embedded generated image",
      src: embeddedImage.src,
    };
  }

  return null;
}

function blockRemoteMarkdownImageSrc(_src: string): string | undefined {
  return undefined;
}

function MarkdownImage({ alt, node, title }: GetDownImageProps): JSX.Element {
  const [loaded, setLoaded] = useState(false);
  const trustedSrc = trustedMarkdownImageSrc(node.src);
  if (!loaded || !trustedSrc) {
    const sourceLabel = trustedSrc?.label ?? blockedImageHostname(node.src);
    const blockedPrefix =
      trustedSrc?.kind === "embedded" ? "Embedded" : "External";
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-2 border border-border-subtle bg-surface-1 px-2 py-1 text-[12px] text-text-secondary">
        <span className="min-w-0 truncate">
          {blockedPrefix} image blocked:{" "}
          <code className="font-mono">{sourceLabel}</code>
          {alt ? ` — ${alt}` : ""}
        </span>
        {trustedSrc ? (
          <>
            <AppButton
              aria-label={`Load image from ${sourceLabel}`}
              unstyled={true}
              className="text-accent underline decoration-accent underline-offset-2 transition-colors hover:text-text-primary"
              onClick={() => setLoaded(true)}
            >
              Load image
            </AppButton>
            {trustedSrc.openHref ? (
              <a
                href={trustedSrc.openHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline decoration-accent underline-offset-2 transition-colors hover:text-text-primary"
              >
                Open image
              </a>
            ) : null}
          </>
        ) : null}
      </span>
    );
  }

  return (
    <img
      src={trustedSrc.src}
      alt={alt}
      title={title}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

const getdownRendererProps = {
  onCodeBlockComponent: MarkdownCodeBlock,
  onImageComponent: MarkdownImage,
  onInlineCodeComponent: MarkdownInlineCode,
  onLinkComponent: MarkdownLink,
  onSanitizeImageSrc: blockRemoteMarkdownImageSrc,
  onSanitizeLinkHref: sanitizeExternalHttpUrl,
  onTableCellComponent: MarkdownTableCell,
  onTableComponent: MarkdownTable,
  onTableHeaderCellComponent: MarkdownTableHeaderCell,
} as const;

/**
 * Render raw text as markdown with GitHub-flavored markdown support.
 * @param text - Input markdown text.
 */
export function RichMarkdownMessage({
  streaming = false,
  text,
}: {
  streaming?: boolean;
  text: string;
}): JSX.Element {
  void streaming;
  return (
    <div className="message-markdown">
      <GetDown content={text} {...getdownRendererProps} />
    </div>
  );
}

/**
 * Render pre-segmented plan output from message preprocessing.
 * @param plan - Prepared message render plan.
 */
export function PreparedRichMarkdownMessage({
  plan,
}: {
  plan: Extract<PreparedMessageRenderPlan, { kind: "rich" }>;
}): JSX.Element {
  return (
    <div className="message-markdown">
      {plan.blocks.map((block) => (
        <GetDown
          key={block.key}
          content={
            block.kind === "markdown"
              ? block.text
              : fencedCodeBlockMarkdown(block)
          }
          {...getdownRendererProps}
        />
      ))}
    </div>
  );
}
