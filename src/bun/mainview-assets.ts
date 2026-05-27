/**
 * @file src/bun/mainview-assets.ts
 * @description Helpers for versioned mainview asset routing.
 */

import { createHash } from "node:crypto";
import { type Stats, statSync } from "node:fs";
import { basename } from "node:path";

export const MAINVIEW_ASSET_ROUTE_PREFIX = "/assets/mainview";
export const MAINVIEW_ASSET_ROOT_PLACEHOLDER = "__METIDOS_ASSET_ROOT__";
export const IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

export type MainviewAssetDescriptor = {
  contentType: string;
  filePath: string;
};

export type MainviewAssetSnapshot = {
  assetRoot: string;
  assetsByRelativePath: ReadonlyMap<string, MainviewAssetDescriptor>;
  version: string;
};

export type BuildMainviewAssetSnapshotOptions = {
  birdPath: string;
  bundlePath: string;
  bundleSourceMapPath: string | null;
  buildAssetPaths?: readonly string[];
  cssPath: string;
  firaCodeFontPath: string;
  interLatinFontPath: string;
  interLatinExtFontPath: string;
};

function buildMainviewAssetDescriptors({
  birdPath,
  bundlePath,
  bundleSourceMapPath,
  buildAssetPaths = [],
  cssPath,
  firaCodeFontPath,
  interLatinFontPath,
  interLatinExtFontPath,
}: BuildMainviewAssetSnapshotOptions): Array<
  [string, MainviewAssetDescriptor]
> {
  const descriptors: Array<[string, MainviewAssetDescriptor]> = [
    [
      "bird.png",
      {
        contentType: "image/png",
        filePath: birdPath,
      },
    ],
    [
      "index.css",
      {
        contentType: "text/css; charset=utf-8",
        filePath: cssPath,
      },
    ],
    [
      "index.js",
      {
        contentType: "application/javascript; charset=utf-8",
        filePath: bundlePath,
      },
    ],
    [
      "fonts/fira-code-vf.woff2",
      {
        contentType: "font/woff2",
        filePath: firaCodeFontPath,
      },
    ],
    [
      "fonts/inter-latin-ext-wght-normal.woff2",
      {
        contentType: "font/woff2",
        filePath: interLatinExtFontPath,
      },
    ],
    [
      "fonts/inter-latin-wght-normal.woff2",
      {
        contentType: "font/woff2",
        filePath: interLatinFontPath,
      },
    ],
  ];

  if (bundleSourceMapPath) {
    descriptors.push([
      "index.js.map",
      {
        contentType: "application/json; charset=utf-8",
        filePath: bundleSourceMapPath,
      },
    ]);
  }

  for (const filePath of buildAssetPaths) {
    const relativePath = basename(filePath);
    if (descriptors.some(([existingPath]) => existingPath === relativePath)) {
      continue;
    }
    if (relativePath.endsWith(".js")) {
      descriptors.push([
        relativePath,
        {
          contentType: "application/javascript; charset=utf-8",
          filePath,
        },
      ]);
    } else if (relativePath.endsWith(".js.map")) {
      descriptors.push([
        relativePath,
        {
          contentType: "application/json; charset=utf-8",
          filePath,
        },
      ]);
    }
  }

  return descriptors;
}

/**
 * Build a stable version token from the current asset file metadata.
 */
export function buildMainviewAssetVersion(
  descriptors: ReadonlyArray<readonly [string, MainviewAssetDescriptor]>,
  stat: (path: string) => Pick<Stats, "mtimeMs" | "size"> = statSync,
): string {
  const hash = createHash("sha256");

  for (const [relativePath, descriptor] of descriptors) {
    const metadata = stat(descriptor.filePath);
    hash.update(
      `${relativePath}\u0000${Math.trunc(metadata.mtimeMs)}\u0000${metadata.size}\n`,
      "utf8",
    );
  }

  return hash.digest("hex").slice(0, 12);
}

/**
 * Build the current versioned mainview asset snapshot used by HTML and HTTP routes.
 */
export function buildMainviewAssetSnapshot(
  options: BuildMainviewAssetSnapshotOptions,
  stat: (path: string) => Pick<Stats, "mtimeMs" | "size"> = statSync,
): MainviewAssetSnapshot {
  const descriptors = buildMainviewAssetDescriptors(options);
  const version = buildMainviewAssetVersion(descriptors, stat);

  return {
    assetRoot: `${MAINVIEW_ASSET_ROUTE_PREFIX}/${version}`,
    assetsByRelativePath: new Map(descriptors),
    version,
  };
}

/**
 * Replace the HTML asset-root placeholder with the current versioned route prefix.
 */
export function applyMainviewAssetRoot(
  template: string,
  assetRoot: string,
): string {
  return template.replaceAll(MAINVIEW_ASSET_ROOT_PLACEHOLDER, assetRoot);
}

/**
 * Resolve an incoming versioned asset-path request against the current snapshot.
 */
export function resolveVersionedMainviewAssetRequest(
  pathname: string,
  snapshot: Pick<MainviewAssetSnapshot, "assetRoot" | "assetsByRelativePath">,
): MainviewAssetDescriptor | null {
  const currentPrefix = `${snapshot.assetRoot}/`;
  if (pathname.startsWith(currentPrefix)) {
    const relativePath = pathname.slice(currentPrefix.length);
    return snapshot.assetsByRelativePath.get(relativePath) ?? null;
  }

  const versionedPrefix = `${MAINVIEW_ASSET_ROUTE_PREFIX}/`;
  if (!pathname.startsWith(versionedPrefix)) {
    return null;
  }

  const remainder = pathname.slice(versionedPrefix.length);
  const separatorIndex = remainder.indexOf("/");
  if (separatorIndex <= 0) {
    return null;
  }

  const relativePath = remainder.slice(separatorIndex + 1);
  return snapshot.assetsByRelativePath.get(relativePath) ?? null;
}
