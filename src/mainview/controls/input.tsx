/**
 * @file src/mainview/controls/input.tsx
 * @description Shared application input primitives.
 */

import {
  forwardRef,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";

type AppInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Shared escape hatch for controls that own a specialized class recipe. */
  unstyled?: boolean;
};

export type AppTextInputProps = AppInputProps & {
  monospace?: boolean;
};

export type AppColorInputProps = AppInputProps;
export type AppCheckboxInputProps = AppInputProps;
export type AppSelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;

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

export const AppCheckboxInput = forwardRef<
  HTMLInputElement,
  AppCheckboxInputProps
>(function AppCheckboxInput(
  { className = "", unstyled = false, ...props },
  ref,
) {
  if (unstyled) {
    return <input {...props} className={className} ref={ref} />;
  }

  return (
    <input
      {...props}
      className={[
        "h-4 w-4 shrink-0 accent-accent-strong focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      type="checkbox"
    />
  );
});

export const AppSelectInput = forwardRef<
  HTMLSelectElement,
  AppSelectInputProps
>(function AppSelectInput({ className = "", ...props }, ref) {
  return (
    <select
      {...props}
      className={[
        "h-8 w-full border border-border-default bg-surface-2 px-2 text-xs text-text-secondary outline-none transition-colors focus:border-focus-ring focus:ring-2 focus:ring-focus-ring/25 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
    />
  );
});
