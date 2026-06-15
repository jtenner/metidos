import type { InlineNode } from "./ast";

export interface LinkReferenceDefinition {
  readonly href: string;
  readonly title?: string;
}

export type LinkReferenceMap = ReadonlyMap<string, LinkReferenceDefinition>;

const escapablePunctuation = new Set(
  Array.from("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"),
);

const namedEntities: Record<string, string> = {
  amp: "&",
  copy: "©",
  gt: ">",
  lt: "<",
  quot: '"',
  apos: "'",
};

export function parseInlines(
  source: string,
  references?: LinkReferenceMap,
): readonly InlineNode[] {
  if (source === "****" || source === "____")
    return [{ kind: "text", value: source }];
  return parseInlineRange(source, 0, source.length, undefined, references)
    .nodes;
}

export function hasUnclosedCodeSpan(source: string): boolean {
  let openerLength: number | null = null;
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "`") {
      index += 1;
      continue;
    }

    const length = countRun(source, index, "`");
    if (openerLength === null) openerLength = length;
    else if (openerLength === length) openerLength = null;
    index += length;
  }

  return openerLength !== null;
}

export function normalizeReferenceLabel(label: string): string {
  return label
    .trim()
    .replace(/[\t\n ]+/g, " ")
    .toLowerCase();
}

