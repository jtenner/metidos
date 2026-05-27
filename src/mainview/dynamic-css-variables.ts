/**
 * @file src/mainview/dynamic-css-variables.ts
 * @description React helpers for CSP-safe, lifecycle-managed dynamic CSS variables.
 */

import { useId, useInsertionEffect, useMemo } from "react";
import { ensureDynamicStyleRule, mergeClassNames } from "./dynamic-styles";

const DYNAMIC_CSS_VARIABLE_NAME_PATTERN = /^--[a-zA-Z0-9_-]+$/;

export type DynamicCssVariables = Record<
  string,
  string | number | null | undefined
>;

function escapeCssIdentifier(identifier: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(identifier);
  }
  return identifier.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function normalizeCssVariableValue(value: string | number): string {
  return typeof value === "number" && value !== 0
    ? `${value}px`
    : String(value);
}

function serializeCssVariables(variables: DynamicCssVariables): string {
  return Object.entries(variables)
    .filter((entry): entry is [string, string | number] => {
      const [name, value] = entry;
      return (
        DYNAMIC_CSS_VARIABLE_NAME_PATTERN.test(name) &&
        (typeof value === "string" || typeof value === "number")
      );
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${normalizeCssVariableValue(value)};`)
    .join("");
}

/**
 * Returns a stable class name whose CSS custom properties are updated while the
 * component is mounted and removed on unmount. Values are serialized as custom
 * properties only; consuming styles must be static CSS that references them.
 */
export function useDynamicCssVariablesClassName(
  variables: DynamicCssVariables,
  options: {
    className?: string | null | undefined;
    prefix: string;
  },
): string {
  const reactId = useId();
  const className = useMemo(
    () => `${options.prefix}-${reactId.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    [options.prefix, reactId],
  );
  const declarations = serializeCssVariables(variables);

  useInsertionEffect(() => {
    if (!declarations) {
      return;
    }
    ensureDynamicStyleRule(`.${escapeCssIdentifier(className)}`, declarations, {
      evictable: false,
    });
    return () => {
      ensureDynamicStyleRule(`.${escapeCssIdentifier(className)}`, null);
    };
  }, [className, declarations]);

  return mergeClassNames(options.className, className);
}
