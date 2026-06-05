import type {
  BlockQuoteBlock,
  CodeBlock,
  HeadingBlock,
  ListBlock,
  MarkdownBlockNode,
  ParagraphBlock,
  ParsedDocument,
  TableBlock,
  TableCell,
  ThematicBreakBlock,
} from "./ast";
import { hasUnclosedCodeSpan, normalizeReferenceLabel, parseInlines, type LinkReferenceDefinition } from "./inlines";

interface SourceLine {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

interface ReuseIndex {
  readonly blocks: readonly MarkdownBlockNode[];
  cursor: number;
  byFingerprint?: Map<string, MarkdownBlockNode[]>;
}

type LinkReferenceDefinitions = ReadonlyMap<string, LinkReferenceDefinition>;

const emptyLinkReferenceDefinitions: LinkReferenceDefinitions = new Map();
const MAX_BLOCKQUOTE_NESTING = 256;

export function parseDocument(content: string, previous?: ParsedDocument | null): ParsedDocument {
  return parseDocumentInternal(content, previous, 0);
}

function parseDocumentInternal(
  content: string,
  previous: ParsedDocument | null | undefined,
  blockquoteNestingDepth: number,
): ParsedDocument {
  const normalized = normalizeSource(content);
  if (previous?.content === normalized) return previous;

  const reuse = previous ? buildReuseIndex(previous) : null;
  const lines = splitLines(normalized);
  const references = normalized.includes("]:") ? collectLinkReferenceDefinitions(lines) : emptyLinkReferenceDefinitions;
  const mayHaveReferenceDefinitions = references !== emptyLinkReferenceDefinitions;
  const blocks: MarkdownBlockNode[] = [];

  let lineIndex = 0;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex]!;
    if (isBlank(line.text)) {
      lineIndex += 1;
      continue;
    }

    if (mayHaveReferenceDefinitions && parseLinkReferenceDefinitionLine(line.text)) {
      lineIndex += 1;
      continue;
    }

    const blockQuote = parseBlockQuote(lines, lineIndex, reuse, blockquoteNestingDepth);
    if (blockQuote) {
      blocks.push(blockQuote.block);
      lineIndex = blockQuote.nextLine;
      continue;
    }

    const fencedCode = parseFencedCode(lines, lineIndex, reuse);
    if (fencedCode) {
      blocks.push(fencedCode.block);
      lineIndex = fencedCode.nextLine;
      continue;
    }

    const indentedCode = parseIndentedCode(lines, lineIndex, reuse);
    if (indentedCode) {
      blocks.push(indentedCode.block);
      lineIndex = indentedCode.nextLine;
      continue;
    }

    const thematicBreak = parseThematicBreak(line, reuse);
    if (thematicBreak) {
      blocks.push(thematicBreak);
      lineIndex += 1;
      continue;
    }

    const table = parseTable(lines, lineIndex, reuse, references);
    if (table) {
      blocks.push(table.block);
      lineIndex = table.nextLine;
      continue;
    }

    const list = parseList(lines, lineIndex, reuse, references);
    if (list) {
      blocks.push(list.block);
      lineIndex = list.nextLine;
      continue;
    }

    const atxHeading = parseAtxHeading(line, reuse, references);
    if (atxHeading) {
      blocks.push(atxHeading);
      lineIndex += 1;
      continue;
    }

    const paragraph = parseParagraph(lines, lineIndex, reuse, references);
    if (paragraph) {
      blocks.push(paragraph.block);
      lineIndex = paragraph.nextLine;
      continue;
    }

    lineIndex += 1;
  }

  return { content: normalized, blocks };
}

function parseBlockQuote(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  blockquoteNestingDepth: number,
): { block: BlockQuoteBlock; nextLine: number } | null {
  if (!isBlockQuoteLine(lines[startLine]!.text)) return null;

  const parts: string[] = [];
  let nextLine = startLine;
  let end = lines[startLine]!.end;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    if (isBlockQuoteLine(line.text)) {
      parts.push(stripBlockQuoteMarker(line.text));
      end = line.end;
      nextLine += 1;
      continue;
    }

    if (!isBlank(line.text)) {
      parts.push(stripUpToThreeSpaces(line.text));
      end = line.end;
      nextLine += 1;
      continue;
    }

    break;
  }

  const sequential = consumeSequentialReusableBlockFromLines<BlockQuoteBlock>("blockquote", lines[startLine]!.start, lines, startLine, nextLine, reuse);
  if (sequential) return { block: sequential, nextLine };
  const raw = sourceSlice(lines, startLine, nextLine);
  const reusable = consumeReusableBlock<BlockQuoteBlock>("blockquote", lines[startLine]!.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine };
  const childContent = parts.join("\n").trim() === "" ? "" : parts.join("\n");
  const childBlocks =
    blockquoteNestingDepth >= MAX_BLOCKQUOTE_NESTING
      ? parseCappedBlockQuoteChildren(childContent, lines[startLine]!.start, raw)
      : parseDocumentInternal(
          childContent,
          null,
          blockquoteNestingDepth + 1,
        ).blocks;
  const block: BlockQuoteBlock = {
    id: blockId("blockquote", lines[startLine]!.start, raw),
    kind: "blockquote",
    raw,
    start: lines[startLine]!.start,
    end,
    blocks: childBlocks,
  };
  return { block: reuseBlock(block, reuse), nextLine };
}

