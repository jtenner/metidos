/**
 * @file src/bun/mainview-assets.test.ts
 * @description Test file for mainview-assets.
 */

import { describe, expect, it } from "bun:test";

import {
  applyMainviewAssetRoot,
  buildMainviewAssetSnapshot,
  buildMainviewAssetVersion,
  IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL,
  MAINVIEW_ASSET_ROOT_PLACEHOLDER,
  MAINVIEW_ASSET_ROUTE_PREFIX,
  resolveVersionedMainviewAssetRequest,
} from "./mainview-assets";

const TEST_BUILD_OPTIONS = {
  bundlePath: "/tmp/mainview/index.js",
  bundleSourceMapPath: "/tmp/mainview/index.js.map",
  cssPath: "/tmp/mainview/index.css",
  firaCodeFontPath: "/tmp/fonts/fira-code-vf.woff2",
  interLatinFontPath: "/tmp/fonts/inter-latin-wght-normal.woff2",
  interLatinExtFontPath: "/tmp/fonts/inter-latin-ext-wght-normal.woff2",
};

function mockStatFactory(
  byPath: Record<string, { mtimeMs: number; size: number }>,
): (path: string) => { mtimeMs: number; size: number } {
  return (path) => byPath[path] ?? { mtimeMs: 0, size: 0 };
}

describe("mainview asset helpers", () => {
  it("builds a stable version token from asset metadata", () => {
    const stat = mockStatFactory({
      "/tmp/mainview/index.css": { mtimeMs: 1000, size: 100 },
      "/tmp/mainview/index.js": { mtimeMs: 2000, size: 200 },
    });

    const versionA = buildMainviewAssetVersion(
      [
        [
          "index.css",
          {
            contentType: "text/css; charset=utf-8",
            filePath: "/tmp/mainview/index.css",
          },
        ],
        [
          "index.js",
          {
            contentType: "application/javascript; charset=utf-8",
            filePath: "/tmp/mainview/index.js",
          },
        ],
      ],
      stat,
    );
    const versionB = buildMainviewAssetVersion(
      [
        [
          "index.css",
          {
            contentType: "text/css; charset=utf-8",
            filePath: "/tmp/mainview/index.css",
          },
        ],
        [
          "index.js",
          {
            contentType: "application/javascript; charset=utf-8",
            filePath: "/tmp/mainview/index.js",
          },
        ],
      ],
      stat,
    );

    expect(versionA).toHaveLength(12);
    expect(versionA).toBe(versionB);
  });

  it("builds a versioned asset root and excludes the sourcemap when absent", () => {
    const snapshot = buildMainviewAssetSnapshot(
      {
        ...TEST_BUILD_OPTIONS,
        bundleSourceMapPath: null,
      },
      mockStatFactory({
        "/tmp/mainview/index.css": { mtimeMs: 1000, size: 100 },
        "/tmp/mainview/index.js": { mtimeMs: 2000, size: 200 },
        "/tmp/fonts/fira-code-vf.woff2": { mtimeMs: 3000, size: 300 },
        "/tmp/fonts/inter-latin-wght-normal.woff2": {
          mtimeMs: 4000,
          size: 400,
        },
        "/tmp/fonts/inter-latin-ext-wght-normal.woff2": {
          mtimeMs: 5000,
          size: 500,
        },
      }),
    );

    expect(snapshot.assetRoot).toStartWith(`${MAINVIEW_ASSET_ROUTE_PREFIX}/`);
    expect(snapshot.assetsByRelativePath.has("index.js")).toBeTrue();
    expect(snapshot.assetsByRelativePath.has("index.css")).toBeTrue();
    expect(snapshot.assetsByRelativePath.has("index.js.map")).toBeFalse();
  });

  it("resolves only current versioned asset requests from the allowlisted asset set", () => {
    const snapshot = buildMainviewAssetSnapshot(
      TEST_BUILD_OPTIONS,
      mockStatFactory({
        "/tmp/mainview/index.css": { mtimeMs: 1000, size: 100 },
        "/tmp/mainview/index.js": { mtimeMs: 2000, size: 200 },
        "/tmp/mainview/index.js.map": { mtimeMs: 2500, size: 250 },
        "/tmp/fonts/fira-code-vf.woff2": { mtimeMs: 3000, size: 300 },
        "/tmp/fonts/inter-latin-wght-normal.woff2": {
          mtimeMs: 4000,
          size: 400,
        },
        "/tmp/fonts/inter-latin-ext-wght-normal.woff2": {
          mtimeMs: 5000,
          size: 500,
        },
      }),
    );

    expect(
      resolveVersionedMainviewAssetRequest(
        `${snapshot.assetRoot}/index.js`,
        snapshot,
      ),
    ).toEqual({
      contentType: "application/javascript; charset=utf-8",
      filePath: "/tmp/mainview/index.js",
    });
    expect(
      resolveVersionedMainviewAssetRequest(
        `${MAINVIEW_ASSET_ROUTE_PREFIX}/stale/index.js`,
        snapshot,
      ),
    ).toBeNull();
    expect(
      resolveVersionedMainviewAssetRequest(
        `${snapshot.assetRoot}/secret.txt`,
        snapshot,
      ),
    ).toBeNull();
  });

  it("replaces every HTML asset placeholder with the current asset root", () => {
    expect(
      applyMainviewAssetRoot(
        `${MAINVIEW_ASSET_ROOT_PLACEHOLDER}/index.css ${MAINVIEW_ASSET_ROOT_PLACEHOLDER}/index.js`,
        "/assets/mainview/abc123",
      ),
    ).toBe(
      "/assets/mainview/abc123/index.css /assets/mainview/abc123/index.js",
    );
  });

  it("uses immutable caching for versioned asset routes", () => {
    expect(IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL).toBe(
      "public, max-age=31536000, immutable",
    );
  });
});
