/**
 * @file src/mainview/controls/tinted-checkbox-row.tsx
 * @description Shared tinted checkbox row primitive with subdued custom checkboxes.
 */

import type { JSX, MouseEventHandler, ReactNode } from "react";
import { useDynamicCssVariablesClassName } from "../dynamic-css-variables";
import { mergeClassNames } from "../dynamic-styles";
import { materialSymbol } from "./icons";

type TintedCheckboxRowProps = {
  checked: boolean;
  checkboxLabel?: string;
  children: ReactNode;
  checkboxBackground?: string;
  checkboxSelectedMix?: number;
  className?: string;
  contentClassName?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  selectedBackgroundMix?: number;
  tintColor: string;
  trailing?: ReactNode;
  uncheckedBackground?: string;
};

const CHECKBOX_BACKGROUND = "var(--color-surface-1)";

function colorMix(color: string, amount: number, background: string): string {
  // CSS color-mix accepts fractional percentages; clamping here only prevents
  // invalid caller values from escaping the primitive.
  const clampedAmount = Math.min(100, Math.max(0, amount));
  return `color-mix(in srgb, ${color} ${clampedAmount}%, ${background})`;
}

/**
 * A reusable checkbox row whose border and selected state are tinted by `tintColor`.
 * Checkbox boxes stay subdued; checked boxes render a custom SVG checkmark.
 */
export function TintedCheckboxRow({
  checked,
  checkboxLabel,
  children,
  checkboxBackground = CHECKBOX_BACKGROUND,
  checkboxSelectedMix = 0,
  className = "",
  contentClassName = "",
  disabled = false,
  onChange,
  onContextMenu,
  selectedBackgroundMix = 12,
  tintColor,
  trailing,
  uncheckedBackground = "var(--color-surface-1)",
}: TintedCheckboxRowProps): JSX.Element {
  const rowClassName = useDynamicCssVariablesClassName(
    {
      "--tinted-checkbox-row-background": checked
        ? colorMix(tintColor, selectedBackgroundMix, uncheckedBackground)
        : uncheckedBackground,
      "--tinted-checkbox-row-border": checked
        ? tintColor
        : colorMix(tintColor, 72, uncheckedBackground),
    },
    {
      className: mergeClassNames(
        "tinted-checkbox-row flex items-center gap-2 border px-1 py-1 transition-colors",
        disabled ? "opacity-60" : "",
        className,
      ),
      prefix: "tinted-checkbox-row-vars",
    },
  );
  const checkboxClassName = useDynamicCssVariablesClassName(
    {
      "--tinted-checkbox-box-background": checked
        ? colorMix(tintColor, checkboxSelectedMix, checkboxBackground)
        : checkboxBackground,
      "--tinted-checkbox-box-border": tintColor,
      "--tinted-checkbox-box-color": tintColor,
    },
    {
      className:
        "tinted-checkbox-box inline-flex h-4 w-4 items-center justify-center border-2 transition-colors peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-accent peer-focus-visible:outline-offset-1",
      prefix: "tinted-checkbox-box-vars",
    },
  );

  return (
    <div className={rowClassName} onContextMenu={onContextMenu} role="none">
      <label
        className={[
          "flex min-w-0 flex-1 items-center gap-2",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          contentClassName,
        ].join(" ")}
      >
        <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
          <input
            aria-label={checkboxLabel}
            checked={checked}
            className="peer sr-only"
            // The generated name is not used for form submission; it keeps
            // browser/password-manager heuristics away from anonymous inputs.
            name={(checkboxLabel ?? "tinted-checkbox")
              .toLowerCase()
              .replace(/\W+/g, "-")}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.currentTarget.checked);
            }}
            type="checkbox"
          />
          <span aria-hidden="true" className={checkboxClassName}>
            {checked ? materialSymbol("check", "h-3 w-3") : null}
          </span>
        </span>
        {children}
      </label>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
