/**
 * @file src/mainview/app/message-markdown-routing.ts
 * @description Module for message markdown routing.
 */

export type PlainTextMessageSegment =
  | {
      kind: "text";
      key: string;
      text: string;
    }
  | {
      href: string;
      kind: "link";
      key: string;
      text: string;
    };

const BARE_URL_PATTERN =
  /\bhttps?:\/\/[^\s<>"'`{}|\\^[\]]*[^\s<>"'`{}|\\^.[\],!?;:()[\]]/g;

const RICH_MARKDOWN_PATTERN =
  /```|(^|\n)\s{0,3}#{1,6}\s+|(^|\n)\s{0,3}>\s+|(^|\n)\s{0,3}(?:[-*+]|\d+\.)\s+|(^|\n)\s{0,3}(?:[-*+])\s+\[[ xX]\]\s+|(^|\n)\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*(\n|$)|(^|\n).*\|.*\n.*\||!\[[^\]]+\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~/;

/**
 * Keep ordinary chat bubbles on a lightweight text path until richer markdown
 * features actually appear in the message payload.
 */
export function shouldUseRichMarkdownRenderer(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  return RICH_MARKDOWN_PATTERN.test(text);
}

/**
 * Split plain text into text and bare-URL segments so the lightweight fallback
 * can preserve clickable links without paying the markdown parser cost.
 */
export function splitPlainTextMessage(text: string): PlainTextMessageSegment[] {
  if (!text.includes("http")) {
    return [{ kind: "text", key: "0:0", text }];
  }

  const segments: PlainTextMessageSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(BARE_URL_PATTERN)) {
    if (match.index === undefined) {
      continue;
    }

    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        key: `${lastIndex}:${match.index}`,
        text: text.slice(lastIndex, match.index),
      });
    }

    segments.push({
      href: match[0],
      kind: "link",
      key: `${match.index}:${match.index + match[0].length}`,
      text: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      kind: "text",
      key: `${lastIndex}:${text.length}`,
      text: text.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ kind: "text", key: "0:0", text }];
}