function parseInlineRange(
  source: string,
  start: number,
  end: number,
  stop?: string,
  references?: LinkReferenceMap,
): { nodes: InlineNode[]; index: number; closed: boolean } {
  const nodes: InlineNode[] = [];
  let text = "";
  let index = start;

  function flushText() {
    if (text.length > 0) {
      const previous = nodes[nodes.length - 1];
      if (previous?.kind === "text") {
        nodes[nodes.length - 1] = {
          kind: "text",
          value: previous.value + text,
        };
      } else {
        nodes.push({ kind: "text", value: text });
      }
      text = "";
    }
  }

  while (index < end) {
    const char = source[index]!;

    if (char === "\\") {
      const next = source[index + 1];
      if (next === "\n") {
        flushText();
        nodes.push({ kind: "break" });
        text += "\n";
        index += 2;
        continue;
      }
      if (next && escapablePunctuation.has(next)) {
        text += next;
        index += 2;
        continue;
      }
      text += char;
      index += 1;
      continue;
    }

    if (char === "&") {
      const decoded = decodeEntityAt(source, index);
      if (decoded) {
        text += decoded.value;
        index = decoded.index;
        continue;
      }
    }

    if (char === "\n") {
      if (text.endsWith("  ")) {
        text = text.replace(/ {2,}$/, "");
        flushText();
        nodes.push({ kind: "break" });
        text += "\n";
      } else {
        text += "\n";
      }
      index += 1;
      continue;
    }

    if (char === "`") {
      const codeSpan = parseCodeSpanAt(source, index, end);
      if (codeSpan) {
        flushText();
        nodes.push({ kind: "code", value: codeSpan.value });
        index = codeSpan.index;
        continue;
      }
      const optimisticCodeSpan = parseOptimisticCodeSpanAt(source, index, end);
      if (optimisticCodeSpan) {
        flushText();
        nodes.push({ kind: "code", value: optimisticCodeSpan.value });
        index = optimisticCodeSpan.index;
        continue;
      }
      const markerLength = countRun(source, index, "`");
      text += source.slice(index, index + markerLength);
      index += markerLength;
      continue;
    }

    if (char === "<") {
      const autolink = parseAngleAutolinkAt(source, index, end);
      if (autolink) {
        flushText();
        nodes.push({
          kind: "link",
          href: autolink.href,
          children: [{ kind: "text", value: autolink.label }],
        });
        index = autolink.index;
        continue;
      }
    }

    if (isPotentialLiteralAutolinkStart(source, index)) {
      const literalAutolink = parseLiteralAutolinkAt(source, index, end);
      if (literalAutolink) {
        flushText();
        nodes.push({
          kind: "link",
          href: literalAutolink.href,
          children: [{ kind: "text", value: literalAutolink.label }],
        });
        index = literalAutolink.index;
        continue;
      }
    }

    if (char === "!" && source[index + 1] === "[") {
      const image = parseInlineImageAt(source, index, end, references);
      if (image) {
        flushText();
        nodes.push({
          kind: "image",
          src: image.href,
          alt: plainText(parseInlines(image.label, references)),
          ...(image.title !== undefined ? { title: image.title } : null),
        });
        index = image.index;
        continue;
      }
    }

    if (char === "[") {
      const link = parseInlineLinkAt(source, index, end, references);
      if (link) {
        flushText();
        nodes.push({
          kind: "link",
          href: link.href,
          ...(link.title !== undefined ? { title: link.title } : null),
          children: parseInlines(link.label, references),
        });
        index = link.index;
        continue;
      }
      if (findClosingBracket(source, index, end) === -1) {
        text += `${source.slice(index, end)}]`;
        index = end;
        continue;
      }
    }

    if (
      stop &&
      source.startsWith(stop, index) &&
      canCloseDelimiter(source, index, stop)
    ) {
      flushText();
      return { nodes, index: index + stop.length, closed: true };
    }

    if (
      source.startsWith("~~", index) &&
      canOpenDelimiter(source, index, "~~")
    ) {
      const parsed = parseInlineRange(source, index + 2, end, "~~", references);
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, "~~")) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({ kind: "delete", children: parsed.nodes });
        index = parsed.index;
        continue;
      }
    }

    if (
      source.startsWith("***", index) &&
      canOpenDelimiter(source, index, "***")
    ) {
      const parsed = parseInlineRange(
        source,
        index + 3,
        end,
        "***",
        references,
      );
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, "***")) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({
          kind: "strong",
          children: [{ kind: "emphasis", children: parsed.nodes }],
        });
        index = parsed.index;
        continue;
      }
    }

    if (
      source.startsWith("___", index) &&
      canOpenDelimiter(source, index, "___")
    ) {
      const parsed = parseInlineRange(
        source,
        index + 3,
        end,
        "___",
        references,
      );
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, "___")) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({
          kind: "strong",
          children: [{ kind: "emphasis", children: parsed.nodes }],
        });
        index = parsed.index;
        continue;
      }
    }

    if (
      source.startsWith("**", index) &&
      canOpenDelimiter(source, index, "**")
    ) {
      const parsed = parseInlineRange(source, index + 2, end, "**", references);
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, "**")) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({ kind: "strong", children: parsed.nodes });
        index = parsed.index;
        continue;
      }
    }

    if (
      source.startsWith("__", index) &&
      canOpenDelimiter(source, index, "__")
    ) {
      const parsed = parseInlineRange(source, index + 2, end, "__", references);
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, "__")) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({ kind: "strong", children: parsed.nodes });
        index = parsed.index;
        continue;
      }
    }

    if (
      (char === "*" || char === "_") &&
      canOpenDelimiter(source, index, char)
    ) {
      const repairedStrong = parseSingleOpeningStrongRepair(
        source,
        index,
        end,
        char,
        stop,
        references,
      );
      if (repairedStrong) {
        flushText();
        nodes.push({ kind: "strong", children: repairedStrong.nodes });
        index = repairedStrong.index;
        continue;
      }

      if (!stop) {
        const trailingBackslashIndex =
          source[end - 1] === "\\"
            ? end - 1
            : source[end - 1] === "\n" && source[end - 2] === "\\"
              ? end - 2
              : -1;
        if (trailingBackslashIndex !== -1) {
          const parsedBeforeTrailingBackslash = parseInlineRange(
            source,
            index + 1,
            trailingBackslashIndex,
            char,
            references,
          );
          if (
            !parsedBeforeTrailingBackslash.closed &&
            parsedBeforeTrailingBackslash.nodes.length > 0
          ) {
            flushText();
            nodes.push({
              kind: "emphasis",
              children: parsedBeforeTrailingBackslash.nodes,
            });
            text += "\\";
            index = trailingBackslashIndex === end - 2 ? end : end - 1;
            continue;
          }
        }
      }

      const optimisticWord = parseOptimisticFirstWordEmphasis(
        source,
        index,
        end,
        char,
        stop,
      );
      if (optimisticWord) {
        flushText();
        nodes.push({
          kind: "emphasis",
          children: [{ kind: "text", value: optimisticWord.value }],
        });
        index = optimisticWord.index;
        continue;
      }

      const parsed = parseInlineRange(source, index + 1, end, char, references);
      if (
        (parsed.closed ||
          canOptimisticallyClose(parsed, source, index, char)) &&
        parsed.nodes.length > 0
      ) {
        flushText();
        nodes.push({ kind: "emphasis", children: parsed.nodes });
        index = parsed.index;
        continue;
      }
    }

    text += char;
    index += 1;
  }

  flushText();
  return { nodes, index, closed: false };
}

