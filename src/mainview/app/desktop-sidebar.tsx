/**
 * @file src/mainview/app/desktop-sidebar.tsx
 * @description Module for desktop sidebar.
 */

import { type JSX, useCallback, useState } from "react";
import { materialSymbol } from "../controls/icons";

type DesktopSidebarProps = {
  initialCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  renderExpandedContent: (collapseSidebar: () => void) => JSX.Element;
};

/**
 * Sidebar container with two rendering modes:
 * - expanded content area (full width, interactive content)
 * - collapsed rail (compact icon strip + expand control)
 * `initialCollapsed` seeds local state and updates are echoed back via callback.
 */
export function DesktopSidebar({
  initialCollapsed,
  onCollapsedChange,
  renderExpandedContent,
}: DesktopSidebarProps): JSX.Element {
  // Local collapsed state allows animation before parent state catches up via callback.
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  /**
   * Internal transition helper that keeps local UI state and parent handler in sync.
   */
  const updateCollapsed = useCallback(
    (nextCollapsed: boolean): void => {
      setCollapsed(nextCollapsed);
      onCollapsedChange(nextCollapsed);
    },
    [onCollapsedChange],
  );

  const collapseSidebar = useCallback((): void => {
    updateCollapsed(true);
  }, [updateCollapsed]);

  // Shared handler passed to child content so it can request collapse directly.
  const expandSidebar = useCallback((): void => {
    updateCollapsed(false);
  }, [updateCollapsed]);

  return (
    <aside
      className={`relative min-h-0 shrink-0 overflow-visible border-r border-[#262626] bg-[#131313] transition-[width] duration-300 ${
        collapsed ? "w-14" : "w-[21rem]"
      }`}
      style={{
        willChange: "width",
      }}
    >
      <div
        aria-hidden={collapsed}
        // Expanded panel receives interactions and is invisible/click-through when collapsed.
        className={`absolute inset-y-0 left-0 flex w-[21rem] flex-col transition-opacity duration-150 ${
          collapsed ? "pointer-events-none invisible opacity-0" : "opacity-100"
        }`}
      >
        {renderExpandedContent(collapseSidebar)}
      </div>
      <div
        aria-hidden={!collapsed}
        // Collapsed rail appears only in collapsed mode; expanded mode keeps it hidden.
        className={`absolute inset-y-0 left-0 flex w-14 flex-col transition-opacity duration-150 ${
          collapsed ? "opacity-100" : "pointer-events-none invisible opacity-0"
        }`}
      >
        <div className="flex flex-1 flex-col items-center gap-3 px-2 py-4">
          {/* This button is always present in collapsed mode to allow one-click expansion. */}
          <button
            type="button"
            aria-label="Expand sidebar"
            className="flex h-9 w-9 items-center justify-center border border-[#2f3b43] bg-[#182026] text-[#bdd5e6] transition-colors hover:bg-[#212b31]"
            onClick={expandSidebar}
          >
            {materialSymbol("chevron_right", "text-[18px]")}
          </button>
          <div className="flex h-9 w-9 items-center justify-center bg-[#1b2a34] text-[#7aa5c4]">
            {materialSymbol("folder", "text-[18px]")}
          </div>
        </div>
      </div>
    </aside>
  );
}
