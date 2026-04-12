/**
 * @file src/mainview/controls/icons.tsx
 * @description Module for icons.
 */

import type { JSX, SVGProps } from "react";

/**
 * Canonical icon names supported by UI controls.
 * Each name maps to a Material Symbols style glyph in `renderIconGlyph`.
 */
export type AppIconName =
  | "account_circle"
  | "arrow_forward"
  | "arrow_upward"
  | "bolt"
  | "chat_bubble"
  | "check_circle"
  | "checklist"
  | "chevron_right"
  | "code"
  | "delete"
  | "difference"
  | "description"
  | "expand_less"
  | "expand_more"
  | "folder"
  | "folder_open"
  | "history"
  | "menu"
  | "person"
  | "public"
  | "push_pin"
  | "radio_button_unchecked"
  | "search"
  | "settings"
  | "shield"
  | "stop"
  | "task_alt"
  | "terminal"
  | "warning";

/**
 * Return one or more SVG path/circle elements for a given icon name.
 * Supports both "outline" and "filled" variants where relevant.
 * Throws in the default branch if an unsupported name is introduced.
 */
function renderIconGlyph(
  name: AppIconName,
  filled: boolean,
): JSX.Element | JSX.Element[] {
  switch (name) {
    case "account_circle":
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="9" r="2.5" />
          <path d="M7.5 17c1.15-2 3.05-3 4.5-3s3.35 1 4.5 3" />
        </>
      );
    case "arrow_forward":
      return (
        <>
          <path d="M5 12h12.5" />
          <path d="m13.5 7 5 5-5 5" />
        </>
      );
    case "arrow_upward":
      return (
        <>
          <path d="M12 18V6" />
          <path d="m7 11 5-5 5 5" />
        </>
      );
    case "bolt":
      return filled ? (
        <path
          d="M13 2 5 13h5l-1 9 8-11h-5z"
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <path d="M13 2 5 13h5l-1 9 8-11h-5z" />
      );
    case "chat_bubble":
      return (
        <>
          <path d="M6 7.5h12A2.5 2.5 0 0 1 20.5 10v6A2.5 2.5 0 0 1 18 18.5H10l-4.5 3v-3H6A2.5 2.5 0 0 1 3.5 16v-6A2.5 2.5 0 0 1 6 7.5Z" />
          <path d="M8 12h8" />
        </>
      );
    case "check_circle":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.75 12.25 2.15 2.15 4.35-4.65" />
        </>
      );
    case "checklist":
      return (
        <>
          <rect x="6" y="4" width="12" height="16" rx="2" />
          <path d="m9 10 1.5 1.5L13 9" />
          <path d="M9 15h6" />
        </>
      );
    case "chevron_right":
      return <path d="m10 7 5 5-5 5" />;
    case "code":
      return (
        <>
          <path d="m9 7-5 5 5 5" />
          <path d="m15 7 5 5-5 5" />
        </>
      );
    case "delete":
      return (
        <>
          <path d="M5 7h14" />
          <path d="M9 7V5h6v2" />
          <path d="M8 7v11h8V7" />
          <path d="M10 10v5" />
          <path d="M14 10v5" />
        </>
      );
    case "difference":
      return (
        <>
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <rect x="11" y="11" width="8" height="8" rx="1.5" />
        </>
      );
    case "description":
      return (
        <>
          <path d="M6.5 4.5h7l4 4V19.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
          <path d="M13.5 4.5V9h4.5" />
          <path d="M8 12h8" />
          <path d="M8 15h8" />
          <path d="M8 18h5" />
        </>
      );
    case "expand_less":
      return <path d="m7 14 5-5 5 5" />;
    case "expand_more":
      return <path d="m7 10 5 5 5-5" />;
    case "folder":
      return (
        <>
          <path d="M3.5 8.5h5l1.75-2h10.25v11H3.5z" />
          <path d="M3.5 8.5v-1A2.5 2.5 0 0 1 6 5h3" />
        </>
      );
    case "folder_open":
      return (
        <>
          <path d="M3.5 9.5h6.25l1.75-2H20.5" />
          <path d="M4.75 9.5h15L17.75 19h-15z" />
          <path d="M4.75 9.5V8A2.5 2.5 0 0 1 7.25 5.5h2.5" />
        </>
      );
    case "history":
      return (
        <>
          <path d="M5 12a7 7 0 1 0 2.05-4.95" />
          <path d="M5 7v5h5" />
          <path d="M5 4v3h3" />
        </>
      );
    case "menu":
      return (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      );
    case "person":
      return (
        <>
          <circle cx="12" cy="9" r="2.5" />
          <path d="M7.5 18c1.15-2.1 3.05-3.2 4.5-3.2s3.35 1.1 4.5 3.2" />
        </>
      );
    case "public":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M4.5 12h15" />
          <path d="M12 4.5c2.2 2.15 3.35 4.95 3.35 7.5S14.2 17.35 12 19.5" />
          <path d="M12 4.5c-2.2 2.15-3.35 4.95-3.35 7.5S9.8 17.35 12 19.5" />
          <path d="M6 8.75c1.65.8 3.8 1.25 6 1.25s4.35-.45 6-1.25" />
          <path d="M6 15.25c1.65-.8 3.8-1.25 6-1.25s4.35.45 6 1.25" />
        </>
      );
    case "push_pin":
      return filled ? (
        <path
          d="M9 4h6l-1.25 4L17 11v1h-4v7l-1 1-1-1v-7H7v-1l3.25-3L9 4Z"
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <>
          <path d="M9 4h6l-1.25 4L17 11v1H7v-1l3.25-3L9 4Z" />
          <path d="M12 12v8" />
        </>
      );
    case "radio_button_unchecked":
      return <circle cx="12" cy="12" r="7.5" />;
    case "search":
      return (
        <>
          <circle cx="11" cy="11" r="5.5" />
          <path d="m16 16 4 4" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="2.75" />
          <path d="M12 4.5v2" />
          <path d="M12 17.5v2" />
          <path d="M4.5 12h2" />
          <path d="M17.5 12h2" />
          <path d="m6.7 6.7 1.4 1.4" />
          <path d="m15.9 15.9 1.4 1.4" />
          <path d="m17.3 6.7-1.4 1.4" />
          <path d="m8.1 15.9-1.4 1.4" />
        </>
      );
    case "shield":
      return (
        <>
          <path d="M12 3.5 19 6.5v5.2c0 4.85-3.15 8.95-7 10-3.85-1.05-7-5.15-7-10V6.5z" />
          <path d="M12 7.25v8.5" />
        </>
      );
    case "stop":
      return <rect x="7.25" y="7.25" width="9.5" height="9.5" rx="1.5" />;
    case "task_alt":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="m8.75 12.25 2.15 2.15 4.35-4.65" />
        </>
      );
    case "terminal":
      return (
        <>
          <path d="m6.5 8.5 3.5 3.5-3.5 3.5" />
          <path d="M12 15.5h5.5" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M12 4.75 20 19.25H4z" />
          <path d="M12 9.25v4.75" />
          <circle
            cx="12"
            cy="16.5"
            r="0.85"
            fill="currentColor"
            stroke="none"
          />
        </>
      );
  }

  const exhaustiveCheck: never = name;
  throw new Error(`Unsupported icon: ${exhaustiveCheck}`);
}

/**
 * Build a Material-symbol-style icon wrapped as an inline SVG.
 *
 * - `filled` changes selected variants where the icon has both outline and filled forms.
 * - `className` is merged with baseline icon sizing/alignment classes.
 * - `aria-hidden` is set so decorative icons are not announced; a title remains
 *   for developer/tooling readability and easy inspection.
 */
export function materialSymbol(
  name: AppIconName,
  className = "",
  options: {
    filled?: boolean;
  } = {},
): JSX.Element {
  // Default icon props keep stroke/fill behavior stable and predictable across renders.
  const { filled = false } = options;
  const svgProps: SVGProps<SVGSVGElement> = {
    "aria-hidden": "true",
    className: `inline-block shrink-0 align-middle ${className}`.trim(),
    fill: "none",
    focusable: false,
    height: "1em",
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    strokeWidth: 1.85,
    viewBox: "0 0 24 24",
    width: "1em",
  };

  return (
    <svg {...svgProps}>
      <title>{name.replaceAll("_", " ")}</title>
      {renderIconGlyph(name, filled)}
    </svg>
  );
}
