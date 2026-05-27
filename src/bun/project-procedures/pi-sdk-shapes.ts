/**
 * @file src/bun/project-procedures/pi-sdk-shapes.ts
 * @description Shared Pi SDK payload-shape helpers for projection and telemetry.
 */

import type { RpcThreadUsage } from "../rpc-schema";

const INLINE_THINK_OPEN_TAG = "<think>";
const INLINE_THINK_CLOSE_TAG = "</think>";
const PI_WEB_SEARCH_MARKER_PREFIX = "\uE000metidos:web-search:";
const PI_WEB_SEARCH_MARKER_SUFFIX = "\uE001";
const PI_WEB_SEARCH_MARKER_BODY_PATTERN = /^[A-Za-z0-9_-]+$/u;

type PiAssistantInlineThinkingSections = {
  chatText: string;
  reasoningText: string;
};

export type PiAssistantWebSearchUpdate = {
  id: string;
  query: string;
  state: "in_progress" | "completed" | "stopped";
};

export function extractPiTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const candidate = block as { text?: unknown; type?: unknown };
      if (
        candidate.type !== "text" ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim()
      ) {
        return [];
      }
      return [candidate.text];
    })
    .join("\n\n");
}

type EncodedPiWebSearchMarker = {
  id?: unknown;
  query?: unknown;
  state?: unknown;
};

function decodePiWebSearchMarker(
  encoded: string,
): PiAssistantWebSearchUpdate | null {
  if (!PI_WEB_SEARCH_MARKER_BODY_PATTERN.test(encoded)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as EncodedPiWebSearchMarker;
    if (typeof decoded.id !== "string" || !decoded.id.trim()) {
      return null;
    }
    if (typeof decoded.query !== "string" || !decoded.query.trim()) {
      return null;
    }
    if (
      decoded.state !== "in_progress" &&
      decoded.state !== "completed" &&
      decoded.state !== "stopped"
    ) {
      return null;
    }
    return {
      id: decoded.id,
      query: decoded.query,
      state: decoded.state,
    };
  } catch {
    return null;
  }
}

type PiWebSearchMarkerSpan = {
  end: number;
  start: number;
  update: PiAssistantWebSearchUpdate | null;
};

function readPiWebSearchMarkerSpan(
  text: string,
  start: number,
): PiWebSearchMarkerSpan | null {
  if (!text.startsWith(PI_WEB_SEARCH_MARKER_PREFIX, start)) {
    return null;
  }

  const bodyStart = start + PI_WEB_SEARCH_MARKER_PREFIX.length;
  const suffixIndex = text.indexOf(PI_WEB_SEARCH_MARKER_SUFFIX, bodyStart);
  if (suffixIndex >= 0) {
    const encoded = text.slice(bodyStart, suffixIndex);
    const update = decodePiWebSearchMarker(encoded);
    return {
      end: suffixIndex + PI_WEB_SEARCH_MARKER_SUFFIX.length,
      start,
      update,
    };
  }

  let bodyEnd = bodyStart;
  while (bodyEnd < text.length) {
    const character = text[bodyEnd];
    if (!character || !/[A-Za-z0-9_-]/u.test(character)) {
      break;
    }
    bodyEnd += 1;
  }

  const encoded = text.slice(bodyStart, bodyEnd);
  const update = decodePiWebSearchMarker(encoded);
  if (update) {
    return {
      end: bodyEnd,
      start,
      update,
    };
  }

  return {
    end: bodyEnd,
    start,
    update: null,
  };
}

function findPiWebSearchMarkerSpans(text: string): PiWebSearchMarkerSpan[] {
  const spans: PiWebSearchMarkerSpan[] = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const markerStart = text.indexOf(PI_WEB_SEARCH_MARKER_PREFIX, searchStart);
    if (markerStart < 0) {
      break;
    }

    const span = readPiWebSearchMarkerSpan(text, markerStart);
    if (!span) {
      searchStart = markerStart + PI_WEB_SEARCH_MARKER_PREFIX.length;
      continue;
    }

    spans.push(span);
    searchStart = Math.max(span.end, markerStart + 1);
  }

  return spans;
}

