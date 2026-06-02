/**
 * @file src/mainview/controls/choice-dropdown-control.tsx
 * @description Shared compact branded dropdown for simple single-choice controls.
 */

import { type JSX, useId, useRef } from "react";
import { AppButton, ListOptionButton } from "./button";
import { DropdownControl } from "./dropdown";
import { type AppIconName, materialSymbol } from "./icons";

type ChoiceDropdownOption<T extends string> = {
  label: string;
  value: T;
};

type ChoiceDropdownControlProps<T extends string> = {
  buttonLabel?: string;
  disabled?: boolean;
  iconFilled?: boolean;
  iconName?: AppIconName;
  label: string;
  onChange: (value: T) => void;
  options: ChoiceDropdownOption<T>[];
  panelPlacement?: "top-start" | "top-end" | "bottom-start" | "bottom-end";
  panelWidthClassName?: string;
  title?: string;
  value: T;
};

/**
 * Shared single-choice dropdown used by compact toolbar selectors.
 */
export function ChoiceDropdownControl<T extends string>({
  buttonLabel,
  disabled = false,
  iconFilled = false,
  iconName,
  label,
  onChange,
  options,
  panelPlacement = "bottom-start",
  panelWidthClassName = "min-w-[10rem]",
  title,
  value,
}: ChoiceDropdownControlProps<T>): JSX.Element {
  const activeOption = options.find((option) => option.value === value);
  const resolvedButtonLabel = buttonLabel ?? activeOption?.label ?? label;
  const panelId = useId();
  const panelTitleId = `${panelId}-title`;
  const selectedOptionRef = useRef<HTMLButtonElement | null>(null);

  return (
    <DropdownControl
      canOpen={!disabled}
      disabled={disabled}
      panelClassName={`z-40 overflow-hidden border border-border-default bg-surface-overlay shadow-overlay ${panelWidthClassName}`}
      panelId={panelId}
      panelInitialFocusRef={selectedOptionRef}
      panelLabelledBy={panelTitleId}
      panelMode="chooser"
      panelPlacement={panelPlacement}
      title={title ?? `${label}: ${resolvedButtonLabel}`}
      renderButton={({ buttonRef, open, toggle }) => (
        <AppButton
          aria-controls={panelId}
          aria-expanded={open}
          aria-haspopup="dialog"
          buttonStyle="muted"
          className={[
            "overflow-hidden text-left",
            open ? "border-focus-ring" : "",
          ].join(" ")}
          disabled={disabled}
          fullWidth
          onClick={toggle}
          ref={buttonRef}
        >
          {iconName
            ? materialSymbol(iconName, "text-[16px] text-accent-strong", {
                filled: iconFilled,
              })
            : null}
          <span className="min-w-0 flex-1 truncate font-label text-[11px] font-semibold uppercase leading-none tracking-[0.1em] text-text-primary">
            {resolvedButtonLabel}
          </span>
          <span className="shrink-0 text-text-muted">
            {materialSymbol(
              open ? "expand_less" : "expand_more",
              "text-[13px]",
            )}
          </span>
        </AppButton>
      )}
      renderPanel={({ close }) => (
        <>
          <div
            className="border-b border-border-subtle px-3 py-2 font-label text-[10px] uppercase tracking-[0.1em] text-accent"
            id={panelTitleId}
          >
            {label}
          </div>
          <fieldset
            aria-labelledby={panelTitleId}
            className="min-w-0 border-0 p-0 py-2"
          >
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <ListOptionButton
                  aria-selected={selected}
                  className="flex items-center gap-3 px-3 font-label text-[11px] font-semibold uppercase tracking-[0.1em]"
                  data-chooser-option="true"
                  key={option.value}
                  role="option"
                  onClick={() => {
                    close();
                    if (option.value !== value) {
                      onChange(option.value);
                    }
                  }}
                  ref={selected ? selectedOptionRef : undefined}
                  selected={selected}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    className={`shrink-0 ${
                      selected ? "text-accent-strong" : "text-text-faint"
                    }`}
                  >
                    {materialSymbol(
                      selected ? "check_circle" : "radio_button_unchecked",
                      "text-[16px]",
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-inherit">
                    {option.label}
                  </span>
                </ListOptionButton>
              );
            })}
          </fieldset>
        </>
      )}
    />
  );
}
