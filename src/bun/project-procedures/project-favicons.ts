/**
 * @file src/bun/project-procedures/project-favicons.ts
 * @description Best-effort project favicon discovery for sidebar folder icons.
 */

import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";

export type RpcProjectFavicon = {
  projectId: number;
  dataUrl: string | null;
};

const FAVICON_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_SCANNED_ENTRIES = 10_000;
const MAX_SCAN_DEPTH = 12;
const MAX_ICON_BYTES = 128 * 1024;
const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules"]);
const ICON_MIME_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

type FaviconCandidateIndex = {
  htmlPaths: string[];
  nestedFaviconImagePath: string | null;
  nestedIndexHtmlPaths: string[];
  rootFaviconImagePath: string | null;
  rootIndexHtmlPath: string | null;
};

type FaviconCacheEntry = {
  checkedAt: number;
  request: Promise<string | null>;
};

const faviconCache = new Map<string, FaviconCacheEntry>();

function isInsideDirectory(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    Boolean(relativePath) &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function isRemoteOrInlineHref(href: string): boolean {
  return (
    /^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(href) ||
    /^[a-z][a-z0-9+.-]*:/iu.test(href)
  );
}

function stripUrlDecorations(href: string): string {
  return href.split("#", 1)[0]?.split("?", 1)[0]?.trim() ?? "";
}

function decodeHrefPath(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function resolveFaviconHref(
  projectPath: string,
  htmlPath: string,
  rawHref: string,
): string | null {
  const href = stripUrlDecorations(rawHref);
  if (!href || isRemoteOrInlineHref(href)) {
    return null;
  }

  const decodedHref = decodeHrefPath(href);
  const metidosAssetRootPrefix = "__METIDOS_ASSET_ROOT__/";
  const candidatePath = decodedHref.startsWith(metidosAssetRootPrefix)
    ? resolve(projectPath, decodedHref.slice(metidosAssetRootPrefix.length))
    : decodedHref.startsWith("/")
      ? resolve(projectPath, `.${decodedHref}`)
      : resolve(dirname(htmlPath), decodedHref);
  const normalizedProjectPath = resolve(projectPath);
  if (
    candidatePath !== normalizedProjectPath &&
    !isInsideDirectory(normalizedProjectPath, candidatePath)
  ) {
    return null;
  }
  return candidatePath;
}

function isFaviconRelValue(relValue: string): boolean {
  return relValue
    .split(/\s+/u)
    .map((token) => token.trim().toLowerCase())
    .some((token) => token === "icon" || token.endsWith("-icon"));
}

function extractFaviconHrefs(html: string): string[] {
  const hrefs: string[] = [];

  new HTMLRewriter()
    .on("link[rel][href]", {
      element(link) {
        if (!isFaviconRelValue(link.getAttribute("rel") ?? "")) {
          return;
        }

        const href = link.getAttribute("href")?.trim() ?? "";
        if (href) {
          hrefs.push(href);
        }
      },
    })
    .transform(html);

  return hrefs;
}

async function readIconDataUrl(
  projectRealPath: string,
  iconPath: string,
): Promise<string | null> {
  const extension = extname(iconPath).toLowerCase();
  const mimeType = ICON_MIME_TYPES[extension];
  if (!mimeType) {
    return null;
  }
  const iconStat = await lstat(iconPath).catch(() => null);
  if (
    !iconStat?.isFile() ||
    iconStat.isSymbolicLink() ||
    iconStat.size <= 0 ||
    iconStat.size > MAX_ICON_BYTES
  ) {
    return null;
  }
  const iconRealPath = await realpath(iconPath).catch(() => null);
  if (
    !iconRealPath ||
    (iconRealPath !== projectRealPath &&
      !isInsideDirectory(projectRealPath, iconRealPath))
  ) {
    return null;
  }
  const data = await readFile(iconPath).catch(() => null);
  if (!data || data.byteLength > MAX_ICON_BYTES) {
    return null;
  }
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

async function readFaviconFromHtml(
  projectPath: string,
  projectRealPath: string,
  htmlPath: string,
): Promise<string | null> {
  const htmlStat = await stat(htmlPath).catch(() => null);
  if (!htmlStat?.isFile() || htmlStat.size > 256 * 1024) {
    return null;
  }
  const html = await readFile(htmlPath, "utf8").catch(() => "");
  for (const href of extractFaviconHrefs(html)) {
    const iconPath = resolveFaviconHref(projectPath, htmlPath, href);
    if (!iconPath) {
      continue;
    }
    const dataUrl = await readIconDataUrl(projectRealPath, iconPath);
    if (dataUrl) {
      return dataUrl;
    }
  }
  return null;
}

async function collectFaviconCandidates(
  projectPath: string,
): Promise<FaviconCandidateIndex> {
  const candidates: FaviconCandidateIndex = {
    htmlPaths: [],
    nestedFaviconImagePath: null,
    nestedIndexHtmlPaths: [],
    rootFaviconImagePath: null,
    rootIndexHtmlPath: null,
  };
  const queue: Array<{ depth: number; path: string }> = [
    { depth: 0, path: projectPath },
  ];
  let scannedEntries = 0;

  while (queue.length > 0 && scannedEntries < MAX_SCANNED_ENTRIES) {
    const current = queue.shift();
    if (!current || current.depth > MAX_SCAN_DEPTH) {
      continue;
    }

    const entries = await readdir(current.path, { withFileTypes: true }).catch(
      () => [],
    );
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) {
        return left.isDirectory() ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: "base",
      });
    });

    for (const entry of entries) {
      if (scannedEntries >= MAX_SCANNED_ENTRIES) {
        break;
      }
      scannedEntries += 1;
      const entryPath = join(current.path, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          queue.push({ depth: current.depth + 1, path: entryPath });
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const lowerName = entry.name.toLowerCase();
      if (lowerName === "index.html") {
        if (current.depth === 0) {
          candidates.rootIndexHtmlPath ??= entryPath;
        } else {
          candidates.nestedIndexHtmlPaths.push(entryPath);
        }
      } else if (lowerName.endsWith(".html")) {
        candidates.htmlPaths.push(entryPath);
      }

      const isSupportedIconImage =
        ICON_MIME_TYPES[extname(lowerName)] !== undefined;
      if (lowerName.startsWith("favicon.") && isSupportedIconImage) {
        if (current.depth === 0) {
          candidates.rootFaviconImagePath ??= entryPath;
        } else {
          candidates.nestedFaviconImagePath ??= entryPath;
        }
      }
    }
  }

  return candidates;
}

