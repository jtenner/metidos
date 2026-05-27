/**
 * @file src/mainview/controls/button.tsx
 * @description Shared application button primitive.
 */

import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from "react";

export type AppButtonStyle = "primary" | "secondary" | "muted" | "error";
export type NotificationButtonTone =
  | "danger"
  | "error"
  | "info"
  | "success"
  | "warning";

type BaseButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
};

export type AppButtonProps = BaseButtonProps & {
  /** Visual treatment. Keep this to the four canonical app button styles. */
  buttonStyle?: AppButtonStyle;
  /** Square button for icon-only actions; shares the standard 32px button height. */
  iconOnly?: boolean;
  /** Allow dropdown/select triggers to fill their container while preserving button sizing. */
  fullWidth?: boolean;
  /** Shared escape hatch for row, tab, and custom semantic button surfaces that own their full class recipe. */
  unstyled?: boolean;
};

export type IconButtonProps = Omit<AppButtonProps, "iconOnly">;

export type TabButtonProps = BaseButtonProps & {
  selected: boolean;
};

export type ListOptionButtonProps = BaseButtonProps & {
  selected?: boolean;
};

export type NotificationButtonProps = BaseButtonProps & {
  tone?: NotificationButtonTone;
};

export function notificationButtonToneClassName(
  tone: NotificationButtonTone,
): string {
  const toneClassName: Record<NotificationButtonTone, string> = {
    danger: "border-danger-border bg-danger-surface text-danger-text",
    error: "border-danger-border bg-danger-surface text-danger-text",
    info: "border-info-border bg-info-surface text-info-text",
    success: "border-success-border bg-success-surface text-success-text",
    warning: "border-warning-border bg-warning-surface text-warning-text",
  };

  return toneClassName[tone];
}

const styleClassNames: Record<AppButtonStyle, string> = {
  primary:
    "border-text-primary bg-text-primary text-bg-app hover:border-accent-strong hover:bg-accent-strong",
  secondary:
    "border-border-default bg-surface-2 text-text-primary hover:border-border-strong hover:bg-surface-3",
  muted:
    "border-border-subtle bg-surface-1 text-text-secondary hover:border-border-default hover:bg-surface-2 hover:text-text-primary",
  error:
    "border-danger-border bg-danger-surface text-danger-text hover:border-danger-text hover:bg-danger-border hover:text-text-primary",
};

export const AppButton = forwardRef<HTMLButtonElement, AppButtonProps>(
  function AppButton(
    {
      buttonStyle = "secondary",
      children,
      className = "",
      fullWidth = false,
      iconOnly = false,
      type = "button",
      unstyled = false,
      ...props
    },
    ref,
  ) {
    if (unstyled) {
      return (
        <button {...props} className={className} ref={ref} type={type}>
          {children}
        </button>
      );
    }

    const sizeClassName = iconOnly
      ? "h-8 w-8 justify-center px-0"
      : "h-8 min-w-8 px-3";
    const widthClassName = fullWidth ? "w-full" : "";

    return (
      <button
        {...props}
        className={[
          "inline-flex shrink-0 items-center gap-2 border text-[13px] font-medium leading-none transition-colors focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 active:bg-hover-surface disabled:cursor-not-allowed disabled:opacity-60",
          styleClassNames[buttonStyle],
          sizeClassName,
          widthClassName,
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        type={type}
      >
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ children, ...props }, ref) {
    return (
      <AppButton {...props} iconOnly={true} ref={ref}>
        {children}
      </AppButton>
    );
  },
);

export const TabButton = forwardRef<HTMLButtonElement, TabButtonProps>(
  function TabButton(
    { children, className = "", selected, type = "button", ...props },
    ref,
  ) {
    return (
      <button
        {...props}
        className={[
          "flex h-full flex-col items-center justify-center pt-2 transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-2px]",
          selected
            ? "border-t-2 border-accent-strong font-semibold text-accent-strong"
            : "text-text-muted hover:text-text-primary",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        ref={ref}
        type={type}
      >
        {children}
      </button>
    );
  },
);

export const ListOptionButton = forwardRef<
  HTMLButtonElement,
  ListOptionButtonProps
>(function ListOptionButton(
  { children, className = "", selected = false, type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      className={[
        "w-full border border-transparent px-2 py-2 text-left text-[13px] transition-colors focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1",
        selected
          ? "bg-accent-surface text-accent-strong"
          : "text-text-secondary hover:bg-surface-2 hover:text-text-primary",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      type={type}
    >
      {children}
    </button>
  );
});

export const NotificationButton = forwardRef<
  HTMLButtonElement,
  NotificationButtonProps
>(function NotificationButton(
  { children, className = "", tone = "info", type = "button", ...props },
  ref,
) {
  return (
    <button
      {...props}
      className={[
        "pointer-events-auto border px-4 py-3 text-left text-sm shadow-overlay transition-colors focus-visible:border-focus-ring focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1",
        notificationButtonToneClassName(tone),
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      type={type}
    >
      {children}
    </button>
  );
});