interface ParsedAutolink {
  readonly href: string;
  readonly label: string;
  readonly index: number;
}

function parseAngleAutolinkAt(
  source: string,
  index: number,
  end: number,
): ParsedAutolink | null {
  const close = source.indexOf(">", index + 1);
  const labelEnd = close === -1 || close >= end ? end : close;

  const label = source.slice(index + 1, labelEnd);
  const unclosed = close === -1 || close >= end;
  if (/\s/.test(label) && !unclosed) return null;
  const nextIndex = unclosed ? end : close + 1;
  if (isUriAutolink(label) || (unclosed && startsWithUriScheme(label)))
    return { href: label, label, index: nextIndex };
  if (isEmailAutolink(label))
    return { href: `mailto:${label}`, label, index: nextIndex };
  return null;
}

function parseLiteralAutolinkAt(
  source: string,
  index: number,
  end: number,
): ParsedAutolink | null {
  if (!isAutolinkBoundary(source[index - 1])) return null;

  if (
    startsWithIgnoreCase(source, index, "http://") ||
    startsWithIgnoreCase(source, index, "https://")
  ) {
    return literalUrl(
      source.slice(index, scanLiteralAutolinkEnd(source, index, end)),
      "",
    );
  }

  if (startsWithIgnoreCase(source, index, "www.")) {
    return literalUrl(
      source.slice(index, scanLiteralAutolinkEnd(source, index, end)),
      "http://",
    );
  }

  const candidateEnd = scanLiteralAutolinkEnd(source, index, end);
  const at = source.indexOf("@", index + 1);
  if (at === -1 || at >= candidateEnd) return null;

  const emailMatch =
    /^[-.!#$%&'*+/=?^_`{|}~A-Za-z0-9]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+/.exec(
      source.slice(index, candidateEnd),
    );
  if (emailMatch) {
    const label = trimTrailingAutolinkPunctuation(emailMatch[0]!);
    if (label.length === 0) return null;
    return { href: `mailto:${label}`, label, index: index + label.length };
  }

  return null;

  function literalUrl(raw: string, hrefPrefix: string): ParsedAutolink | null {
    const label = trimTrailingAutolinkPunctuation(raw);
    if (label.length === 0) return null;
    return {
      href: `${hrefPrefix}${label}`,
      label,
      index: index + label.length,
    };
  }
}

function isUriAutolink(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^<>]*$/.test(value);
}

function startsWithUriScheme(value: string): boolean {
  return (
    /^[A-Za-z][A-Za-z0-9+.-]{1,31}:/.test(value) &&
    !value.includes("<") &&
    !value.includes(">")
  );
}

function isEmailAutolink(value: string): boolean {
  return /^[-.!#$%&'*+/=?^_`{|}~A-Za-z0-9]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
    value,
  );
}

function isAutolinkBoundary(previous: string | undefined): boolean {
  return (
    !previous ||
    previous === " " ||
    previous === "\n" ||
    previous === "\t" ||
    previous === "\r" ||
    previous === "\f" ||
    previous === "\v" ||
    previous === "(" ||
    previous === "[" ||
    previous === "{" ||
    previous === ":"
  );
}

function isPotentialLiteralAutolinkStart(
  source: string,
  index: number,
): boolean {
  const char = source[index];
  return (
    isAutolinkBoundary(source[index - 1]) &&
    !!char &&
    (startsWithIgnoreCase(source, index, "http://") ||
      startsWithIgnoreCase(source, index, "https://") ||
      startsWithIgnoreCase(source, index, "www.") ||
      isEmailLocalChar(char))
  );
}