function parseCappedBlockQuoteChildren(
  childContent: string,
  start: number,
  raw: string,
): readonly MarkdownBlockNode[] {
  const text = normalizeParagraphText(childContent);
  if (text.length === 0) {
    return [];
  }

  const paragraph: ParagraphBlock = {
    id: blockId("paragraph", start, raw),
    kind: "paragraph",
    raw: childContent,
    start,
    end: start + raw.length,
    text,
    children: parseInlines(text, emptyLinkReferenceDefinitions),
  };
  return [paragraph];
}

function isBlockQuoteLine(line: string): boolean {
  return line[skipUpToThreeSpacesIndex(line)] === ">";
}

function stripBlockQuoteMarker(line: string): string {
  let index = skipUpToThreeSpacesIndex(line);
  if (line[index] === ">") index += 1;
  if (line[index] === " ") index += 1;
  return line.slice(index);
}

function parseFencedCode(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
): { block: CodeBlock; nextLine: number } | null {
  const first = lines[startLine]!;
  const opener = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(first.text);
  if (!opener) return null;

  const indent = opener[1]!.length;
  const marker = opener[2]!;
  const fence = marker[0]!;
  const info = opener[3]!.trim();
  if (fence === "`" && info.includes("`")) return null;
  if (startLine === lines.length - 1 && info === "") return null;

  const parts: string[] = [];
  let nextLine = startLine + 1;
  let end = first.end;
  let closed = false;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    if (isClosingCodeFence(line.text, fence, marker.length)) {
      end = line.end;
      nextLine += 1;
      closed = true;
      break;
    }
    parts.push(stripCodeFenceIndent(line.text, indent));
    end = line.end;
    nextLine += 1;
  }

  const rawEndLine = closed ? nextLine : lines.length;
  const sequential = consumeSequentialReusableBlockFromLines<CodeBlock>("code", first.start, lines, startLine, rawEndLine, reuse);
  if (sequential) return { block: sequential, nextLine };
  const raw = sourceSlice(lines, startLine, rawEndLine);
  const reusable = consumeReusableBlock<CodeBlock>("code", first.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine };
  const language = info === "" ? undefined : info.split(/\s+/)[0];
  const text = parts.length === 0 ? "" : `${parts.join("\n")}\n`;
  const block: CodeBlock = {
    id: blockId("code", first.start, raw),
    kind: "code",
    raw,
    start: first.start,
    end,
    text,
    ...(language ? { language } : null),
  };
  return { block: reuseBlock(block, reuse), nextLine };
}

function collectLinkReferenceDefinitions(lines: readonly SourceLine[]): LinkReferenceDefinitions {
  const definitions = new Map<string, LinkReferenceDefinition>();
  for (const line of lines) {
    if (!line.text.includes("]:")) continue;
    const parsed = parseLinkReferenceDefinitionLine(line.text);
    if (!parsed) continue;
    const label = normalizeReferenceLabel(parsed.label);
    if (label && !definitions.has(label)) definitions.set(label, parsed.definition);
  }
  return definitions;
}

function parseLinkReferenceDefinitionLine(
  line: string,
): { label: string; definition: LinkReferenceDefinition } | null {
  const match = /^ {0,3}\[([^\]]+)\]:[ \t]*(.*)$/.exec(line);
  if (!match) return null;
  const body = parseLinkReferenceDefinitionBody(match[2] ?? "");
  return body ? { label: match[1]!, definition: body } : null;
}

