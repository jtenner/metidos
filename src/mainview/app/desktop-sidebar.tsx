/**
 * @file src/mainview/app/desktop-sidebar.tsx
 * @description Module for desktop sidebar.
 */

import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { AppButton } from "../controls/button";
import { materialSymbol } from "../controls/icons";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";

// Width constants and the 16px resize step below all stay on the 4px spacing grid.
const DEFAULT_SIDEBAR_WIDTH_PX = 336; // 21rem
const MIN_SIDEBAR_WIDTH_PX = 256; // 16rem
const MAX_SIDEBAR_WIDTH_PX = 480; // 30rem

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
  const [width, setWidth] = useState(DEFAULT_SIDEBAR_WIDTH_PX);
  const [isResizing, setIsResizing] = useState(false);
  const collapsedRef = useRef(initialCollapsed);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH_PX);

  /**
   * Internal transition helper that keeps local UI state and parent handler in sync.
   */
  const updateCollapsed = useCallback(
    (nextCollapsed: boolean): void => {
      // Pointer/key resize handlers can fire during the collapse transition; the
      // ref gives them the latest state before React commits the next render.
      collapsedRef.current = nextCollapsed;
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

  const handleResizeStart = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (collapsedRef.current) return;
      event.preventDefault();
      setIsResizing(true);
      resizeStartXRef.current = event.clientX;
      resizeStartWidthRef.current = width;
    },
    [width],
  );

  const handleResizeKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (collapsedRef.current) {
        return;
      }

      const resizeStepPx = 16;
      switch (event.key) {
        case "ArrowLeft":
          event.preventDefault();
          setWidth((currentWidth) =>
            Math.max(MIN_SIDEBAR_WIDTH_PX, currentWidth - resizeStepPx),
          );
          return;
        case "ArrowRight":
          event.preventDefault();
          setWidth((currentWidth) =>
            Math.min(MAX_SIDEBAR_WIDTH_PX, currentWidth + resizeStepPx),
          );
          return;
        case "Home":
          event.preventDefault();
          setWidth(MIN_SIDEBAR_WIDTH_PX);
          return;
        case "End":
          event.preventDefault();
          setWidth(MAX_SIDEBAR_WIDTH_PX);
          return;
        default:
          return;
      }
    },
    [],
  );

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: MouseEvent): void => {
      const delta = event.clientX - resizeStartXRef.current;
      const nextWidth = Math.min(
        MAX_SIDEBAR_WIDTH_PX,
        Math.max(MIN_SIDEBAR_WIDTH_PX, resizeStartWidthRef.current + delta),
      );
      setWidth(nextWidth);
    };

    const handleMouseUp = (): void => {
      setIsResizing(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const asideClassName = useDynamicCssVariablesClassName(
    {
      "--desktop-sidebar-width": collapsed ? undefined : `${width}px`,
    },
    {
      className: `desktop-sidebar relative min-h-0 shrink-0 overflow-visible border-r border-border-subtle bg-bg-canvas ${
        collapsed ? "w-14" : ""
      } ${isResizing ? "" : "transition-[width] duration-300"}`,
      prefix: "desktop-sidebar-vars",
    },
  );

  return (
    <aside className={asideClassName}>
      <div
        aria-hidden={collapsed}
        // Expanded panel receives interactions and is invisible/click-through when collapsed.
        className={`absolute inset-y-0 left-0 flex w-full flex-col transition-opacity duration-150 ${
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
        {/* Expand trigger */}
        <div className="flex items-center justify-center border-b border-border-subtle px-2 py-3">
          <AppButton
            aria-label="Expand sidebar"
            buttonStyle="muted"
            iconOnly
            onClick={expandSidebar}
          >
            {materialSymbol("menu", "text-[20px]")}
          </AppButton>
        </div>

        {/* Section hint icons — each expands the sidebar. */}
        <div className="flex flex-1 flex-col items-center gap-1 py-2">
          <AppButton
            aria-label="Expand sidebar — Threads"
            buttonStyle="muted"
            iconOnly
            onClick={expandSidebar}
            title="Threads"
          >
            {materialSymbol("chat_bubble", "text-[18px]")}
          </AppButton>
          <AppButton
            aria-label="Expand sidebar — Git History"
            buttonStyle="muted"
            iconOnly
            onClick={expandSidebar}
            title="Git History"
          >
            {materialSymbol("history", "text-[18px]")}
          </AppButton>
        </div>
      </div>

      {/* Resize handle */}
      {!collapsed && (
        <AppButton
          unstyled
          type="button"
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemax={MAX_SIDEBAR_WIDTH_PX}
          aria-valuemin={MIN_SIDEBAR_WIDTH_PX}
          aria-valuenow={width}
          className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize appearance-none bg-transparent p-0 transition-colors hover:bg-accent/30 focus-visible:bg-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1"
          role="separator"
          onKeyDown={handleResizeKeyDown}
          onMouseDown={handleResizeStart}
          title="Resize sidebar"
        />
      )}
    </aside>
  );
}
