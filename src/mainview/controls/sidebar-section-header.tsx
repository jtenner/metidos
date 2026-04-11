/**
 * @file src/mainview/controls/sidebar-section-header.tsx
 * @description Module for sidebar section header.
 */

import type { JSX, ReactNode } from "react";
import { materialSymbol } from "./icons";

/**
 * Common props for a sidebar section header with expand/collapse behavior.
 */
type SidebarSectionHeaderProps = {
  /** Optional action button or node rendered at the far right of the header. */
  action?: JSX.Element | null;
  /** Toggle callback fired when the header button is activated. */
  onToggle: () => void;
  /** Whether the section body is currently expanded. */
  open: boolean;
  /** Display label for the section; allows rich content from callers. */
  title: ReactNode;
};

/**
 * Reusable sidebar section header row.
 *
 * The component is intentionally minimal: one clickable control toggles section
 * visibility and an optional action slot can host contextual controls.
 */
export function SidebarSectionHeader({
  action,
  onToggle,
  open,
  title,
}: SidebarSectionHeaderProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className="group flex min-w-0 flex-1 items-center gap-2 px-0.5 py-0.5 text-left transition-colors"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="min-w-0 font-label text-[11px] font-bold uppercase tracking-widest text-accent">
          {title}
        </span>
        <span className="ml-auto shrink-0 text-text-faint transition-colors group-hover:text-accent-strong">
          {/* Flip icon to reflect current expand/collapse state. */}
          {materialSymbol(
            open ? "expand_more" : "chevron_right",
            "text-[16px]",
          )}
        </span>
      </button>
      {/* Optional contextual action (e.g., add button) sits to the right of header. */}
      {action ?? null}
    </div>
  );
}
