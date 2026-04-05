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
const FENCED_CODE_BLOCK_PATTERN = /^\s*```([\w-]+)?\s*$/;
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
 * Function of shouldWorkerizeMessagePreprocessing.
 * @param text - The value of `text`.
 */

export function shouldWorkerizeMessagePreprocessing(text: string): boolean {
  return text.length >= LARGE_MARKDOWN_PREPROCESS_TEXT_LENGTH;
}
/**
 * Function of shouldSkipSyntaxHighlighting.
 * @param code - The value of `code`.
 */

export function shouldSkipSyntaxHighlighting(code: string): boolean {
  if (code.length > MAX_HIGHLIGHTED_CODE_BLOCK_CHARACTERS) {
    return true;
  }

  return code.split("\n").length > MAX_HIGHLIGHTED_CODE_BLOCK_LINES;
}
/**
 * Function of splitMarkdownTextForPreparedRendering.
 * @param text - The value of `text`.
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
 * Function of pushPreparedMarkdownBlocks.
 * @param blocks - The value of `blocks`.
 * @param text - The value of `text`.
 * @param startIndex - The value of `startIndex`.
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
/**
 * Function of prepareRichMarkdownBlocks.
 * @param text - The value of `text`.
 */

function prepareRichMarkdownBlocks(text: string): PreparedRichMarkdownBlock[] {
  const blocks: PreparedRichMarkdownBlock[] = [];
  const lines = text.split(/\r?\n/);
  const markdownLines: string[] = [];
  const codeLines: string[] = [];
  let blockIndex = 0;
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
    blocks.push({
      code: codeLines.join("\n"),
      key: `code:${blockIndex}`,
      kind: "code",
      language: activeCodeLanguage,
      shouldHighlight: !shouldSkipSyntaxHighlighting(codeLines.join("\n")),
    });
    blockIndex += 1;
    codeLines.length = 0;
    activeCodeLanguage = null;
  };

  for (const line of lines) {
    const fenceMatch = FENCED_CODE_BLOCK_PATTERN.exec(line);

    if (!inCodeBlock && fenceMatch) {
      flushMarkdown();
      inCodeBlock = true;
      activeCodeLanguage = fenceMatch[1]?.trim() || null;
      continue;
    }

    if (inCodeBlock && fenceMatch) {
      flushCode();
      inCodeBlock = false;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    markdownLines.push(line);
  }

  if (inCodeBlock) {
    markdownLines.push(
      `\`\`\`${activeCodeLanguage ? activeCodeLanguage : ""}`.trimEnd(),
    );
    markdownLines.push(...codeLines);
  }

  flushMarkdown();
  return blocks;
}
/**
 * Function of prepareMessageRenderPlan.
 * @param text - The value of `text`.
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
