/**
 * @file src/mainview/controls/status-icon.tsx
 * @description Shared square status marker used for compact state indicators.
 */

import type { JSX } from "react";

export type StatusIconTone =
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";
export type StatusIconSize = "sm" | "md";

export function statusIconToneClassName(tone: StatusIconTone): string {
  switch (tone) {
    case "danger":
      return "bg-danger-text";
    case "info":
      return "bg-info-text";
    case "neutral":
      return "bg-text-faint";
    case "success":
      return "bg-success-text";
    case "warning":
      return "bg-warning-text";
  }
}

function statusIconSizeClassName(size: StatusIconSize): string {
  switch (size) {
    case "sm":
      return "h-2 w-2";
    case "md":
      return "h-3 w-3";
  }
}

export function StatusIcon({
  className = "",
  size = "md",
  tone,
}: {
  className?: string;
  size?: StatusIconSize;
  tone: StatusIconTone;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`block shrink-0 ${statusIconSizeClassName(
        size,
      )} ${statusIconToneClassName(tone)} ${className}`}
    />
  );
}