function parseLinkReferenceDefinitionBody(body: string): LinkReferenceDefinition | null {
  const trimmed = body.trim();
  if (trimmed === "") return null;

  if (trimmed.startsWith("<")) {
    const close = trimmed.indexOf(">", 1);
    if (close === -1) return null;
    const href = trimmed.slice(1, close);
    const title = parseReferenceTitle(trimmed.slice(close + 1).trim());
    return title === null ? { href } : { href, title };
  }

  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (!match) return null;
  const href = match[1]!.replace(/\\([()])/g, "$1");
  const title = parseReferenceTitle(match[2]?.trim() ?? "");
  return title === null ? { href } : { href, title };
}

function parseReferenceTitle(raw: string): string | null {
  if (raw === "") return null;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith("(") && raw.endsWith(")"))
  ) {
    return raw.slice(1, -1);
  }
  return null;
}

function parseIndentedCode(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
): { block: CodeBlock; nextLine: number } | null {
  const first = lines[startLine]!;
  if (!isIndentedCodeLine(first.text)) return null;

  const parts: string[] = [];
  let nextLine = startLine;
  let end = first.end;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    if (!isBlank(line.text) && !isIndentedCodeLine(line.text)) break;
    parts.push(stripCodeIndent(line.text));
    end = line.end;
    nextLine += 1;
  }

  const sequential = consumeSequentialReusableBlockFromLines<CodeBlock>("code", first.start, lines, startLine, nextLine, reuse);
  if (sequential) return { block: sequential, nextLine };
  const raw = sourceSlice(lines, startLine, nextLine);
  const reusable = consumeReusableBlock<CodeBlock>("code", first.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine };
  const text = trimTrailingBlankCodeLines(parts).join("\n") + "\n";
  const id = blockId("code", first.start, raw);
  const block: CodeBlock = { id, kind: "code", raw, start: first.start, end, text };
  return { block: reuseBlock(block, reuse), nextLine };
}

interface ParsedListMarker {
  readonly indent: number;
  readonly ordered: boolean;
  readonly marker: string;
  readonly number?: number;
  readonly text: string;
}

interface MutableListItem {
  text: string;
  children: readonly import("./ast").InlineNode[];
  task?: "checked" | "unchecked";
  blocks?: MarkdownBlockNode[];
}

function parseList(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  references: LinkReferenceDefinitions,
): { block: ListBlock; nextLine: number } | null {
  const parsed = parseListAt(lines, startLine, reuse, references);
  return parsed ? { block: parsed.block, nextLine: parsed.nextLine } : null;
}

function parseListAt(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  references: LinkReferenceDefinitions,
): { block: ListBlock; nextLine: number; end: number } | null {
  const firstMarker = parseListMarker(lines[startLine]!.text);
  if (!firstMarker) return null;

  const reusableList = consumeSequentialReusableBlockPrefix<ListBlock>("list", lines[startLine]!.start, lines, startLine, reuse, (next) =>
    !next || isBlank(next.text),
  );
  if (reusableList) return { block: reusableList.block, nextLine: reusableList.nextLine, end: reusableList.block.end };

  const items: MutableListItem[] = [];
  let nextLine = startLine;
  let end = lines[startLine]!.end;
  let loose = false;
  let pendingBlank = false;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    const marker = parseListMarker(line.text);

    if (marker) {
      if (isSameListLevel(marker, firstMarker) && marker.ordered === firstMarker.ordered && marker.marker === firstMarker.marker) {
        if (pendingBlank) pendingBlank = false;
        items.push(createListItem(marker.text, references));
        end = line.end;
        nextLine += 1;
        continue;
      }

      if (marker.indent > firstMarker.indent + 1 && items.length > 0) {
        const nested = parseListAt(lines, nextLine, reuse, references);
        if (!nested) break;
        const current = items[items.length - 1]!;
        appendBlock(current, nested.block);
        end = nested.end;
        nextLine = nested.nextLine;
        pendingBlank = false;
        continue;
      }
    }

    if (items.length > 0 && isBlank(line.text)) {
      if (!blankBelongsToList(lines, nextLine, firstMarker)) break;
      loose = true;
      pendingBlank = true;
      end = line.end;
      nextLine += 1;
      continue;
    }

    if (!isBlank(line.text) && items.length > 0 && leadingSpaces(line.text) > firstMarker.indent) {
      const current = items[items.length - 1]!;
      if (pendingBlank) {
        const continuationBlock = collectListContinuationBlock(lines, nextLine, firstMarker);
        const childDocument = parseDocument(continuationBlock.text);
        appendBlocks(current, childDocument.blocks);
        end = continuationBlock.end;
        nextLine = continuationBlock.nextLine;
        pendingBlank = false;
        continue;
      }

      const continuation = stripListContinuationIndent(line.text, firstMarker.indent);
      if (isBlockQuoteLine(continuation)) {
        const childDocument = parseDocument(continuation);
        appendBlocks(current, childDocument.blocks);
      } else if (isFencedCodeOpener(continuation) || isIndentedCodeLine(continuation)) {
        const continuationBlock = collectListContinuationBlock(lines, nextLine, firstMarker);
        const childDocument = parseDocument(continuationBlock.text);
        appendBlocks(current, childDocument.blocks);
        end = continuationBlock.end;
        nextLine = continuationBlock.nextLine;
        continue;
      } else {
        current.text = current.text ? `${current.text}\n${continuation}` : continuation;
        current.children = parseInlines(current.text, references);
      }
      end = line.end;
      nextLine += 1;
      continue;
    }

    break;
  }

  const raw = sourceSlice(lines, startLine, nextLine);
  const reusable = consumeReusableBlock<ListBlock>("list", lines[startLine]!.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine, end };
  const block: ListBlock = {
    id: blockId("list", lines[startLine]!.start, raw),
    kind: "list",
    raw,
    start: lines[startLine]!.start,
    end,
    ordered: firstMarker.ordered,
    marker: firstMarker.marker,
    ...(firstMarker.ordered && firstMarker.number !== 1 ? { startNumber: firstMarker.number } : null),
    items: items.map((item) => finalizeListItem(item, loose, references)),
  };
  return { block: reuseBlock(block, reuse), nextLine, end };
}