function resolveCandidateHtmlPaths(
  candidates: FaviconCandidateIndex,
): string[] {
  return [
    ...(candidates.rootIndexHtmlPath ? [candidates.rootIndexHtmlPath] : []),
    ...candidates.nestedIndexHtmlPaths,
    ...candidates.htmlPaths,
  ];
}

async function discoverProjectFaviconDataUrlUncached(
  projectPath: string,
): Promise<string | null> {
  const projectStat = await stat(projectPath).catch(() => null);
  if (!projectStat?.isDirectory()) {
    return null;
  }
  const projectRealPath = await realpath(projectPath).catch(() => null);
  if (!projectRealPath) {
    return null;
  }

  const candidates = await collectFaviconCandidates(projectPath);
  const htmlPaths = resolveCandidateHtmlPaths(candidates);
  if (htmlPaths.length > 0) {
    for (const htmlPath of htmlPaths) {
      const dataUrl = await readFaviconFromHtml(
        projectPath,
        projectRealPath,
        htmlPath,
      );
      if (dataUrl) {
        return dataUrl;
      }
    }
    return null;
  }

  if (candidates.rootFaviconImagePath) {
    const dataUrl = await readIconDataUrl(
      projectRealPath,
      candidates.rootFaviconImagePath,
    );
    if (dataUrl) {
      return dataUrl;
    }
  }
  if (candidates.nestedFaviconImagePath) {
    return await readIconDataUrl(
      projectRealPath,
      candidates.nestedFaviconImagePath,
    );
  }
  return null;
}

export async function discoverProjectFaviconDataUrl(
  projectPath: string,
): Promise<string | null> {
  const normalizedPath = resolve(projectPath);
  const cached = faviconCache.get(normalizedPath);
  const now = Date.now();
  if (cached && now - cached.checkedAt < FAVICON_CACHE_TTL_MS) {
    return cached.request;
  }

  const request = discoverProjectFaviconDataUrlUncached(normalizedPath).catch(
    () => null,
  );
  faviconCache.set(normalizedPath, { checkedAt: now, request });
  return request;
}

export function clearProjectFaviconCache(): void {
  faviconCache.clear();
}
