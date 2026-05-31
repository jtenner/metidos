/**
 * @file src/bun/project-procedures/project-favicons.ts
 * @description Best-effort project favicon discovery for sidebar folder icons.
 */

import { constants } from "node:fs";
import { open, readdir, readFile, realpath, stat } from "node:fs/promises";
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

type FallbackIconCandidate = {
  path: string;
  priority: number;
};

type FaviconCandidateIndex = {
  htmlPaths: string[];
  nestedFallbackIconPaths: FallbackIconCandidate[];
  nestedIndexHtmlPaths: string[];
  nestedManifestPaths: string[];
  rootFallbackIconPaths: FallbackIconCandidate[];
  rootIndexHtmlPath: string | null;
  rootManifestPaths: string[];
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
  const rootRelativePrefix = [
    "__METIDOS_ASSET_ROOT__/",
    "%PUBLIC_URL%/",
    "%PUBLIC_URL%",
    "%BASE_URL%/",
    "%BASE_URL%",
  ].find((prefix) => decodedHref.startsWith(prefix));
  const candidatePath = rootRelativePrefix
    ? resolve(projectPath, decodedHref.slice(rootRelativePrefix.length))
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
    .some(
      (token) =>
        token === "icon" || token.endsWith("-icon") || token === "mask-icon",
    );
}

function isManifestFileName(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  return (
    lowerName.endsWith(".webmanifest") || lowerName.endsWith("manifest.json")
  );
}

function getFallbackIconFilePriority(fileName: string): number | null {
  const lowerName = fileName.toLowerCase();
  const extension = extname(lowerName);
  if (ICON_MIME_TYPES[extension] === undefined) {
    return null;
  }

  const baseName = lowerName.slice(0, -extension.length);
  if (baseName === "favicon") {
    return 0;
  }
  if (baseName.startsWith("favicon-")) {
    return 1;
  }
  if (baseName === "icon") {
    return 2;
  }
  if (
    baseName === "apple-touch-icon" ||
    baseName.startsWith("apple-touch-icon-") ||
    baseName === "apple-icon" ||
    baseName.startsWith("apple-icon-")
  ) {
    return 3;
  }
  if (
    baseName.startsWith("android-chrome-") ||
    baseName.startsWith("mstile-") ||
    baseName === "mask-icon"
  ) {
    return 4;
  }
  if (baseName.endsWith("-icon") || baseName.endsWith("_icon")) {
    return 5;
  }
  return null;
}

function isManifestRelValue(relValue: string): boolean {
  return relValue
    .split(/\s+/u)
    .map((token) => token.trim().toLowerCase())
    .some((token) => token === "manifest");
}

type ExtractedIconHrefs = {
  iconHrefs: string[];
  manifestHrefs: string[];
};

function extractIconHrefs(html: string): ExtractedIconHrefs {
  const iconHrefs: string[] = [];
  const manifestHrefs: string[] = [];

  new HTMLRewriter()
    .on("link[rel][href]", {
      element(link) {
        const rel = link.getAttribute("rel") ?? "";
        const href = link.getAttribute("href")?.trim() ?? "";
        if (!href) {
          return;
        }
        if (isFaviconRelValue(rel)) {
          iconHrefs.push(href);
        } else if (isManifestRelValue(rel)) {
          manifestHrefs.push(href);
        }
      },
    })
    .transform(html);

  return { iconHrefs, manifestHrefs };
}