function createListItem(rawText: string, references: LinkReferenceDefinitions): MutableListItem {
  const task = parseTaskMarker(rawText);
  const text = task ? task.text : rawText;
  const heading = parseAtxHeading({ text, start: 0, end: text.length }, null, references);
  return {
    text: heading ? "" : text,
    children: heading ? [] : parseInlines(text, references),
    ...(task ? { task: task.checked ? "checked" : "unchecked" } : null),
    ...(heading ? { blocks: [heading] } : null),
  };
}

function appendBlock(item: MutableListItem, block: MarkdownBlockNode): void {
  (item.blocks ??= []).push(block);
}

function appendBlocks(item: MutableListItem, blocks: readonly MarkdownBlockNode[]): void {
  if (blocks.length === 0) return;
  (item.blocks ??= []).push(...blocks);
}

function finalizeListItem(
  item: MutableListItem,
  loose: boolean,
  references: LinkReferenceDefinitions,
): ListBlock["items"][number] {
  if (!loose) {
    return {
      text: item.text,
      children: item.children,
      ...(item.task ? { task: item.task } : null),
      ...(item.blocks ? { blocks: item.blocks } : null),
    };
  }

  const blocks: MarkdownBlockNode[] = [];
  if (item.text.length > 0) blocks.push(createListParagraphBlock(item.text, references));
  blocks.push(...(item.blocks ?? []));
  return {
    text: "",
    children: [],
    ...(item.task ? { task: item.task } : null),
    ...(blocks.length > 0 ? { blocks } : null),
  };
}

function createListParagraphBlock(text: string, references: LinkReferenceDefinitions): ParagraphBlock {
  return {
    id: listParagraphBlockId(text),
    kind: "paragraph",
    raw: text,
    start: 0,
    end: text.length,
    text,
    children: parseInlines(text, references),
  };
}

function blankBelongsToList(lines: readonly SourceLine[], blankLine: number, firstMarker: ParsedListMarker): boolean {
  let nextLine = blankLine + 1;
  while (nextLine < lines.length && isBlank(lines[nextLine]!.text)) nextLine += 1;
  const next = lines[nextLine];
  if (!next) return false;
  const marker = parseListMarker(next.text);
  if (marker && isSameListLevel(marker, firstMarker) && marker.ordered === firstMarker.ordered && marker.marker === firstMarker.marker) {
    return true;
  }
  return leadingSpaces(next.text) > firstMarker.indent;
}

function collectListContinuationBlock(
  lines: readonly SourceLine[],
  startLine: number,
  firstMarker: ParsedListMarker,
): { text: string; nextLine: number; end: number } {
  const parts: string[] = [];
  let nextLine = startLine;
  let end = lines[startLine]!.end;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    const marker = parseListMarker(line.text);
    if (marker && isSameListLevel(marker, firstMarker)) break;
    if (!isBlank(line.text) && leadingSpaces(line.text) <= firstMarker.indent) break;

    parts.push(isBlank(line.text) ? "" : stripListContinuationIndent(line.text, firstMarker.indent));
    end = line.end;
    nextLine += 1;
  }

  return { text: parts.join("\n"), nextLine, end };
}

