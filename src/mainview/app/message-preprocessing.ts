/**
 * @file src/mainview/app/message-preprocessing.ts
 * @description Module for message preprocessing.
 */

import {
  type PlainTextMessageSegment,
  shouldUseRichMarkdownRenderer,
  splitPlainTextMessage,
} from "./message-markdown-routing";

export const LARGE_MARKDOWN_PREPROCESS_TEXT_LENGTH = 18_000;
const OPENING_FENCED_CODE_BLOCK_PATTERN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const MAX_HIGHLIGHTED_CODE_BLOCK_CHARACTERS = 12_000;
const MAX_HIGHLIGHTED_CODE_BLOCK_LINES = 240;
const MAX_PREPARED_MARKDOWN_BLOCK_CHARACTERS = 4_000;

export type PreparedRichMarkdownBlock =
  | {
      key: string;
      kind: "code";
      code: string;
      language: string | null;
      shouldHighlight: boolean;
    }
  | {
      key: string;
      kind: "markdown";
      text: string;
    };

export type PreparedMessageRenderPlan =
  | {
      kind: "plain";
      segments: PlainTextMessageSegment[];
    }
  | {
      blocks: PreparedRichMarkdownBlock[];
      kind: "rich";
    };
/**
 * Decide if preprocessing should run in a worker for long messages.
 * @param text - Message text.
 */

export function shouldWorkerizeMessagePreprocessing(text: string): boolean {
  return text.length >= LARGE_MARKDOWN_PREPROCESS_TEXT_LENGTH;
}
/**
 * Decide whether a code block is too large for inline highlighting.
 * @param code - Full code block text.
 */

function exceedsLineLimit(text: string, maxLines: number): boolean {
  let lines = 1;

  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1;

      if (lines > maxLines) {
        return true;
      }
    }
  }

  return false;
}

export function shouldSkipSyntaxHighlighting(code: string): boolean {
  if (code.length > MAX_HIGHLIGHTED_CODE_BLOCK_CHARACTERS) {
    return true;
  }

  return exceedsLineLimit(code, MAX_HIGHLIGHTED_CODE_BLOCK_LINES);
}
/**
 * Split very large markdown text into bounded chunks.
 * @param text - Markdown text to split.
 */

function splitMarkdownTextForPreparedRendering(text: string): string[] {
  if (text.length <= MAX_PREPARED_MARKDOWN_BLOCK_CHARACTERS) {
    return [text];
  }

  const tokens = text.split(/(\n{2,})/);
  const chunks: string[] = [];
  let currentChunk = "";

  for (const token of tokens) {
    if (!token) {
      continue;
    }

    if (
      currentChunk &&
      currentChunk.length + token.length >
        MAX_PREPARED_MARKDOWN_BLOCK_CHARACTERS
    ) {
      chunks.push(currentChunk);
      currentChunk = token.startsWith("\n") ? "" : token;
      continue;
    }

    currentChunk += token;
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [text];
}
/**
 * Append markdown chunks into blocks with stable keys.
 * @param blocks - Output block collection to mutate.
 * @param text - Markdown text segment.
 * @param startIndex - Next key index.
 */

function pushPreparedMarkdownBlocks(
  blocks: PreparedRichMarkdownBlock[],
  text: string,
  startIndex: number,
): number {
  let nextIndex = startIndex;

  for (const chunk of splitMarkdownTextForPreparedRendering(text)) {
    if (!chunk.trim()) {
      continue;
    }

    blocks.push({
      key: `markdown:${nextIndex}`,
      kind: "markdown",
      text: chunk,
    });
    nextIndex += 1;
  }

  return nextIndex;
}

type FencedCodeBlockOpener = {
  fence: string;
  language: string | null;
};

function parseFencedCodeBlockOpener(
  line: string,
): FencedCodeBlockOpener | null {
  const match = OPENING_FENCED_CODE_BLOCK_PATTERN.exec(line);
  const fence = match?.[2];
  const fenceCharacter = fence?.[0];
  if (!fence || !fenceCharacter) {
    return null;
  }

  const info = match[3]?.trim() ?? "";
  if (fenceCharacter === "`" && info.includes("`")) {
    return null;
  }

  const [language] = info.split(/\s+/, 1);
  return {
    fence,
    language: language || null,
  };
}

function isClosingFencedCodeBlock(line: string, openingFence: string): boolean {
  const fenceCharacter = openingFence[0];
  if (!fenceCharacter) {
    return false;
  }

  const match = /^( {0,3})(`{3,}|~{3,})([ \t]*)$/.exec(line);
  const marker = match?.[2];
  return Boolean(
    marker &&
      marker[0] === fenceCharacter &&
      marker.length >= openingFence.length,
  );
}
/**
 * Parse markdown into alternating markdown and code blocks.
 * @param text - Raw markdown message text.
 */

function prepareRichMarkdownBlocks(text: string): PreparedRichMarkdownBlock[] {
  const blocks: PreparedRichMarkdownBlock[] = [];
  const lines = text.split(/\r?\n/);
  const markdownLines: string[] = [];
  const codeLines: string[] = [];
  let blockIndex = 0;
  let activeCodeFence: string | null = null;
  let activeCodeLanguage: string | null = null;
  let inCodeBlock = false;

  const flushMarkdown = (): void => {
    if (markdownLines.length === 0) {
      return;
    }

    blockIndex = pushPreparedMarkdownBlocks(
      blocks,
      markdownLines.join("\n"),
      blockIndex,
    );
    markdownLines.length = 0;
  };

  const flushCode = (): void => {
    const code = codeLines.join("\n");

    blocks.push({
      code,
      key: `code:${blockIndex}`,
      kind: "code",
      language: activeCodeLanguage,
      shouldHighlight: !shouldSkipSyntaxHighlighting(code),
    });
    blockIndex += 1;
    codeLines.length = 0;
    activeCodeLanguage = null;
  };

  for (const line of lines) {
    if (!inCodeBlock) {
      const opener = parseFencedCodeBlockOpener(line);
      if (opener) {
        flushMarkdown();
        inCodeBlock = true;
        activeCodeFence = opener.fence;
        activeCodeLanguage = opener.language;
        continue;
      }
    }

    if (
      inCodeBlock &&
      activeCodeFence &&
      isClosingFencedCodeBlock(line, activeCodeFence)
    ) {
      flushCode();
      inCodeBlock = false;
      activeCodeFence = null;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    markdownLines.push(line);
  }

  if (inCodeBlock) {
    const language = activeCodeLanguage ? activeCodeLanguage : "";
    markdownLines.push(`${activeCodeFence ?? "```"}${language}`.trimEnd());
    markdownLines.push(...codeLines);
  }

  flushMarkdown();
  return blocks;
}
/**
 * Build a render plan that toggles between plain and rich rendering.
 * @param text - Message text to normalize.
 */

export function prepareMessageRenderPlan(
  text: string,
): PreparedMessageRenderPlan {
  if (!shouldUseRichMarkdownRenderer(text)) {
    return {
      kind: "plain",
      segments: splitPlainTextMessage(text),
    };
  }

  return {
    blocks: prepareRichMarkdownBlocks(text),
    kind: "rich",
  };
}
