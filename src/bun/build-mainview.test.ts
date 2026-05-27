/**
 * @file src/bun/build-mainview.test.ts
 * @description Test file for build-mainview.
 */

import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectMainviewBuildAssetPaths,
  resolveMainviewBuildOptions,
} from "./build-mainview";

describe("resolveMainviewBuildOptions", () => {
  it("defaults to a production build that is minified and sourcemap-free", () => {
    expect(
      resolveMainviewBuildOptions({
        args: [],
        env: {},
      }),
    ).toEqual({
      emitSourceMap: false,
      minify: true,
      mode: "production",
      sourcemap: "none",
    });
  });

  it("uses development mode from the cli and keeps sourcemaps on", () => {
    expect(
      resolveMainviewBuildOptions({
        args: ["--dev"],
        env: {},
      }),
    ).toEqual({
      emitSourceMap: true,
      minify: false,
      mode: "development",
      sourcemap: "external",
    });
  });

  it("lets an explicit production flag override the dev env", () => {
    expect(
      resolveMainviewBuildOptions({
        args: ["--production"],
        env: {
          METIDOS_DEV: "1",
        },
      }),
    ).toEqual({
      emitSourceMap: false,
      minify: true,
      mode: "production",
      sourcemap: "none",
    });
  });

  it("supports production sourcemaps only when explicitly requested", () => {
    expect(
      resolveMainviewBuildOptions({
        args: [],
        env: {
          METIDOS_MAINVIEW_SOURCEMAP: "1",
        },
      }),
    ).toEqual({
      emitSourceMap: true,
      minify: true,
      mode: "production",
      sourcemap: "external",
    });
  });

  it("allows explicit cli sourcemap opt-out even in development mode", () => {
    expect(
      resolveMainviewBuildOptions({
        args: ["--dev", "--no-sourcemap"],
        env: {},
      }),
    ).toEqual({
      emitSourceMap: false,
      minify: false,
      mode: "development",
      sourcemap: "none",
    });
  });
});

describe("collectMainviewBuildAssetPaths", () => {
  it("includes current outputs and stale chunk assets from the build directory", () => {
    const buildDir = mkdtempSync(join(tmpdir(), "metidos-mainview-build-"));
    try {
      writeFileSync(join(buildDir, "chunk-old123.js"), "old");
      writeFileSync(join(buildDir, "chunk-old123.js.map"), "{}");
      writeFileSync(join(buildDir, "index.js"), "index");
      writeFileSync(join(buildDir, "notes.txt"), "notes");

      expect(
        collectMainviewBuildAssetPaths(buildDir, [
          join(buildDir, "chunk-current456.js"),
        ]),
      ).toEqual([
        join(buildDir, "chunk-current456.js"),
        join(buildDir, "chunk-old123.js"),
        join(buildDir, "chunk-old123.js.map"),
      ]);
    } finally {
      rmSync(buildDir, { force: true, recursive: true });
    }
  });

  it("returns base asset paths when the build directory is absent", () => {
    expect(
      collectMainviewBuildAssetPaths("/tmp/metidos-mainview-build-missing", [
        "/tmp/chunk-current456.js",
      ]),
    ).toEqual(["/tmp/chunk-current456.js"]);
  });
});
