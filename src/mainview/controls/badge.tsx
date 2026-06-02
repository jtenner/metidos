/**
 * @file src/mainview/controls/badge.tsx
 * @description Shared compact status badge primitive.
 */

import type { HTMLAttributes, JSX, ReactNode } from "react";

export type AppBadgeTone = "danger" | "info" | "muted" | "success" | "warning";

export type AppBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  tone?: AppBadgeTone;
};

const toneClassNames: Record<AppBadgeTone, string> = {
  danger: "border-danger-border bg-danger-surface text-danger-text",
  info: "border-info-border bg-info-surface text-info-text",
  muted: "border-border-default bg-surface-2 text-text-secondary",
  success: "border-success-border bg-success-surface text-success-text",
  warning: "border-warning-border bg-warning-surface text-warning-text",
};

export function AppBadge({
  children,
  className = "",
  tone = "muted",
  ...props
}: AppBadgeProps): JSX.Element {
  return (
    <span
      {...props}
      className={[
        "inline-flex shrink-0 items-center border px-2 py-1 font-label text-[10px] font-semibold uppercase tracking-[0.1em]",
        toneClassNames[tone],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </span>
  );
}
