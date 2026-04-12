/**
 * @file src/mainview/controls/brand-logo.tsx
 * @description Shared app-logo helpers for in-app branding and favicon setup.
 */

import type { CSSProperties, JSX } from "react";

const MAINVIEW_FAVICON_META_NAME = "metidos-mainview-favicon";
const MAINVIEW_LOGO_META_NAME = "metidos-mainview-logo";
const FAVICON_SIZE_PX = 64;
const MAINVIEW_ICON_CROP = {
  leftRatio: 162 / 1024,
  sizeRatio: 700 / 1024,
  topRatio: 102 / 1024,
} as const;
const CROWN_FAVICON_CROP = {
  // Crop the wide crown art down to the central crest so the favicon stays readable.
  leftRatio: 232 / 1024,
  sizeRatio: 560 / 1024,
  topRatio: 122 / 1024,
} as const;
const MAINVIEW_LOGO_SCALE_PERCENT = (1 / MAINVIEW_ICON_CROP.sizeRatio) * 100;

const MAINVIEW_LOGO_IMAGE_STYLE: CSSProperties = {
  height: `${MAINVIEW_LOGO_SCALE_PERCENT}%`,
  left: `${(-MAINVIEW_ICON_CROP.leftRatio / MAINVIEW_ICON_CROP.sizeRatio) * 100}%`,
  maxWidth: "none",
  position: "absolute",
  top: `${(-MAINVIEW_ICON_CROP.topRatio / MAINVIEW_ICON_CROP.sizeRatio) * 100}%`,
  width: `${MAINVIEW_LOGO_SCALE_PERCENT}%`,
};

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

  const image = new Image();
  image.decoding = "async";
  image.addEventListener("error", () => {
    upsertBrandFavicon(faviconSourceUrl);
  });
  image.addEventListener("load", () => {
    const cropLeftPx = image.naturalWidth * CROWN_FAVICON_CROP.leftRatio;
    const cropTopPx = image.naturalHeight * CROWN_FAVICON_CROP.topRatio;
    const cropWidthPx = image.naturalWidth * CROWN_FAVICON_CROP.sizeRatio;
    const cropHeightPx = image.naturalHeight * CROWN_FAVICON_CROP.sizeRatio;
    const canvas = document.createElement("canvas");
    canvas.height = FAVICON_SIZE_PX;
    canvas.width = FAVICON_SIZE_PX;

    const context = canvas.getContext("2d");
    if (!context) {
      upsertBrandFavicon(faviconSourceUrl);
      return;
    }

    context.clearRect(0, 0, FAVICON_SIZE_PX, FAVICON_SIZE_PX);
    context.imageSmoothingEnabled = true;
    context.drawImage(
      image,
      cropLeftPx,
      cropTopPx,
      cropWidthPx,
      cropHeightPx,
      0,
      0,
      FAVICON_SIZE_PX,
      FAVICON_SIZE_PX,
    );
    upsertBrandFavicon(canvas.toDataURL("image/png"));
  });
  image.src = faviconSourceUrl;
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
          className="pointer-events-none select-none"
          draggable={false}
          src={logoUrl}
          style={MAINVIEW_LOGO_IMAGE_STYLE}
        />
      ) : null}
    </span>
  );
}
