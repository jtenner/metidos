import {
  IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL,
  MAINVIEW_ASSET_ROUTE_PREFIX,
  type MainviewAssetSnapshot,
  resolveVersionedMainviewAssetRequest,
} from "../mainview-assets";

export type FileResponseBuilder = (
  path: string,
  contentType: string,
  options?: {
    cacheControl?: string;
  },
) => Response;

export type StaticAssetTraceContext = {
  pathname: string;
  source: string;
  requestId: string | null;
};

export type MainviewStaticAssetPaths = {
  cssPath: string;
  bundlePath: string;
  ghosttyWasmPath: string;
  bundleSourceMapPath: string | null;
  firaCodeFontPath: string;
  interLatinFontPath: string;
  interLatinExtFontPath: string;
};

export type MainviewStaticAssetHandlerOptions = StaticAssetTraceContext & {
  backendOnly: boolean;
  htmlResponse: () => Promise<Response>;
  fileResponse: FileResponseBuilder;
  getAssetSnapshot: () => MainviewAssetSnapshot;
  paths: MainviewStaticAssetPaths;
  trace?: (message: string, context: StaticAssetTraceContext) => void;
};

function traceStaticAsset(
  options: MainviewStaticAssetHandlerOptions,
  message: string,
): void {
  options.trace?.(message, {
    pathname: options.pathname,
    source: options.source,
    requestId: options.requestId,
  });
}

/**
 * Handles mainview entrypoint and static asset routes.
 *
 * Returning null means the request does not belong to the mainview static asset
 * surface and should continue through the remaining HTTP route chain.
 */
export async function handleMainviewStaticAssetRequest(
  options: MainviewStaticAssetHandlerOptions,
): Promise<Response | null> {
  const { backendOnly, pathname, fileResponse, getAssetSnapshot, paths } =
    options;

  if (backendOnly) {
    return null;
  }

  if (pathname === "/" || pathname === "/index.html") {
    traceStaticAsset(options, "Serving HTML entrypoint");
    return options.htmlResponse();
  }

  if (pathname.startsWith(`${MAINVIEW_ASSET_ROUTE_PREFIX}/`)) {
    const versionedAsset = resolveVersionedMainviewAssetRequest(
      pathname,
      getAssetSnapshot(),
    );
    if (versionedAsset) {
      traceStaticAsset(options, "Serving versioned mainview asset");
      return fileResponse(versionedAsset.filePath, versionedAsset.contentType, {
        cacheControl: IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL,
      });
    }
  }

  if (pathname === "/index.css") {
    traceStaticAsset(options, "Serving mainview css compatibility asset");
    return fileResponse(paths.cssPath, "text/css; charset=utf-8");
  }

  if (pathname === "/index.js") {
    traceStaticAsset(options, "Serving mainview bundle compatibility asset");
    return fileResponse(
      paths.bundlePath,
      "application/javascript; charset=utf-8",
    );
  }

  if (pathname === "/ghostty-vt.wasm") {
    traceStaticAsset(options, "Serving ghostty-web WASM asset");
    return fileResponse(paths.ghosttyWasmPath, "application/wasm", {
      cacheControl: IMMUTABLE_MAINVIEW_ASSET_CACHE_CONTROL,
    });
  }

  if (pathname === "/index.js.map" && paths.bundleSourceMapPath) {
    traceStaticAsset(
      options,
      "Serving mainview source-map compatibility asset",
    );
    return fileResponse(
      paths.bundleSourceMapPath,
      "application/json; charset=utf-8",
    );
  }

  if (pathname === "/fonts/fira-code-vf.woff2") {
    traceStaticAsset(options, "Serving font compatibility asset");
    return fileResponse(paths.firaCodeFontPath, "font/woff2");
  }

  if (pathname === "/fonts/inter-latin-wght-normal.woff2") {
    traceStaticAsset(options, "Serving font compatibility asset");
    return fileResponse(paths.interLatinFontPath, "font/woff2");
  }

  if (pathname === "/fonts/inter-latin-ext-wght-normal.woff2") {
    traceStaticAsset(options, "Serving font compatibility asset");
    return fileResponse(paths.interLatinExtFontPath, "font/woff2");
  }

  return null;
}
