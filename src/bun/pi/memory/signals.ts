/**
 * @file src/bun/pi/memory/signals.ts
 * @description Deterministic signal extraction from immutable memory evidence.
 */

import type { MemorySignalInput } from "./types";

type SignalPattern = {
  kind: string;
  regex: RegExp;
  normalize?: (value: string) => string;
};

const SIGNAL_PATTERNS: SignalPattern[] = [
  {
    kind: "url",
    regex: /https?:\/\/[^\s)\]}>"']+/giu,
    normalize: (value) => value.toLowerCase(),
  },
  { kind: "ip", regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu },
  {
    kind: "date",
    regex: /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?)?\b/gu,
  },
  {
    kind: "date",
    regex:
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s*\d{4}\b/giu,
    normalize: (value) => value.toLowerCase(),
  },
  { kind: "money", regex: /\$\s?\d+(?:,\d{3})*(?:\.\d+)?\b/gu },
  { kind: "percent", regex: /\b\d+(?:\.\d+)?%(?=$|\s|[),.;:])/gu },
  {
    kind: "version",
    regex: /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/gu,
    normalize: (value) => value.toLowerCase(),
  },
  {
    kind: "quote",
    regex: /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/gu,
    normalize: (value) => value.slice(1, -1),
  },
  {
    kind: "file_path",
    regex:
      /(?:^|\s)((?:\.\.?\/|\/)?(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+)(?=$|\s|[),.;:])/gu,
    normalize: (value) => value.trim(),
  },
  {
    kind: "identifier",
    regex:
      /\b[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|::[A-Za-z_$][A-Za-z0-9_$]*|#[A-Za-z_$][A-Za-z0-9_$]*)+\b/gu,
  },
  {
    kind: "identifier",
    regex: /\b[A-Za-z][A-Za-z0-9_-]+@[A-Za-z0-9_.-]+\b/gu,
    normalize: (value) => value.toLowerCase(),
  },
  {
    kind: "negation",
    regex:
      /\b(?:not|never|no|without|isn't|aren't|don't|doesn't|can't|won't|shouldn't)\b/giu,
    normalize: (value) => value.toLowerCase(),
  },
  {
    kind: "correction",
    regex:
      /\b(?:instead|correction|corrected|actually|rather than|replace|changed to|updated to)\b/giu,
    normalize: (value) => value.toLowerCase(),
  },
];

function pushMatches(
  signals: MemorySignalInput[],
  text: string,
  pattern: SignalPattern,
): void {
  for (const match of text.matchAll(pattern.regex)) {
    const matched =
      match[1] && pattern.kind === "file_path" ? match[1] : match[0];
    const start = match.index ?? text.indexOf(matched);
    const adjustedStart =
      pattern.kind === "file_path" && match[1]
        ? start + match[0].indexOf(match[1])
        : start;
    signals.push({
      kind: pattern.kind,
      value: matched,
      normalizedValue: pattern.normalize?.(matched) ?? matched.toLowerCase(),
      startOffset: adjustedStart,
      endOffset: adjustedStart + matched.length,
      confidence: 1,
    });
  }
}

export function extractMemorySignals(text: string): MemorySignalInput[] {
  const signals: MemorySignalInput[] = [];
  for (const pattern of SIGNAL_PATTERNS) {
    pushMatches(signals, text, pattern);
  }

  const seen = new Set<string>();
  return signals.filter((signal) => {
    const key = `${signal.kind}:${signal.startOffset}:${signal.endOffset}:${signal.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeSignals(
  signals: readonly MemorySignalInput[],
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const signal of signals)
    summary[signal.kind] = (summary[signal.kind] ?? 0) + 1;
  return summary;
}
