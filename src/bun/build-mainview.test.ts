/**
 * @file src/bun/build-mainview.test.ts
 * @description Test file for build-mainview.
 */

import { describe, expect, it } from "bun:test";

import { resolveMainviewBuildOptions } from "./build-mainview";

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