function isSameListLevel(marker: ParsedListMarker, firstMarker: ParsedListMarker): boolean {
  return marker.indent >= firstMarker.indent && marker.indent <= firstMarker.indent + 1;
}

function isParagraphInterruptingListLine(line: string): boolean {
  const marker = parseListMarker(line);
  if (!marker) return false;
  if (marker.text.trim().length === 0) return false;
  return !marker.ordered || marker.number === 1;
}

function parseListMarker(line: string): ParsedListMarker | null {
  const unordered = /^( *)([-+*])(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (unordered) {
    if (unordered[2] === "*" && unordered[3] === undefined) return null;
    return { indent: unordered[1]!.length, ordered: false, marker: unordered[2]!, text: unordered[3] ?? "" };
  }

  const ordered = /^( *)(\d{1,9})([.)])(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (ordered) {
    return {
      indent: ordered[1]!.length,
      ordered: true,
      marker: ordered[3]!,
      number: Number.parseInt(ordered[2]!, 10),
      text: ordered[4] ?? "",
    };
  }

  return null;
}

function leadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === " ") count += 1;
  return count;
}

function stripListContinuationIndent(line: string, listIndent: number): string {
  return line.slice(Math.min(line.length, listIndent + 2));
}

function parseTaskMarker(text: string): { checked: boolean; text: string } | null {
  const match = /^\[([ xX])\](?: (.*)|$)/.exec(text);
  if (!match) return null;
  return { checked: match[1]!.toLowerCase() === "x", text: match[2] ?? "" };
}