function startsWithIgnoreCase(
  source: string,
  index: number,
  prefix: string,
): boolean {
  if (index + prefix.length > source.length) return false;
  for (let offset = 0; offset < prefix.length; offset += 1) {
    const code = source.charCodeAt(index + offset);
    const lower = code >= 65 && code <= 90 ? code + 32 : code;
    if (lower !== prefix.charCodeAt(offset)) return false;
  }
  return true;
}

function scanLiteralAutolinkEnd(
  source: string,
  index: number,
  end: number,
): number {
  let cursor = index;
  while (cursor < end) {
    const char = source[cursor];
    if (char === "<" || char === " " || char === "\n" || char === "\t") break;
    cursor += 1;
  }
  return cursor;
}

function trimTrailingAutolinkPunctuation(value: string): string {
  let end = value.length;
  while (end > 0 && isTrailingAutolinkPunctuation(value[end - 1]!)) end -= 1;

  let opens = 0;
  let closes = 0;
  for (let index = 0; index < end; index += 1) {
    if (value[index] === "(") opens += 1;
    else if (value[index] === ")") closes += 1;
  }

  while (end > 0 && value[end - 1] === ")" && closes > opens) {
    end -= 1;
    closes -= 1;
  }

  return value.slice(0, end);
}

function isTrailingAutolinkPunctuation(char: string): boolean {
  return (
    char === "." ||
    char === "!" ||
    char === "?" ||
    char === "," ||
    char === ":" ||
    char === ";" ||
    char === "*" ||
    char === "_" ||
    char === "'" ||
    char === "~"
  );
}

function parseInlineImageAt(
  source: string,
  index: number,
  end: number,
  references?: LinkReferenceMap,
): { label: string; href: string; title?: string; index: number } | null {
  return parseLinkLikeAt(source, index + 1, end, references);
}

function parseInlineLinkAt(
  source: string,
  index: number,
  end: number,
  references?: LinkReferenceMap,
): { label: string; href: string; title?: string; index: number } | null {
  return parseLinkLikeAt(source, index, end, references);
}

function parseLinkLikeAt(
  source: string,
  bracketIndex: number,
  end: number,
  references?: LinkReferenceMap,
): { label: string; href: string; title?: string; index: number } | null {
  const labelEnd = findClosingBracket(source, bracketIndex, end);
  if (labelEnd === -1) return null;

  const label = source.slice(bracketIndex + 1, labelEnd);
  if (source[labelEnd + 1] === "(") {
    const destination = parseLinkDestination(source, labelEnd + 2, end);
    if (!destination) return null;

    return {
      label,
      href: destination.href,
      ...(destination.title !== undefined
        ? { title: destination.title }
        : null),
      index: destination.index,
    };
  }

  const reference = parseReferenceLink(
    source,
    labelEnd,
    end,
    label,
    references,
  );
  if (reference) return reference;
  return null;
}

function parseReferenceLink(
  source: string,
  labelEnd: number,
  end: number,
  label: string,
  references?: LinkReferenceMap,
): { label: string; href: string; title?: string; index: number } | null {
  if (!references) return null;

  if (source[labelEnd + 1] === "[") {
    const referenceEnd = findClosingBracket(source, labelEnd + 1, end);
    if (referenceEnd === -1) return null;
    const rawReference = source.slice(labelEnd + 2, referenceEnd);
    const normalized = normalizeReferenceLabel(
      rawReference === "" ? label : rawReference,
    );
    const definition = references.get(normalized);
    return definition
      ? { label, ...definition, index: referenceEnd + 1 }
      : null;
  }

  const definition = references.get(normalizeReferenceLabel(label));
  return definition ? { label, ...definition, index: labelEnd + 1 } : null;
}

function findClosingBracket(
  source: string,
  index: number,
  end: number,
): number {
  let depth = 0;
  for (let cursor = index; cursor < end; cursor += 1) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return -1;
}

