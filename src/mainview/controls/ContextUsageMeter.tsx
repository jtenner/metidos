import type { JSX } from "react";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";

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
  const progressClassName = useDynamicCssVariablesClassName(
    {
      "--context-usage-progress-deg": `${progress * 360}deg`,
    },
    {
      className: "context-usage-progress absolute inset-[1px] rounded-full",
      prefix: "context-usage-progress-vars",
    },
  );

  return (
    <div className="shrink-0 rotate-90">
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
          className="absolute inset-0 rounded-full border border-border-default"
        >
          <div className={progressClassName} />
          <div className="absolute inset-[4px] rounded-full bg-bg-app" />
        </div>
      </div>
    </div>
  );
}