export function encodePiWebSearchMarker(
  update: PiAssistantWebSearchUpdate,
): string {
  return `${PI_WEB_SEARCH_MARKER_PREFIX}${Buffer.from(
    JSON.stringify(update),
    "utf8",
  ).toString("base64url")}${PI_WEB_SEARCH_MARKER_SUFFIX}`;
}

export function extractPiAssistantWebSearchUpdates(
  text: string,
): PiAssistantWebSearchUpdate[] {
  const updates: PiAssistantWebSearchUpdate[] = [];
  for (const span of findPiWebSearchMarkerSpans(text)) {
    if (span.update) {
      updates.push(span.update);
    }
  }
  return updates;
}

export function stripPiAssistantWebSearchMarkers(text: string): string {
  const spans = findPiWebSearchMarkerSpans(text);
  if (spans.length === 0) {
    const trailingPrefixLength = trailingTokenPrefixLength(
      text,
      PI_WEB_SEARCH_MARKER_PREFIX,
    );
    return trailingPrefixLength > 0
      ? text.slice(0, text.length - trailingPrefixLength)
      : text;
  }

  let stripped = "";
  let cursor = 0;
  for (const span of spans) {
    stripped += text.slice(cursor, span.start);
    cursor = span.end;
  }
  stripped += text.slice(cursor);

  const trailingPrefixLength = trailingTokenPrefixLength(
    stripped,
    PI_WEB_SEARCH_MARKER_PREFIX,
  );
  return trailingPrefixLength > 0
    ? stripped.slice(0, stripped.length - trailingPrefixLength)
    : stripped;
}

function extractRawPiAssistantMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const candidate = message as {
    content?: string | unknown[];
  };
  if (typeof candidate.content === "string") {
    return candidate.content;
  }
  return extractPiTextContent(candidate.content);
}