function parseLinkDestination(
  source: string,
  index: number,
  end: number,
): { href: string; title?: string; index: number } | null {
  let cursor = index;
  let quote: '"' | "'" | null = null;

  while (cursor < end) {
    const char = source[cursor];
    if (char === "\\") {
      cursor += 2;
      continue;
    }
    if (quote === char) {
      quote = null;
    } else if (
      quote === null &&
      (char === '"' || char === "'") &&
      /\s/.test(source[cursor - 1] ?? "")
    ) {
      quote = char;
    } else if (char === ")" && quote === null) {
      const parsed = parseLinkBody(source.slice(index, cursor));
      return parsed ? { ...parsed, index: cursor + 1 } : null;
    }
    cursor += 1;
  }

  const parsed = parseLinkBody(source.slice(index, end));
  return parsed ? { ...parsed, index: end } : null;
}

function parseLinkBody(body: string): { href: string; title?: string } | null {
  const trimmed = body.trim();
  if (trimmed === "") return { href: "" };
  if (trimmed.startsWith("<")) {
    const close = trimmed.indexOf(">");
    if (close === -1) return null;
    const rest = trimmed.slice(close + 1).trim();
    const title = parseOptionalTitle(rest);
    return title === null
      ? { href: trimmed.slice(1, close) }
      : { href: trimmed.slice(1, close), title };
  }

  const match = /^(\S+)(?:\s+([\s\S]+))?$/.exec(trimmed);
  if (!match) return null;
  const href = match[1]!.replace(/\\([()])/g, "$1");
  const title = parseOptionalTitle(match[2]?.trim() ?? "");
  return title === null ? { href } : { href, title };
}

function parseOptionalTitle(raw: string): string | null {
  if (raw === "") return null;
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'")) ||
    (raw.startsWith("(") && raw.endsWith(")"))
  ) {
    return raw.slice(1, -1);
  }
  if (raw.startsWith('"') || raw.startsWith("'") || raw.startsWith("("))
    return raw.slice(1);
  return null;
}

function plainText(nodes: readonly InlineNode[]): string {
  let text = "";
  for (const node of nodes) {
    switch (node.kind) {
      case "text":
      case "code":
        text += node.value;
        break;
      case "break":
        text += "\n";
        break;
      case "emphasis":
      case "strong":
      case "delete":
      case "link":
        text += plainText(node.children);
        break;
      case "image":
        text += node.alt;
        break;
    }
  }
  return text;
}

function parseSingleOpeningStrongRepair(
  source: string,
  index: number,
  end: number,
  delimiter: string,
  stop: string | undefined,
  references?: LinkReferenceMap,
): { nodes: InlineNode[]; index: number } | null {
  const strongDelimiter = `${delimiter}${delimiter}`;
  if (stop || index !== 0) return null;
  if (source.startsWith(strongDelimiter, index)) return null;
  if (!source.endsWith(strongDelimiter)) return null;

  const innerStart = index + delimiter.length;
  const innerEnd = end - strongDelimiter.length;
  if (innerStart >= innerEnd) return null;

  const rawInner = source.slice(innerStart, innerEnd);
  if (rawInner.includes(delimiter)) return null;

  const parsed = parseInlineRange(
    source,
    innerStart,
    innerEnd,
    undefined,
    references,
  );
  if (parsed.index !== innerEnd || parsed.nodes.length === 0) return null;
  return { nodes: parsed.nodes, index: end };
}

