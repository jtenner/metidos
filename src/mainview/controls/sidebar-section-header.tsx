/**
 * @file src/mainview/controls/sidebar-section-header.tsx
 * @description Module for sidebar section header.
 */

import type { JSX, ReactNode } from "react";
import { AppButton } from "./button";
import { materialSymbol } from "./icons";

/**
 * Common props for a sidebar section header with expand/collapse behavior.
 */
type SidebarSectionHeaderProps = {
  /** Optional action button or node rendered at the far right of the header. */
  action?: JSX.Element | null;
  /** Id of the controlled region when the header toggles a collapsible body. */
  controlsId?: string;
  /** Toggle callback fired when the header button is activated. */
  onToggle: () => void;
  /** Whether the section body is currently expanded. */
  open: boolean;
  /** Id applied to the visible title so sections can reference the heading. */
  titleId?: string;
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
  controlsId,
  onToggle,
  open,
  title,
  titleId,
}: SidebarSectionHeaderProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <h2 className="min-w-0 flex-1">
        <AppButton
          unstyled
          type="button"
          className="group flex min-w-0 w-full items-center gap-2 px-1 py-1 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1"
          onClick={onToggle}
          aria-expanded={open}
          {...(controlsId ? { "aria-controls": controlsId } : {})}
        >
          <span
            id={titleId}
            className="min-w-0 font-label text-[11px] font-semibold uppercase tracking-[0.1em] text-accent"
          >
            {title}
          </span>
          <span
            aria-hidden="true"
            className="ml-auto shrink-0 text-text-faint transition-colors group-hover:text-accent-strong"
          >
            {/* Flip icon to reflect current expand/collapse state. */}
            {materialSymbol(
              open ? "expand_more" : "chevron_right",
              "text-[16px]",
            )}
          </span>
        </AppButton>
      </h2>
      {/* Optional contextual action (e.g., add button) sits to the right of header. */}
      {action ?? null}
    </div>
  );
}
