/**
 * @file src/bun/project-procedures/pi-sdk-shapes.ts
 * @description Shared Pi SDK payload-shape helpers for projection and telemetry.
 */

import type { RpcThreadUsage } from "../rpc-schema";

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

export function extractPiAssistantMessageText(message: unknown): string {
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

export function extractPiToolExecutionOutput(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  return extractPiTextContent((value as { content?: unknown }).content);
}