function parseOptimisticFirstWordEmphasis(
  source: string,
  index: number,
  end: number,
  delimiter: string,
  stop?: string,
): { value: string; index: number } | null {
  if (stop || index !== 0) return null;
  const rest = source.slice(index + delimiter.length, end);
  if (rest.includes(delimiter) || rest.includes("\n")) return null;
  const match = /^(\S+) /.exec(rest);
  if (!match) return null;
  const remaining = rest.slice(match[1]!.length);
  if (/[*_~`[<&]/.test(remaining)) return null;
  return {
    value: match[1]!,
    index: index + delimiter.length + match[1]!.length,
  };
}

function canOptimisticallyClose(
  parsed: { index: number; closed: boolean },
  source: string,
  openerIndex: number,
  delimiter: string,
): boolean {
  if (parsed.closed) return false;
  const raw = source.slice(openerIndex + delimiter.length, parsed.index);
  if (
    delimiter.length === 1 &&
    openerIndex === 0 &&
    !/\s/.test(raw) &&
    raw.length > 4
  )
    return false;
  return true;
}

function parseCodeSpanAt(
  source: string,
  index: number,
  end: number,
): { value: string; index: number } | null {
  const openerLength = countRun(source, index, "`");
  let cursor = index + openerLength;

  while (cursor < end) {
    if (source[cursor] !== "`") {
      cursor += 1;
      continue;
    }

    const closerLength = countRun(source, cursor, "`");
    if (closerLength === openerLength) {
      const raw = source.slice(index + openerLength, cursor);
      return { value: normalizeCodeSpan(raw), index: cursor + closerLength };
    }
    cursor += closerLength;
  }

  return null;
}

function parseOptimisticCodeSpanAt(
  source: string,
  index: number,
  end: number,
): { value: string; index: number } | null {
  const openerLength = countRun(source, index, "`");
  const raw = source.slice(index + openerLength, end);
  if (raw.length === 0 || raw.includes("`") || /^ *$/.test(raw)) return null;
  return { value: normalizeCodeSpan(raw), index: end };
}

function countRun(source: string, index: number, marker: string): number {
  let length = 0;
  while (source[index + length] === marker) length += 1;
  return length;
}

function normalizeCodeSpan(raw: string): string {
  const normalized = raw.replace(/\n/g, " ");
  if (/^ *$/.test(normalized)) return "";
  if (normalized.startsWith(" ") && normalized.endsWith(" ")) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function canOpenDelimiter(
  source: string,
  index: number,
  delimiter: string,
): boolean {
  const next = source[index + delimiter.length];
  if (!next || isWhitespace(next)) return false;
  if (delimiter === "*" && next === "-") return false;

  if (delimiter[0] === "_") {
    const previous = source[index - 1];
    if (previous && isAsciiAlphanumeric(previous) && isAsciiAlphanumeric(next))
      return false;
  }

  return true;
}

function canCloseDelimiter(
  source: string,
  index: number,
  delimiter: string,
): boolean {
  const previous = source[index - 1];
  return (
    !!previous && !isWhitespace(previous) && source.startsWith(delimiter, index)
  );
}

function isWhitespace(value: string): boolean {
  return (
    value === " " ||
    value === "\n" ||
    value === "\t" ||
    value === "\r" ||
    value === "\f" ||
    value === "\v"
  );
}

function isAsciiAlphanumeric(value: string): boolean {
  const code = value.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122)
  );
}

function isEmailLocalChar(value: string): boolean {
  return (
    isAsciiAlphanumeric(value) ||
    value === "-" ||
    value === "." ||
    value === "!" ||
    value === "#" ||
    value === "$" ||
    value === "%" ||
    value === "&" ||
    value === "'" ||
    value === "*" ||
    value === "+" ||
    value === "/" ||
    value === "=" ||
    value === "?" ||
    value === "^" ||
    value === "_" ||
    value === "`" ||
    value === "{" ||
    value === "|" ||
    value === "}" ||
    value === "~"
  );
}

function decodeEntityAt(
  source: string,
  index: number,
): { value: string; index: number } | null {
  const match = /^&(#(?:x[0-9A-Fa-f]+|[0-9]+)|[A-Za-z][A-Za-z0-9]+);/.exec(
    source.slice(index),
  );
  if (!match) return null;

  const body = match[1]!;
  if (body.startsWith("#x") || body.startsWith("#X")) {
    return decodeCodePoint(body.slice(2), 16, index + match[0].length);
  }
  if (body.startsWith("#")) {
    return decodeCodePoint(body.slice(1), 10, index + match[0].length);
  }

  const value = namedEntities[body];
  return value ? { value, index: index + match[0].length } : null;
}

function decodeCodePoint(
  raw: string,
  radix: number,
  index: number,
): { value: string; index: number } | null {
  const codePoint = Number.parseInt(raw, radix);
  if (!Number.isFinite(codePoint)) return null;
  try {
    return { value: String.fromCodePoint(codePoint), index };
  } catch {
    return { value: "�", index };
  }
}
