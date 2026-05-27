/**
 * @file src/bun/mainview-assets.test.ts
 * @description Test file for mainview-assets.
 */

import { describe, expect, it } from "bun:test";

import {
  applyMainviewAssetRoot,
  buildMainviewAssetSnapshot,
  buildMainviewAssetVersion,
  MAINVIEW_ASSET_ROOT_PLACEHOLDER,
  MAINVIEW_ASSET_ROUTE_PREFIX,
  resolveVersionedMainviewAssetRequest,
} from "./mainview-assets";

const TEST_BUILD_OPTIONS = {
  birdPath: "/tmp/mainview/bird.png",
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
        "/tmp/mainview/bird.png": { mtimeMs: 900, size: 90 },
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
    expect(snapshot.assetsByRelativePath.has("bird.png")).toBeTrue();
    expect(snapshot.assetsByRelativePath.has("index.js")).toBeTrue();
    expect(snapshot.assetsByRelativePath.has("index.css")).toBeTrue();
    expect(snapshot.assetsByRelativePath.has("index.js.map")).toBeFalse();
  });

  it("resolves versioned asset requests from the allowlisted asset set", () => {
    const snapshot = buildMainviewAssetSnapshot(
      {
        ...TEST_BUILD_OPTIONS,
        buildAssetPaths: [
          "/tmp/mainview/chunk-terminal-workspace-a1b2c3.js",
          "/tmp/mainview/chunk-terminal-workspace-a1b2c3.js.map",
        ],
      },
      mockStatFactory({
        "/tmp/mainview/bird.png": { mtimeMs: 900, size: 90 },
        "/tmp/mainview/index.css": { mtimeMs: 1000, size: 100 },
        "/tmp/mainview/index.js": { mtimeMs: 2000, size: 200 },
        "/tmp/mainview/index.js.map": { mtimeMs: 2500, size: 250 },
        "/tmp/mainview/chunk-terminal-workspace-a1b2c3.js": {
          mtimeMs: 2600,
          size: 260,
        },
        "/tmp/mainview/chunk-terminal-workspace-a1b2c3.js.map": {
          mtimeMs: 2700,
          size: 270,
        },
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
        `${MAINVIEW_ASSET_ROUTE_PREFIX}/stale/index.css`,
        snapshot,
      ),
    ).toEqual({
      contentType: "text/css; charset=utf-8",
      filePath: "/tmp/mainview/index.css",
    });
    expect(
      resolveVersionedMainviewAssetRequest(
        `${snapshot.assetRoot}/chunk-terminal-workspace-a1b2c3.js`,
        snapshot,
      ),
    ).toEqual({
      contentType: "application/javascript; charset=utf-8",
      filePath: "/tmp/mainview/chunk-terminal-workspace-a1b2c3.js",
    });
    expect(
      resolveVersionedMainviewAssetRequest(
        `${MAINVIEW_ASSET_ROUTE_PREFIX}/stale`,
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
});