async function readManifestIconHrefs(
  projectRealPath: string,
  manifestPath: string,
): Promise<string[]> {
  const manifestHandle = await open(
    manifestPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!manifestHandle) {
    return [];
  }
  try {
    const manifestStat = await manifestHandle.stat().catch(() => null);
    if (!manifestStat?.isFile() || manifestStat.size > 128 * 1024) {
      return [];
    }
    const manifestRealPath = await realpath(
      `/proc/self/fd/${manifestHandle.fd}`,
    ).catch(() => null);
    if (
      !manifestRealPath ||
      (manifestRealPath !== projectRealPath &&
        !isInsideDirectory(projectRealPath, manifestRealPath))
    ) {
      return [];
    }
    const manifestText = await manifestHandle.readFile("utf8").catch(() => "");
    try {
      const manifest = JSON.parse(manifestText) as {
        icons?: Array<{ src?: unknown }>;
      };
      return Array.isArray(manifest.icons)
        ? manifest.icons
            .map((icon) =>
              typeof icon.src === "string" ? icon.src.trim() : "",
            )
            .filter(Boolean)
        : [];
    } catch {
      return [];
    }
  } finally {
    await manifestHandle.close().catch(() => undefined);
  }
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
  const iconHandle = await open(
    iconPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => null);
  if (!iconHandle) {
    return null;
  }
  try {
    const iconStat = await iconHandle.stat().catch(() => null);
    if (
      !iconStat?.isFile() ||
      iconStat.size <= 0 ||
      iconStat.size > MAX_ICON_BYTES
    ) {
      return null;
    }
    const iconRealPath = await realpath(`/proc/self/fd/${iconHandle.fd}`).catch(
      () => null,
    );
    if (
      !iconRealPath ||
      (iconRealPath !== projectRealPath &&
        !isInsideDirectory(projectRealPath, iconRealPath))
    ) {
      return null;
    }
    const data = await iconHandle.readFile().catch(() => null);
    if (!data || data.byteLength > MAX_ICON_BYTES) {
      return null;
    }
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } finally {
    await iconHandle.close().catch(() => undefined);
  }
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
  const { iconHrefs, manifestHrefs } = extractIconHrefs(html);
  for (const href of iconHrefs) {
    const iconPath = resolveFaviconHref(projectPath, htmlPath, href);
    if (!iconPath) {
      continue;
    }
    const dataUrl = await readIconDataUrl(projectRealPath, iconPath);
    if (dataUrl) {
      return dataUrl;
    }
  }
  for (const manifestHref of manifestHrefs) {
    const manifestPath = resolveFaviconHref(
      projectPath,
      htmlPath,
      manifestHref,
    );
    if (!manifestPath) {
      continue;
    }
    for (const iconHref of await readManifestIconHrefs(
      projectRealPath,
      manifestPath,
    )) {
      const iconPath = resolveFaviconHref(projectPath, manifestPath, iconHref);
      if (!iconPath) {
        continue;
      }
      const dataUrl = await readIconDataUrl(projectRealPath, iconPath);
      if (dataUrl) {
        return dataUrl;
      }
    }
  }
  return null;
}

async function collectFaviconCandidates(
  projectPath: string,
): Promise<FaviconCandidateIndex> {
  const candidates: FaviconCandidateIndex = {
    htmlPaths: [],
    nestedFallbackIconPaths: [],
    nestedIndexHtmlPaths: [],
    nestedManifestPaths: [],
    rootFallbackIconPaths: [],
    rootIndexHtmlPath: null,
    rootManifestPaths: [],
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
      if (isManifestFileName(lowerName)) {
        if (current.depth === 0) {
          candidates.rootManifestPaths.push(entryPath);
        } else {
          candidates.nestedManifestPaths.push(entryPath);
        }
      }

      const fallbackIconPriority = getFallbackIconFilePriority(lowerName);
      if (fallbackIconPriority !== null) {
        const iconPath = { path: entryPath, priority: fallbackIconPriority };
        if (current.depth === 0) {
          candidates.rootFallbackIconPaths.push(iconPath);
        } else {
          candidates.nestedFallbackIconPaths.push(iconPath);
        }
      }
    }
  }

  return candidates;
}

function sortFallbackIconCandidates(
  candidates: FallbackIconCandidate[],
): FallbackIconCandidate[] {
  return [...candidates].sort(
    (left, right) =>
      left.priority - right.priority || left.path.localeCompare(right.path),
  );
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
  }

  for (const manifestPath of [
    ...candidates.rootManifestPaths,
    ...candidates.nestedManifestPaths,
  ]) {
    for (const iconHref of await readManifestIconHrefs(
      projectRealPath,
      manifestPath,
    )) {
      const iconPath = resolveFaviconHref(projectPath, manifestPath, iconHref);
      if (!iconPath) {
        continue;
      }
      const dataUrl = await readIconDataUrl(projectRealPath, iconPath);
      if (dataUrl) {
        return dataUrl;
      }
    }
  }

  for (const iconCandidate of [
    ...sortFallbackIconCandidates(candidates.rootFallbackIconPaths),
    ...sortFallbackIconCandidates(candidates.nestedFallbackIconPaths),
  ]) {
    const dataUrl = await readIconDataUrl(projectRealPath, iconCandidate.path);
    if (dataUrl) {
      return dataUrl;
    }
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
