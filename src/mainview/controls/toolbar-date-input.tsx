/**
 * @file src/mainview/controls/toolbar-date-input.tsx
 * @description Shared date input styled as a compact toolbar control.
 */

import { forwardRef, type InputHTMLAttributes } from "react";
import { mergeClassNames } from "../dynamic-styles";

type ToolbarDateInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Allow toolbar layouts to make the control fill available inline space. */
  fullWidth?: boolean;
};

const toolbarDateInputClassName =
  "toolbar-date-input h-8 min-w-[8.5rem] shrink-0 border border-border-default bg-surface-2 px-3 text-[13px] font-medium leading-none text-text-primary transition-colors hover:border-border-strong hover:bg-surface-3 focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Native date input normalized to the same 32px height and chrome as AppButton.
 */
export const ToolbarDateInput = forwardRef<
  HTMLInputElement,
  ToolbarDateInputProps
>(function ToolbarDateInput(
  { className = "", fullWidth = false, ...props },
  ref,
) {
  return (
    <input
      aria-label="Date"
      {...props}
      className={mergeClassNames(
        toolbarDateInputClassName,
        fullWidth && "w-full",
        className,
      )}
      ref={ref}
      type="date"
    />
  );
});
