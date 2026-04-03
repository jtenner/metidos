import type { ChangeEvent, JSX } from "react";
import { materialSymbol } from "./icons";

/**
 * Props for the sidebar search input component.
 */
type SidebarSearchControlProps = {
  /** Fired whenever the user types or edits the search query. */
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  /** Clears the current search text and hides the clear button. */
  onClear: () => void;
  /** The current raw query string rendered in the input. */
  value: string;
};

/**
 * Render the search field in the workspace/project sidebar.
 *
 * The control intentionally stays visually compact and keyboard-friendly while
 * handling two states:
 * - empty query: only search icon + input
 * - non-empty query: search icon + input + clear button
 */
export function SidebarSearchControl({
  onChange,
  onClear,
  value,
}: SidebarSearchControlProps): JSX.Element {
  return (
    <label className="block">
      <span className="sr-only">Search projects and worktrees</span>
      <div className="flex items-center gap-2 border border-[#2c363c] bg-[#101214] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]">
        {materialSymbol("search", "text-[16px] text-[#98b9d0]")}
        <input
          className="min-w-0 flex-1 select-text bg-transparent text-[13px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
          placeholder="Search projects and worktrees..."
          value={value}
          onChange={onChange}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        {/* Show clear action only for non-empty query to avoid accidental clears. */}
        {value ? (
          <button
            type="button"
            className="flex h-5 w-5 items-center justify-center text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
            onClick={onClear}
            aria-label="Clear sidebar search"
          >
            ×
          </button>
        ) : null}
      </div>
    </label>
  );
}
