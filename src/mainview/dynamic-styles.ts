/**
 * @file src/mainview/dynamic-styles.ts
 * @description Runtime stylesheet helpers for CSP-safe dynamic UI styling.
 */

import type { CSSProperties } from "react";
import { RUNTIME_CONFIG_ELEMENT_ID } from "../shared/runtime-config";

const DYNAMIC_STYLE_ELEMENT_ID = "metidos-dynamic-styles";
export const DYNAMIC_STYLE_RULE_MAX_EVICTABLE_ENTRIES = 192;
export const DYNAMIC_STYLE_RULE_MAX_TOTAL_ENTRIES = 512;

type DynamicStyleRuleRecord = {
  cssText: string;
  evictable: boolean;
  insertIndex: number;
  rule: string;
};

const UNITLESS_CSS_PROPERTIES = new Set<string>([
  "animationIterationCount",
  "aspectRatio",
  "borderImageOutset",
  "borderImageSlice",
  "borderImageWidth",
  "boxFlex",
  "boxFlexGroup",
  "boxOrdinalGroup",
  "columnCount",
  "columns",
  "fillOpacity",
  "flex",
  "flexGrow",
  "flexPositive",
  "flexShrink",
  "flexNegative",
  "flexOrder",
  "fontWeight",
  "gridArea",
  "gridColumn",
  "gridColumnEnd",
  "gridColumnSpan",
  "gridColumnStart",
  "gridRow",
  "gridRowEnd",
  "gridRowSpan",
  "gridRowStart",
  "lineClamp",
  "lineHeight",
  "opacity",
  "order",
  "orphans",
  "scale",
  "tabSize",
  "widows",
  "zIndex",
  "zoom",
]);

let dynamicStyleSheet: CSSStyleSheet | null = null;
const insertedDynamicRules = new Map<string, DynamicStyleRuleRecord>();
const insertedDynamicRuleBySelector = new Map<string, string>();

export function resetDynamicStylesForTests(): void {
  if (dynamicStyleSheet && typeof document !== "undefined") {
    const ownerNode = dynamicStyleSheet.ownerNode;
    if (ownerNode instanceof HTMLElement) {
      ownerNode.remove();
    }
  }
  dynamicStyleSheet = null;
  insertedDynamicRules.clear();
  insertedDynamicRuleBySelector.clear();
}

export function readDynamicStyleRuleCountForTests(): number {
  return insertedDynamicRules.size;
}

function toKebabCase(property: string): string {
  if (property.startsWith("--")) {
    return property;
  }

  const hasVendorPrefix =
    property.startsWith("Webkit") ||
    property.startsWith("Moz") ||
    property.startsWith("ms") ||
    property.startsWith("O");
  const normalized = property
    .replace(/^ms/, "-ms")
    .replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
  return hasVendorPrefix ? normalized : normalized.replace(/^-/, "");
}

function serializeCssValue(property: string, value: string | number): string {
  if (typeof value === "number" && value !== 0) {
    return UNITLESS_CSS_PROPERTIES.has(property) ? String(value) : `${value}px`;
  }
  return String(value);
}

function serializeStyleDeclarations(style: CSSProperties): string {
  return Object.entries(style)
    .filter((entry): entry is [string, string | number] => {
      const [, value] = entry;
      return typeof value === "string" || typeof value === "number";
    })
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([property, value]) =>
        `${toKebabCase(property)}:${serializeCssValue(property, value)};`,
    )
    .join("");
}

function ensureDynamicStyleSheet(nonce?: string): CSSStyleSheet | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (dynamicStyleSheet?.ownerNode?.isConnected === true) {
    return dynamicStyleSheet;
  }
  if (dynamicStyleSheet !== null) {
    dynamicStyleSheet = null;
    insertedDynamicRules.clear();
    insertedDynamicRuleBySelector.clear();
  }

  const existingStyleElement = document.getElementById(
    DYNAMIC_STYLE_ELEMENT_ID,
  );
  let styleElement: HTMLStyleElement;
  if (existingStyleElement instanceof HTMLStyleElement) {
    styleElement = existingStyleElement;
  } else {
    styleElement = document.createElement("style");
    styleElement.id = DYNAMIC_STYLE_ELEMENT_ID;
  }
  if (typeof nonce === "string" && nonce.trim()) {
    styleElement.setAttribute("nonce", nonce);
  }
  if (!styleElement.isConnected) {
    document.head.append(styleElement);
  }

  dynamicStyleSheet = styleElement.sheet;
  return dynamicStyleSheet;
}