function parseTable(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  references: LinkReferenceDefinitions,
): { block: TableBlock; nextLine: number } | null {
  const delimiterLine = lines[startLine + 1];
  if (!delimiterLine) return null;
  if (!lines[startLine]!.text.includes("|") && !delimiterLine.text.includes("|")) return null;

  const reusableTable = consumeSequentialReusableBlockPrefix<TableBlock>("table", lines[startLine]!.start, lines, startLine, reuse, (next) =>
    !next || isBlank(next.text) || !stripUpToThreeSpaces(next.text).includes("|"),
  );
  if (reusableTable) return { block: reusableTable.block, nextLine: reusableTable.nextLine };

  const headerTexts = splitTableRow(stripUpToThreeSpaces(lines[startLine]!.text));
  const delimiterCells = splitTableRow(stripUpToThreeSpaces(delimiterLine.text));
  const alignments = delimiterCells.map(parseTableAlignment);
  if (headerTexts.length === 0 || delimiterCells.length === 0 || alignments.some((alignment) => alignment === undefined)) {
    return null;
  }

  const columnCount = headerTexts.length;
  const rows: (readonly TableCell[])[] = [];
  let nextLine = startLine + 2;
  let end = delimiterLine.end;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    const text = stripUpToThreeSpaces(line.text);
    if (isBlank(text) || !text.includes("|")) break;
    rows.push(normalizeTableCells(splitTableRow(text), columnCount, references));
    end = line.end;
    nextLine += 1;
  }

  const raw = sourceSlice(lines, startLine, nextLine);
  const reusable = consumeReusableBlock<TableBlock>("table", lines[startLine]!.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine };
  const block: TableBlock = {
    id: blockId("table", lines[startLine]!.start, raw),
    kind: "table",
    raw,
    start: lines[startLine]!.start,
    end,
    alignments: Array.from({ length: columnCount }, (_, index) => alignments[index] ?? null),
    header: normalizeTableCells(headerTexts, columnCount, references),
    rows,
  };
  return { block: reuseBlock(block, reuse), nextLine };
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const source = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutTrailingPipe = source.endsWith("|") && !source.endsWith("\\|") ? source.slice(0, -1) : source;
  const cells: string[] = [];
  let cell = "";
  let escaped = false;

  for (const char of withoutTrailingPipe) {
    if (escaped) {
      cell += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
}

function parseTableAlignment(cell: string): TableBlock["alignments"][number] | undefined {
  const normalized = cell.trim();
  if (!/^:?-+:?$/.test(normalized)) return undefined;
  const left = normalized.startsWith(":");
  const right = normalized.endsWith(":");
  if (left && right) return "center";
  if (left) return "left";
  if (right) return "right";
  return null;
}

function normalizeTableCells(
  cells: readonly string[],
  count: number,
  references: LinkReferenceDefinitions,
): TableBlock["header"] {
  const normalized: TableCell[] = [];
  for (let index = 0; index < count; index += 1) {
    const text = cells[index] ?? "";
    normalized.push({ text, children: parseInlines(text, references) });
  }
  return normalized;
}

function parseAtxHeading(
  line: SourceLine,
  reuse: ReuseIndex | null,
  references: LinkReferenceDefinitions,
): HeadingBlock | null {
  const match = /^( {0,3})(#{1,6})(?:[ \t]+|$)(.*)$/.exec(line.text);
  if (!match) return null;

  const level = match[2]!.length as HeadingBlock["level"];
  const raw = line.text;
  const reusable = consumeReusableBlock<HeadingBlock>("heading", line.start, raw, reuse);
  if (reusable) return reusable;
  const body = match[3]!.replace(/[ \t]+#+[ \t]*$/, "").trim();
  const id = blockId("heading", line.start, raw);
  const block: HeadingBlock = {
    id,
    kind: "heading",
    raw,
    start: line.start,
    end: line.end,
    level,
    text: body,
    children: parseInlines(body, references),
  };
  return reuseBlock(block, reuse);
}

function isAtxHeadingLine(line: string): boolean {
  const index = skipUpToThreeSpacesIndex(line);
  let level = 0;
  while (level < 6 && line[index + level] === "#") level += 1;
  if (level === 0) return false;
  const next = line[index + level];
  return next === undefined || next === " " || next === "\t";
}

function isThematicBreakLine(line: string): boolean {
  let index = skipUpToThreeSpacesIndex(line);
  const marker = line[index];
  if (marker !== "*" && marker !== "-" && marker !== "_") return false;

  let count = 0;
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (char === marker) {
      count += 1;
      continue;
    }
    if (char !== " " && char !== "\t") return false;
  }
  return count >= 3 && !(count === 4 && line.slice(skipUpToThreeSpacesIndex(line)).trim().length === 4 && marker !== "-");
}

function parseThematicBreak(line: SourceLine, reuse: ReuseIndex | null): ThematicBreakBlock | null {
  if (!isThematicBreakLine(line.text)) return null;

  const raw = line.text;
  const reusable = consumeReusableBlock<ThematicBreakBlock>("thematicBreak", line.start, raw, reuse);
  if (reusable) return reusable;
  const block: ThematicBreakBlock = {
    id: blockId("thematicBreak", line.start, raw),
    kind: "thematicBreak",
    raw,
    start: line.start,
    end: line.end,
  };
  return reuseBlock(block, reuse);
}

function parseParagraph(
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  references: LinkReferenceDefinitions,
): { block: ParagraphBlock | HeadingBlock; nextLine: number } | null {
  const parts: string[] = [];
  let nextLine = startLine;
  let end = lines[startLine]!.end;
  let sawBacktick = false;

  while (nextLine < lines.length) {
    const line = lines[nextLine]!;
    if (isBlank(line.text)) {
      if (sawBacktick && parts.length > 0 && hasUnclosedCodeSpan(parts.join("\n"))) {
        parts.push("");
        end = line.end;
        nextLine += 1;
        continue;
      }
      break;
    }
    if (
      nextLine > startLine &&
      ((nextLine === startLine + 1 && parseSetextDelimiter(line.text)) ||
        isAtxHeadingLine(line.text) ||
        isThematicBreakLine(line.text) ||
        isBlockQuoteLine(line.text) ||
        isParagraphInterruptingListLine(line.text) ||
        isIndentedCodeLine(line.text))
    ) {
      break;
    }
    if (!sawBacktick && line.text.includes("`")) sawBacktick = true;
    parts.push(stripUpToThreeSpaces(line.text));
    end = line.end;
    nextLine += 1;
  }

  if (parts.length === 0) return null;

  if (parts.length === 1 && nextLine < lines.length) {
    const delimiter = parseSetextDelimiter(lines[nextLine]!.text);
    if (delimiter) {
      const sequential = consumeSequentialReusableBlockFromLines<HeadingBlock>("heading", lines[startLine]!.start, lines, startLine, nextLine + 1, reuse);
      if (sequential) return { block: sequential, nextLine: nextLine + 1 };
      const raw = sourceSlice(lines, startLine, nextLine + 1);
      const reusable = consumeReusableBlock<HeadingBlock>("heading", lines[startLine]!.start, raw, reuse);
      if (reusable) return { block: reusable, nextLine: nextLine + 1 };
      const text = parts[0]!.trim();
      const block: HeadingBlock = {
        id: blockId("heading", lines[startLine]!.start, raw),
        kind: "heading",
        raw,
        start: lines[startLine]!.start,
        end: lines[nextLine]!.end,
        level: delimiter,
        text,
        children: parseInlines(text, references),
      };
      return { block: reuseBlock(block, reuse), nextLine: nextLine + 1 };
    }
  }

  const text = normalizeParagraphText(parts.join("\n"));
  if (text.length === 0) return null;

  const sequential = consumeSequentialReusableBlockFromLines<ParagraphBlock>("paragraph", lines[startLine]!.start, lines, startLine, nextLine, reuse);
  if (sequential) return { block: sequential, nextLine };
  const raw = sourceSlice(lines, startLine, nextLine);
  const reusable = consumeReusableBlock<ParagraphBlock>("paragraph", lines[startLine]!.start, raw, reuse);
  if (reusable) return { block: reusable, nextLine };
  const block: ParagraphBlock = {
    id: blockId("paragraph", lines[startLine]!.start, raw),
    kind: "paragraph",
    raw,
    start: lines[startLine]!.start,
    end,
    text,
    children: parseInlines(text, references),
  };
  return { block: reuseBlock(block, reuse), nextLine };
}

function parseSetextDelimiter(line: string): HeadingBlock["level"] | null {
  const trimmed = stripUpToThreeSpaces(line).trim();
  if (trimmed.length === 0) return null;
  const marker = trimmed[0];
  if (marker !== "=" && marker !== "-") return null;
  for (let index = 1; index < trimmed.length; index += 1) {
    if (trimmed[index] !== marker) return null;
  }
  return marker === "=" ? 1 : 2;
}

function normalizeParagraphText(text: string): string {
  const leadingTrimmed = text.replace(/^[ \t]+/, "");
  if (hasTrailingHardBreakBackslash(leadingTrimmed)) return `${leadingTrimmed.replace(/[ \t]*$/, "")}\n`;
  if (/ {2,}$/.test(leadingTrimmed)) return leadingTrimmed.replace(/ {2,}$/, "  \n");
  return leadingTrimmed.trimEnd();
}

function hasTrailingHardBreakBackslash(text: string): boolean {
  const trimmed = text.replace(/[ \t]*$/, "");
  let count = 0;
  for (let index = trimmed.length - 1; index >= 0 && trimmed[index] === "\\"; index -= 1) count += 1;
  return count % 2 === 1;
}

function normalizeSource(content: string): string {
  if (content.indexOf("\r") === -1 && content.indexOf("\0") === -1) return content;
  return content.replace(/\r\n?/g, "\n").replace(/\0/g, "�");
}

function splitLines(source: string): SourceLine[] {
  if (source.length === 0) return [];

  const lines: SourceLine[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    if (index === source.length || source[index] === "\n") {
      lines.push({ text: source.slice(start, index), start, end: index });
      start = index + 1;
    }
  }
  return lines;
}

function sourceSlice(lines: readonly SourceLine[], startLine: number, endLine: number): string {
  let raw = lines[startLine]?.text ?? "";
  for (let index = startLine + 1; index < endLine; index += 1) raw += `\n${lines[index]!.text}`;
  return raw;
}

function stripUpToThreeSpaces(line: string): string {
  return line.slice(skipUpToThreeSpacesIndex(line));
}

function skipUpToThreeSpacesIndex(line: string): number {
  let index = 0;
  while (index < 3 && line[index] === " ") index += 1;
  return index;
}

function isBlank(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

function isIndentedCodeLine(line: string): boolean {
  return line.startsWith("    ") || line.startsWith("\t");
}

function isFencedCodeOpener(line: string): boolean {
  const index = skipUpToThreeSpacesIndex(line);
  const marker = line[index];
  if (marker !== "`" && marker !== "~") return false;
  return line[index + 1] === marker && line[index + 2] === marker;
}

function isClosingCodeFence(line: string, fence: string, minimumLength: number): boolean {
  let index = skipUpToThreeSpacesIndex(line);
  let length = 0;
  while (line[index] === fence) {
    index += 1;
    length += 1;
  }
  if (length < minimumLength) return false;
  for (; index < line.length; index += 1) {
    const char = line[index];
    if (char !== " " && char !== "\t") return false;
  }
  return true;
}

function stripCodeIndent(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith("    ")) return line.slice(4);
  return line;
}

function stripCodeFenceIndent(line: string, indent: number): string {
  let cursor = 0;
  while (cursor < indent && line[cursor] === " ") cursor += 1;
  return line.slice(cursor);
}

function trimTrailingBlankCodeLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end -= 1;
  return lines.slice(0, end);
}

function blockId(kind: MarkdownBlockNode["kind"], start: number, raw: string): string {
  void raw;
  return `${kind}:${start}`;
}

function listParagraphBlockId(text: string): string {
  return `paragraph:0:list:${stableBlockHash(text)}`;
}

function stableBlockHash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function buildReuseIndex(previous: ParsedDocument): ReuseIndex {
  return { blocks: previous.blocks, cursor: 0 };
}

function reuseBlock<T extends MarkdownBlockNode>(block: T, reuse: ReuseIndex | null): T {
  return consumeReusableBlock<T>(block.kind, block.start, block.raw, reuse) ?? block;
}

function consumeSequentialReusableBlockPrefix<T extends MarkdownBlockNode>(
  kind: MarkdownBlockNode["kind"],
  start: number,
  lines: readonly SourceLine[],
  startLine: number,
  reuse: ReuseIndex | null,
  isBoundary: (next: SourceLine | undefined) => boolean,
): { block: T; nextLine: number } | null {
  if (!reuse || reuse.byFingerprint) return null;
  const block = reuse.blocks[reuse.cursor];
  if (!block || block.kind !== kind || block.start !== start) return null;

  const lineCount = countRawLines(block.raw);
  const nextLine = startLine + lineCount;
  if (nextLine > lines.length || !isBoundary(lines[nextLine]) || !rawEqualsLines(block.raw, lines, startLine, nextLine)) return null;

  reuse.cursor += 1;
  return { block: block as T, nextLine };
}

function consumeSequentialReusableBlockFromLines<T extends MarkdownBlockNode>(
  kind: MarkdownBlockNode["kind"],
  start: number,
  lines: readonly SourceLine[],
  startLine: number,
  endLine: number,
  reuse: ReuseIndex | null,
): T | null {
  if (!reuse || reuse.byFingerprint) return null;
  const block = reuse.blocks[reuse.cursor];
  if (!block || block.kind !== kind || block.start !== start || !rawEqualsLines(block.raw, lines, startLine, endLine)) return null;
  reuse.cursor += 1;
  return block as T;
}

function countRawLines(raw: string): number {
  let count = 1;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "\n") count += 1;
  }
  return count;
}

