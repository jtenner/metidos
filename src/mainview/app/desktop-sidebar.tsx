import { type JSX, useCallback, useState } from "react";
import { materialSymbol } from "../controls/icons";

type DesktopSidebarProps = {
  initialCollapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  renderExpandedContent: (collapseSidebar: () => void) => JSX.Element;
};

export function DesktopSidebar({
  initialCollapsed,
  onCollapsedChange,
  renderExpandedContent,
}: DesktopSidebarProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

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

  const expandSidebar = useCallback((): void => {
    updateCollapsed(false);
  }, [updateCollapsed]);

  return (
    <aside
      className={`relative min-h-0 shrink-0 overflow-hidden border-r border-[#262626] bg-[#131313] transition-[width] duration-300 ${
        collapsed ? "w-14" : "w-[18.5rem]"
      }`}
      style={{
        willChange: "width",
      }}
    >
      <div
        aria-hidden={collapsed}
        className={`absolute inset-y-0 left-0 flex w-[18.5rem] flex-col transition-opacity duration-150 ${
          collapsed ? "pointer-events-none invisible opacity-0" : "opacity-100"
        }`}
      >
        {renderExpandedContent(collapseSidebar)}
      </div>
      <div
        aria-hidden={!collapsed}
        className={`absolute inset-y-0 left-0 flex w-14 flex-col transition-opacity duration-150 ${
          collapsed ? "opacity-100" : "pointer-events-none invisible opacity-0"
        }`}
      >
        <div className="flex flex-1 flex-col items-center gap-3 px-2 py-4">
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
