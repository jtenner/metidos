/**
 * @file src/bun/plugin/glob-match.ts
 * @description Shared glob-segment matching helpers for Plugin System v1 policies.
 */

const GLOB_PATTERN_CHARACTERS = /[*?[]/;

export function containsGlobPattern(value: string): boolean {
  return GLOB_PATTERN_CHARACTERS.test(value);
}

export function globSegmentMatches(pattern: string, segment: string): boolean {
  let patternIndex = 0;
  let segmentIndex = 0;
  let starIndex = -1;
  let matchIndex = 0;

  while (segmentIndex < segment.length) {
    const patternChar = pattern[patternIndex];
    if (patternChar === "?" || patternChar === segment[segmentIndex]) {
      patternIndex += 1;
      segmentIndex += 1;
      continue;
    }
    if (patternChar === "*") {
      starIndex = patternIndex;
      matchIndex = segmentIndex;
      patternIndex += 1;
      continue;
    }
    if (starIndex !== -1) {
      patternIndex = starIndex + 1;
      matchIndex += 1;
      segmentIndex = matchIndex;
      continue;
    }
    return false;
  }

  while (pattern[patternIndex] === "*") {
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

/**
 * Match path-like segment arrays where `**` consumes zero or more segments.
 *
 * The matcher memoizes `(patternIndex, candidateIndex)` states so repeated `**`
 * segments cannot create exponential backtracking in policy checks.
 */
export function globSegmentsMatch(
  patternSegments: readonly string[],
  candidateSegments: readonly string[],
): boolean {
  const memo = new Map<string, boolean>();

  const matchAt = (patternIndex: number, candidateIndex: number): boolean => {
    const key = `${patternIndex}:${candidateIndex}`;
    const cached = memo.get(key);
    if (cached !== undefined) {
      return cached;
    }

    let result: boolean;
    if (patternIndex >= patternSegments.length) {
      result = candidateIndex >= candidateSegments.length;
    } else {
      const head = patternSegments[patternIndex] ?? "";
      if (head === "**") {
        result =
          matchAt(patternIndex + 1, candidateIndex) ||
          (candidateIndex < candidateSegments.length &&
            matchAt(patternIndex, candidateIndex + 1));
      } else {
        result =
          candidateIndex < candidateSegments.length &&
          globSegmentMatches(head, candidateSegments[candidateIndex] ?? "") &&
          matchAt(patternIndex + 1, candidateIndex + 1);
      }
    }

    memo.set(key, result);
    return result;
  };

  return matchAt(0, 0);
}