function rawEqualsLines(raw: string, lines: readonly SourceLine[], startLine: number, endLine: number): boolean {
  let rawIndex = 0;
  for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
    if (lineIndex > startLine) {
      if (raw[rawIndex] !== "\n") return false;
      rawIndex += 1;
    }
    const text = lines[lineIndex]!.text;
    if (raw.length - rawIndex < text.length) return false;
    for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
      if (raw[rawIndex + textIndex] !== text[textIndex]) return false;
    }
    rawIndex += text.length;
  }
  return rawIndex === raw.length;
}

function consumeReusableBlock<T extends MarkdownBlockNode>(
  kind: MarkdownBlockNode["kind"],
  start: number,
  raw: string,
  reuse: ReuseIndex | null,
): T | null {
  if (!reuse) return null;

  if (!reuse.byFingerprint) {
    const sequential = reuse.blocks[reuse.cursor];
    if (sequential) {
      if (sameBlockFingerprintParts(sequential, kind, start, raw)) {
        reuse.cursor += 1;
        return sequential as T;
      }
    }
  }

  const byFingerprint = reuse.byFingerprint ??= buildFallbackReuseMap(reuse.blocks, reuse.cursor);
  const bucket = byFingerprint.get(blockFingerprintParts(kind, start, raw));
  return (bucket?.shift() as T | undefined) ?? null;
}

function buildFallbackReuseMap(blocks: readonly MarkdownBlockNode[], start: number): Map<string, MarkdownBlockNode[]> {
  const byFingerprint = new Map<string, MarkdownBlockNode[]>();
  for (let index = start; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const fingerprint = blockFingerprint(block);
    const bucket = byFingerprint.get(fingerprint);
    if (bucket) bucket.push(block);
    else byFingerprint.set(fingerprint, [block]);
  }
  return byFingerprint;
}

function sameBlockFingerprintParts(
  block: MarkdownBlockNode,
  kind: MarkdownBlockNode["kind"],
  start: number,
  raw: string,
): boolean {
  return block.kind === kind && block.start === start && block.raw === raw;
}

function blockFingerprint(block: MarkdownBlockNode): string {
  return blockFingerprintParts(block.kind, block.start, block.raw);
}

function blockFingerprintParts(kind: MarkdownBlockNode["kind"], start: number, raw: string): string {
  return `${kind}:${raw}`;
}
