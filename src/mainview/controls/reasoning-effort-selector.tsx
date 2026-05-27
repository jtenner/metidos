/**
 * @file src/mainview/controls/reasoning-effort-selector.tsx
 * @description Module for thinking-level selector.
 */

import type { JSX } from "react";
import type {
  RpcReasoningEffort,
  RpcReasoningEffortOption,
} from "../../bun/rpc-schema";
import { ChoiceDropdownControl } from "./choice-dropdown-control";
import { findReasoningEffortOption } from "./codex-utils";

type ReasoningEffortSelectorProps = {
  disabled: boolean;
  onChange: (value: RpcReasoningEffort) => void;
  options: RpcReasoningEffortOption[];
  value: RpcReasoningEffort;
  variant: "desktop" | "mobile";
};

/**
 * Selects a model thinking level (for example "low", "medium", "high").
 * Renders a compact button + popover menu with clear label fallbacks while data loads.
 */
export function ReasoningEffortSelector({
  disabled,
  onChange,
  options,
  value,
  variant,
}: ReasoningEffortSelectorProps): JSX.Element {
  // Derive the active option once so the button and title can always show a
  // human-readable label without separate defensive checks.
  const activeOption = findReasoningEffortOption(options, value);

  // Keep the trigger label resilient to empty options and loading states.
  const buttonLabel = activeOption
    ? activeOption.label
    : options.length === 0
      ? "Loading"
      : "Thinking";

  return (
    <ChoiceDropdownControl
      buttonLabel={buttonLabel}
      disabled={disabled}
      iconFilled
      iconName="bolt"
      label="Thinking Level"
      onChange={onChange}
      options={options.map((option) => ({
        label: option.label,
        value: option.id,
      }))}
      panelPlacement={variant === "desktop" ? "top-start" : "top-end"}
      panelWidthClassName={
        variant === "desktop" ? "min-w-[10rem]" : "w-[12rem]"
      }
      title={
        activeOption
          ? `Thinking level: ${activeOption.label}`
          : "Thinking level"
      }
      value={value}
    />
  );
}
