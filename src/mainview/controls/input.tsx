/**
 * @file src/mainview/controls/input.tsx
 * @description Shared application input primitives.
 */

import { forwardRef, type InputHTMLAttributes } from "react";

type AppInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Shared escape hatch for controls that own a specialized class recipe. */
  unstyled?: boolean;
};

export type AppTextInputProps = AppInputProps & {
  monospace?: boolean;
};

export type AppColorInputProps = AppInputProps;

const inputBaseClassName =
  "border border-border-default bg-surface-2 text-text-secondary outline-none transition-colors focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/25 disabled:cursor-not-allowed disabled:opacity-60";

export const AppTextInput = forwardRef<HTMLInputElement, AppTextInputProps>(
  function AppTextInput(
    { className = "", monospace = false, unstyled = false, ...props },
    ref,
  ) {
    if (unstyled) {
      return <input {...props} className={className} ref={ref} />;
    }

    return (
      <input
        {...props}
        className={[
          "h-8 w-full px-2 text-xs",
          inputBaseClassName,
          monospace ? "font-mono" : "",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
      />
    );
  },
);

export const AppColorInput = forwardRef<HTMLInputElement, AppColorInputProps>(
  function AppColorInput({ className = "", unstyled = false, ...props }, ref) {
    if (unstyled) {
      return <input {...props} className={className} ref={ref} />;
    }

    return (
      <input
        {...props}
        className={["h-8 w-14 p-1", inputBaseClassName, className]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        type="color"
      />
    );
  },
);
