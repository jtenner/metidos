/**
 * @file src/mainview/controls/list-row.tsx
 * @description Shared dense list row primitives.
 */

import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  JSX,
  ReactNode,
} from "react";
import { forwardRef } from "react";

export type ListRowTone = "default" | "danger";

export function listRowShellClassName(active: boolean): string {
  return `w-full px-3 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-[-1px] ${
    active
      ? "list-row-active-accent bg-surface-2 text-text-primary"
      : "text-text-secondary hover:bg-surface-1"
  }`;
}

type ListRowButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
};

export const ListRowButton = forwardRef<HTMLButtonElement, ListRowButtonProps>(
  function ListRowButton(
    { active, className = "", type = "button", ...props },
    ref,
  ): JSX.Element {
    return (
      <button
        {...props}
        className={`${listRowShellClassName(active)} ${className}`.trim()}
        ref={ref}
        type={type}
      />
    );
  },
);

type ListRowProps = HTMLAttributes<HTMLDivElement> & {
  active: boolean;
  children: ReactNode;
};

export function ListRow({
  active,
  children,
  className = "",
  ...props
}: ListRowProps): JSX.Element {
  return (
    <div
      {...props}
      className={`${listRowShellClassName(active)} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

type ListRowIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ListRowTone;
};

export const ListRowIconButton = forwardRef<
  HTMLButtonElement,
  ListRowIconButtonProps
>(function ListRowIconButton(
  { className = "", tone = "default", type = "button", ...props },
  ref,
): JSX.Element {
  const toneClass =
    tone === "danger" ? "hover:text-danger-text" : "hover:text-accent-strong";
  return (
    <button
      {...props}
      className={`flex h-7 w-7 shrink-0 items-center justify-center text-text-faint transition-colors focus-visible:outline focus-visible:outline-1 focus-visible:outline-focus-ring focus-visible:outline-offset-1 ${toneClass} ${className}`.trim()}
      ref={ref}
      type={type}
    />
  );
});
