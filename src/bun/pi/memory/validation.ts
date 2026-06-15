/**
 * @file src/bun/pi/memory/validation.ts
 * @description Deterministic validation for derived memory facts.
 */

import { extractMemorySignals } from "./signals";
import type {
  MemoryFactCandidate,
  MemorySignalInput,
  MemoryValidationResult,
} from "./types";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "that",
  "this",
  "with",
  "from",
  "are",
  "was",
  "were",
  "will",
  "shall",
  "should",
  "using",
  "use",
  "into",
  "about",
  "when",
  "then",
  "than",
  "have",
  "has",
  "had",
  "our",
  "their",
  "there",
  "here",
  "not",
  "but",
  "can",
  "cannot",
  "does",
  "did",
  "done",
  "fact",
  "decision",
]);

function words(value: string): string[] {
  return (
    value
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9_-]{2,}/gu)
      ?.filter((word) => !STOP_WORDS.has(word)) ?? []
  );
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function hardAnchors(
  statement: string,
): Array<{ value: string; kind: string }> {
  return extractMemorySignals(statement)
    .filter((signal) => !["negation", "correction"].includes(signal.kind))
    .map((signal) => ({ value: signal.value, kind: signal.kind }));
}

function hasNegation(value: string): boolean {
  return /\b(?:not|never|no|without|isn't|aren't|don't|doesn't|can't|won't|shouldn't)\b/iu.test(
    value,
  );
}

function lexicalSupportScore(statement: string, evidence: string): number {
  const statementWords = words(statement);
  if (statementWords.length === 0) return 0;
  const evidenceWords = new Set(words(evidence));
  const supported = statementWords.filter((word) =>
    evidenceWords.has(word),
  ).length;
  return supported / statementWords.length;
}

export function validateMemoryFact(input: {
  candidate: MemoryFactCandidate;
  evidenceText: string;
  evidenceSignals?: MemorySignalInput[];
  knownContextEntities?: string[];
}): MemoryValidationResult {
  const evidenceSignals =
    input.evidenceSignals ?? extractMemorySignals(input.evidenceText);
  const evidenceText = input.evidenceText;
  const candidate = input.candidate;
  const anchors = hardAnchors(candidate.statement).map((anchor) => ({
    ...anchor,
    present:
      includesLoose(evidenceText, anchor.value) ||
      evidenceSignals.some(
        (signal) =>
          signal.value === anchor.value ||
          signal.normalizedValue === anchor.value.toLowerCase(),
      ),
  }));
  const missingAnchors = anchors.filter((anchor) => !anchor.present);
  const score = lexicalSupportScore(candidate.statement, evidenceText);
  const scopeEntity = candidate.scopeEntity?.trim() ?? "";
  const contextEntities = input.knownContextEntities ?? [];
  const subjectGrounded =
    !scopeEntity ||
    includesLoose(evidenceText, scopeEntity) ||
    contextEntities.some((entity) => entity === scopeEntity);
  const negationConflict =
    hasNegation(evidenceText) !== hasNegation(candidate.statement) &&
    words(candidate.statement).some((word) =>
      words(evidenceText).includes(word),
    );
  const correctionIntent = evidenceSignals.some(
    (signal) => signal.kind === "correction",
  );
  const reasons: string[] = [];
  if (missingAnchors.length > 0) reasons.push("missing_hard_anchor");
  if (score < 0.35) reasons.push("insufficient_lexical_support");
  if (!subjectGrounded) reasons.push("ungrounded_subject");
  if (negationConflict) reasons.push("negation_conflict");

  return {
    accepted: reasons.length === 0,
    confidence: Math.max(0, Math.min(1, score)),
    diagnostics: {
      hardAnchors: anchors,
      lexicalSupportScore: score,
      subjectGrounded,
      negationConflict,
      correctionIntent,
      reasons,
    },
  };
}
