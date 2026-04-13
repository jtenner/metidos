import type { JSX } from "react";

/**
 * Performs ContextUsageMeter operation.
 * @param inputTokens - inputTokens value.
 * @param contextWindowTokens - contextWindowTokens value.
 */

export function ContextUsageMeter({
  inputTokens,
  contextWindowTokens,
}: {
  inputTokens: number;
  contextWindowTokens: number;
}): JSX.Element {
  const safeContextWindowTokens = Math.max(1, contextWindowTokens);
  const clampedInputTokens = Math.min(
    Math.max(inputTokens, 0),
    safeContextWindowTokens,
  );
  const progress = clampedInputTokens / safeContextWindowTokens;

  // Use conic-gradient ring for compact token usage indicator with accessible <meter> semantics.
  return (
    <div className="shrink-0">
      <div className="relative h-6 w-6">
        <meter
          aria-label="Context usage"
          className="sr-only"
          max={safeContextWindowTokens}
          min={0}
          value={clampedInputTokens}
        >
          {inputTokens.toLocaleString()} of{" "}
          {contextWindowTokens.toLocaleString()} context tokens used
        </meter>
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-full border border-[#31404a]"
        >
          <div
            className="absolute inset-[1px] rounded-full"
            style={{
              background: `conic-gradient(from -90deg, #bdd5e6 0deg ${progress * 360}deg, #24313a ${progress * 360}deg 360deg)`,
            }}
          />
          <div className="absolute inset-[4px] rounded-full bg-[#131313]" />
        </div>
      </div>
    </div>
  );
}