function readRuntimeStyleNonce(): string | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }

  const runtimeNonce = window.__metidosRuntime?.styleNonce;
  if (typeof runtimeNonce === "string" && runtimeNonce.trim()) {
    return runtimeNonce;
  }
  const element = document.getElementById(RUNTIME_CONFIG_ELEMENT_ID);
  const raw = element?.textContent?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "styleNonce" in parsed &&
      typeof parsed.styleNonce === "string" &&
      parsed.styleNonce.trim()
    ) {
      return parsed.styleNonce;
    }
  } catch {
    // Ignore malformed runtime config and fall back to nonce-less insertion.
  }
  return undefined;
}

function readDynamicCssRuleText(
  rule: CSSRule | string | undefined,
): string | null {
  if (typeof rule === "string") {
    return rule;
  }
  return rule?.cssText ?? null;
}

function deleteDynamicStyleRule(sheet: CSSStyleSheet, rule: string): void {
  const record = insertedDynamicRules.get(rule);
  insertedDynamicRules.delete(rule);
  if (record) {
    insertedDynamicRuleBySelector.delete(rule.slice(0, rule.indexOf("{")));
  }
  if (!record || typeof sheet.deleteRule !== "function") {
    return;
  }

  for (let scanIndex = 0; scanIndex < sheet.cssRules.length; scanIndex += 1) {
    const cssText = readDynamicCssRuleText(sheet.cssRules[scanIndex]);
    if (cssText === record.cssText || cssText === record.rule) {
      sheet.deleteRule(scanIndex);
      return;
    }
  }
}

function countEvictableDynamicStyleRules(): number {
  let count = 0;
  for (const record of insertedDynamicRules.values()) {
    if (record.evictable) {
      count += 1;
    }
  }
  return count;
}

function evictOldestDynamicStyleRules(sheet: CSSStyleSheet): void {
  let evictableRuleCount = countEvictableDynamicStyleRules();
  while (evictableRuleCount > DYNAMIC_STYLE_RULE_MAX_EVICTABLE_ENTRIES) {
    const oldestRule = [...insertedDynamicRules].find(
      ([, record]) => record.evictable,
    )?.[0];
    if (oldestRule === undefined) {
      return;
    }
    deleteDynamicStyleRule(sheet, oldestRule);
    evictableRuleCount -= 1;
  }

  while (insertedDynamicRules.size > DYNAMIC_STYLE_RULE_MAX_TOTAL_ENTRIES) {
    const oldestRule = insertedDynamicRules.keys().next().value;
    if (oldestRule === undefined) {
      return;
    }
    deleteDynamicStyleRule(sheet, oldestRule);
  }
}

export function ensureDynamicStyleRule(
  selector: string,
  style: CSSProperties | string | null,
  options?: { evictable?: boolean },
): void {
  const declarations =
    typeof style === "string" ? style : serializeStyleDeclarations(style ?? {});
  const sheet = ensureDynamicStyleSheet(readRuntimeStyleNonce());
  if (!sheet) {
    return;
  }

  const previousRule = insertedDynamicRuleBySelector.get(selector);
  if (previousRule) {
    if (previousRule === `${selector}{${declarations}}`) {
      return;
    }
    deleteDynamicStyleRule(sheet, previousRule);
  }
  if (!declarations) {
    return;
  }

  const rule = `${selector}{${declarations}}`;
  const insertIndex = sheet.cssRules.length;
  sheet.insertRule(rule, insertIndex);
  const insertedRule = sheet.cssRules[insertIndex];
  insertedDynamicRules.set(rule, {
    cssText: readDynamicCssRuleText(insertedRule) ?? rule,
    evictable: options?.evictable ?? true,
    insertIndex,
    rule,
  });
  insertedDynamicRuleBySelector.set(selector, rule);
  evictOldestDynamicStyleRules(sheet);
}

export function mergeClassNames(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