function trailingTokenPrefixLength(value: string, token: string): number {
  const maxLength = Math.min(value.length, token.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    if (value.endsWith(token.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

export function splitPiAssistantInlineThinkingText(
  text: string,
  options?: {
    finalize?: boolean;
  },
): PiAssistantInlineThinkingSections {
  const finalize = options?.finalize ?? false;
  const leadingWhitespace = text.match(/^\s*/u)?.[0] ?? "";
  const trimmedStart = text.slice(leadingWhitespace.length);

  if (!trimmedStart) {
    return {
      chatText: text,
      reasoningText: "",
    };
  }

  const startsWithInlineThinking =
    trimmedStart.startsWith(INLINE_THINK_OPEN_TAG) ||
    (!finalize && INLINE_THINK_OPEN_TAG.startsWith(trimmedStart));
  if (!startsWithInlineThinking) {
    return {
      chatText: text,
      reasoningText: "",
    };
  }

  if (!trimmedStart.startsWith(INLINE_THINK_OPEN_TAG)) {
    return {
      chatText: "",
      reasoningText: "",
    };
  }

  let remaining = trimmedStart.slice(INLINE_THINK_OPEN_TAG.length);
  let chatText = "";
  let reasoningText = "";
  let mode: "chat" | "reasoning" = "reasoning";

  while (remaining) {
    if (mode === "reasoning") {
      const closeTagIndex = remaining.indexOf(INLINE_THINK_CLOSE_TAG);
      if (closeTagIndex >= 0) {
        reasoningText += remaining.slice(0, closeTagIndex);
        remaining = remaining.slice(
          closeTagIndex + INLINE_THINK_CLOSE_TAG.length,
        );
        mode = "chat";
        continue;
      }

      if (finalize) {
        reasoningText += remaining;
        break;
      }

      const trailingClosePrefixLength = trailingTokenPrefixLength(
        remaining,
        INLINE_THINK_CLOSE_TAG,
      );
      reasoningText += remaining.slice(
        0,
        remaining.length - trailingClosePrefixLength,
      );
      break;
    }

    const openTagIndex = remaining.indexOf(INLINE_THINK_OPEN_TAG);
    if (openTagIndex >= 0) {
      chatText += remaining.slice(0, openTagIndex);
      remaining = remaining.slice(openTagIndex + INLINE_THINK_OPEN_TAG.length);
      mode = "reasoning";
      continue;
    }

    if (finalize) {
      chatText += remaining;
      break;
    }

    const trailingOpenPrefixLength = trailingTokenPrefixLength(
      remaining,
      INLINE_THINK_OPEN_TAG,
    );
    chatText += remaining.slice(0, remaining.length - trailingOpenPrefixLength);
    break;
  }

  return {
    chatText,
    reasoningText,
  };
}

export function extractPiAssistantMessageText(message: unknown): string {
  return splitPiAssistantInlineThinkingText(
    stripPiAssistantWebSearchMarkers(extractRawPiAssistantMessageText(message)),
    {
      finalize: true,
    },
  ).chatText;
}

export function extractPiAssistantThinkingText(message: unknown): string {
  return splitPiAssistantInlineThinkingText(
    stripPiAssistantWebSearchMarkers(extractRawPiAssistantMessageText(message)),
    {
      finalize: true,
    },
  ).reasoningText;
}

export function extractPiAssistantErrorMessage(
  message: unknown,
): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const candidate = message as {
    errorMessage?: unknown;
    stopReason?: unknown;
  };
  if (candidate.stopReason !== "error") {
    return null;
  }

  return typeof candidate.errorMessage === "string" &&
    candidate.errorMessage.trim()
    ? candidate.errorMessage.trim()
    : null;
}

export function extractPiAssistantStopReason(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const stopReason = (message as { stopReason?: unknown }).stopReason;
  return typeof stopReason === "string" && stopReason.trim()
    ? stopReason.trim()
    : null;
}

export function extractPiAssistantUsage(
  message: unknown,
): RpcThreadUsage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const usage = (message as { usage?: Record<string, unknown> }).usage;
  if (!usage) {
    return null;
  }

  const inputTokens =
    typeof usage.input === "number" && Number.isFinite(usage.input)
      ? usage.input
      : null;
  const cachedInputTokens =
    typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead)
      ? usage.cacheRead
      : null;
  const outputTokens =
    typeof usage.output === "number" && Number.isFinite(usage.output)
      ? usage.output
      : null;

  if (
    inputTokens === null &&
    cachedInputTokens === null &&
    outputTokens === null
  ) {
    return null;
  }

  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: cachedInputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

export function extractPiMessageTimestamp(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const timestamp = (message as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? timestamp
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractPluginTypedToolOutput(value: Record<string, unknown>): string {
  if (value.type === "text" && typeof value.text === "string") {
    return value.text;
  }
  if (value.type === "markdown" && typeof value.markdown === "string") {
    return value.markdown;
  }
  if (value.type === "image:url" && typeof value.url === "string") {
    const alt = typeof value.alt === "string" && value.alt ? value.alt : null;
    return alt ? `Plugin image URL (${alt}): ${value.url}` : value.url;
  }
  if (value.type === "image:file" && typeof value.path === "string") {
    const alt = typeof value.alt === "string" && value.alt ? value.alt : null;
    return alt ? `Plugin image file (${alt}): ${value.path}` : value.path;
  }
  return "";
}

function extractPiToolExecutionOutputFromRecord(
  value: Record<string, unknown>,
  depth: number,
): string {
  const contentText = extractPiTextContent(value.content);
  if (contentText) {
    return contentText;
  }

  if (typeof value.content === "string") {
    return value.content;
  }

  const typedToolOutput = extractPluginTypedToolOutput(value);
  if (typedToolOutput) {
    return typedToolOutput;
  }

  if (depth <= 0) {
    return "";
  }

  if (isRecord(value.result)) {
    const nestedResult = extractPiToolExecutionOutputFromRecord(
      value.result,
      depth - 1,
    );
    if (nestedResult) {
      return nestedResult;
    }
  }

  if (isRecord(value.details) && isRecord(value.details.result)) {
    return extractPiToolExecutionOutputFromRecord(
      value.details.result,
      depth - 1,
    );
  }

  return "";
}

export function extractPiToolExecutionOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (!isRecord(value)) {
    return "";
  }

  return extractPiToolExecutionOutputFromRecord(value, 2);
}
