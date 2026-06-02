import { describe, expect, test } from "bun:test";
import { IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL } from "../mainview-assets";
import { handleMainviewStaticAssetRequest } from "./static-assets";

const testPaths = {
  cssPath: "/app/index.css",
  bundlePath: "/app/index.js",
  ghosttyWasmPath: "/app/ghostty-vt.wasm",
  bundleSourceMapPath: "/app/index.js.map",
  firaCodeFontPath: "/app/fira.woff2",
  interLatinFontPath: "/app/inter-latin.woff2",
  interLatinExtFontPath: "/app/inter-latin-ext.woff2",
};

function createOptions(pathname: string) {
  const calls: Array<{
    path: string;
    contentType: string;
    cacheControl: string | undefined;
  }> = [];
  const traces: string[] = [];
  return {
    calls,
    traces,
    options: {
      backendOnly: false,
      pathname,
      source: "http://localhost:7599",
      requestId: "req-1",
      htmlResponse: async () => new Response("html"),
      fileResponse: (
        path: string,
        contentType: string,
        options?: { cacheControl?: string },
      ) => {
        calls.push({ path, contentType, cacheControl: options?.cacheControl });
        return new Response(path);
      },
      getAssetSnapshot: () => ({
        assetRoot: "/assets/mainview/v1",
        version: "v1",
        assetsByRelativePath: new Map([
          [
            "index.js",
            {
              filePath: "/versioned/index.js",
              contentType: "application/javascript; charset=utf-8",
            },
          ],
        ]),
      }),
      paths: testPaths,
      trace: (message: string) => {
        traces.push(message);
      },
    },
  };
}

describe("handleMainviewStaticAssetRequest", () => {
  test("returns the HTML entrypoint without using static asset caching", async () => {
    const { options, traces, calls } = createOptions("/");

    const response = await handleMainviewStaticAssetRequest(options);

    expect(await response?.text()).toBe("html");
    expect(calls).toEqual([]);
    expect(response?.headers.get("Cache-Control")).toBeNull();
    expect(traces).toEqual(["Serving HTML entrypoint"]);
  });

  test("serves versioned assets with immutable cache policy", async () => {
    const { options, calls } = createOptions("/assets/mainview/v1/index.js");

    const response = await handleMainviewStaticAssetRequest(options);

    expect(await response?.text()).toBe("/versioned/index.js");
    expect(calls).toEqual([
      {
        path: "/versioned/index.js",
        contentType: "application/javascript; charset=utf-8",
        cacheControl: IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL,
      },
    ]);
  });

  test("serves compatibility asset routes", async () => {
    const { options, calls } = createOptions(
      "/fonts/inter-latin-wght-normal.woff2",
    );

    const response = await handleMainviewStaticAssetRequest(options);

    expect(await response?.text()).toBe(testPaths.interLatinFontPath);
    expect(calls).toEqual([
      {
        path: testPaths.interLatinFontPath,
        contentType: "font/woff2",
        cacheControl: undefined,
      },
    ]);
  });

  test("falls through for backend-only and unrelated routes", async () => {
    const backendOnly = createOptions("/index.js");
    backendOnly.options.backendOnly = true;
    const unrelated = createOptions("/health");

    await expect(
      handleMainviewStaticAssetRequest(backendOnly.options),
    ).resolves.toBeNull();
    await expect(
      handleMainviewStaticAssetRequest(unrelated.options),
    ).resolves.toBeNull();
  });
});
