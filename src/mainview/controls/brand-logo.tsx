/**
 * @file src/mainview/controls/brand-logo.tsx
 * @description Shared app-logo helpers for in-app branding and favicon setup.
 */

import type { JSX } from "react";

const MAINVIEW_FAVICON_META_NAME = "metidos-mainview-favicon";
const MAINVIEW_LOGO_META_NAME = "metidos-mainview-logo";
function readMainviewMetaContent(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }

  const value = document
    .querySelector(`meta[name="${name}"]`)
    ?.getAttribute("content")
    ?.trim();
  return value ? value : null;
}

export function readMainviewLogoUrl(): string | null {
  return readMainviewMetaContent(MAINVIEW_LOGO_META_NAME);
}

function readMainviewFaviconUrl(): string | null {
  return (
    readMainviewMetaContent(MAINVIEW_FAVICON_META_NAME) ?? readMainviewLogoUrl()
  );
}

function upsertBrandFavicon(href: string): void {
  if (typeof document === "undefined") {
    return;
  }

  const existingLink =
    document.querySelector<HTMLLinkElement>(
      'link[rel="icon"][data-metidos-brand-favicon="true"]',
    ) ?? document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const faviconLink = existingLink ?? document.createElement("link");
  faviconLink.dataset.metidosBrandFavicon = "true";
  faviconLink.href = href;
  faviconLink.rel = "icon";
  faviconLink.type = "image/png";

  if (!existingLink) {
    document.head.append(faviconLink);
  }
}

export function installBrandFavicon(): void {
  if (typeof document === "undefined") {
    return;
  }

  const faviconSourceUrl = readMainviewFaviconUrl();
  if (!faviconSourceUrl) {
    return;
  }
  upsertBrandFavicon(faviconSourceUrl);
}

export function brandLogoIcon(className = ""): JSX.Element {
  const logoUrl = readMainviewLogoUrl();

  return (
    <span
      aria-hidden="true"
      className={`relative inline-block shrink-0 overflow-hidden align-middle ${className}`.trim()}
    >
      {logoUrl ? (
        <img
          alt=""
          className="pointer-events-none h-full w-full select-none object-contain"
          draggable={false}
          src={logoUrl}
        />
      ) : null}
    </span>
  );
}
