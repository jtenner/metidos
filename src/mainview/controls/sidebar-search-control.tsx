/**
 * @file src/mainview/controls/sidebar-search-control.tsx
 * @description Module for sidebar search control.
 */

import { type ChangeEvent, type JSX, memo, useCallback } from "react";
import { AppButton } from "./button";
import { materialSymbol } from "./icons";

/**
 * Return whether a native input event should update the controlled sidebar
 * query. Non-focused changes are usually browser/password-manager autofill or
 * form restoration rather than an intentional search edit.
 */
export function shouldAcceptSidebarSearchInputChange(
  input: HTMLInputElement,
): boolean {
  return typeof document === "undefined" || document.activeElement === input;
}

/**
 * Props for the sidebar search input component.
 */
type SidebarSearchControlProps = {
  /** Fired whenever the user types or edits the search query. */
  onValueChange: (value: string) => void;
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
export const SidebarSearchControl = memo(function SidebarSearchControl({
  onValueChange,
  value,
}: SidebarSearchControlProps): JSX.Element {
  const handleSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const input = event.currentTarget;
      if (!shouldAcceptSidebarSearchInputChange(input)) {
        // Browsers and password managers can silently autofill nearby text
        // inputs with the signed-in username. The sidebar query should only
        // change from intentional, focused search edits.
        input.value = value;
        return;
      }

      onValueChange(input.value);
    },
    [onValueChange, value],
  );
  const clearSearch = useCallback((): void => {
    onValueChange("");
  }, [onValueChange]);

  return (
    <label className="block">
      <span className="sr-only">Search projects and worktrees</span>
      <div className="flex items-center gap-2 border border-border-default bg-surface-1 px-3 py-2">
        {materialSymbol("search", "text-[17px] text-accent")}
        <input
          aria-label="Search projects and worktrees"
          className="min-w-0 flex-1 select-text bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-faint focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring"
          type="search"
          name="metidos-sidebar-search-query"
          placeholder="Search projects and worktrees..."
          value={value}
          onChange={handleSearchChange}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          // This is a plain filter input, not an autocomplete widget: it does
          // not render or manage an owned suggestion listbox.
          aria-autocomplete="none"
          data-1p-ignore="true"
          data-form-type="other"
          data-lpignore="true"
        />
        {/* Show clear action only for non-empty query to avoid accidental clears. */}
        {value ? (
          <AppButton
            type="button"
            buttonStyle="muted"
            className="h-7 w-7 border-transparent bg-transparent"
            iconOnly
            onClick={clearSearch}
            aria-label="Clear sidebar search"
          >
            {materialSymbol("close", "text-[15px]")}
          </AppButton>
        ) : null}
      </div>
    </label>
  );
});
