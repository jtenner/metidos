/**
 * @file src/bun/pi/web-server/thread.ts
 * @description Worker thread that hosts a project-scoped static HTTP server.
 */

import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { pathIsWithinRoot } from "../../project-procedures/shared";
import { WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER } from "./share";

type WebServerWorkerCommand = {
  type: "kill";
};

type WebServerWorkerStatusMessage =
  | {
      type: "error";
      error: string;
    }
  | {
      type: "ready";
      host: string;
      port: number;
      rootPath: string;
    }
  | {
      type: "stopped";
    };

type WebServerWorkerConfig = {
  host?: string;
  rootPath?: string;
  serverInstanceId?: string;
  worktreeRootPath?: string;
};

const configuredWorkerData =
  typeof workerData === "object" && workerData !== null
    ? (workerData as WebServerWorkerConfig)
    : {};
const configuredRootPath = configuredWorkerData.rootPath?.trim() ?? "";
const configuredServerInstanceId =
  configuredWorkerData.serverInstanceId?.trim() ?? "";
const configuredWorktreeRootPath =
  configuredWorkerData.worktreeRootPath?.trim() ?? "";
const configuredHost = configuredWorkerData.host?.trim() || "127.0.0.1";
const MAX_DIRECTORY_LISTING_ENTRIES = 500;
const rootPath = resolve(configuredRootPath);
const worktreeRootPath = configuredWorktreeRootPath
  ? resolve(configuredWorktreeRootPath)
  : null;

type CurrentRootState =
  | {
      exists: false;
      realRootPath: string;
      rootIsDirectory: false;
      rootIsFile: false;
    }
  | {
      exists: true;
      realRootPath: string;
      rootIsDirectory: boolean;
      rootIsFile: boolean;
    };

let server: Bun.Server<unknown> | null = null;

function postStatus(payload: WebServerWorkerStatusMessage): void {
  parentPort?.postMessage(payload);
}

function postError(error: unknown): void {
  postStatus({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encodedPathPrefix(pathname: string): string {
  const encodedSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)));
  return `/${encodedSegments.join("/")}${encodedSegments.length > 0 ? "/" : ""}`;
}

function parentEncodedPath(pathname: string): string | null {
  const encodedSegments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)));
  if (encodedSegments.length === 0) {
    return null;
  }
  if (encodedSegments.length === 1) {
    return "/";
  }
  return `/${encodedSegments.slice(0, -1).join("/")}/`;
}

function directoryListingHtml(directoryPath: string, pathname: string): string {
  const hrefPrefix = encodedPathPrefix(pathname);
  const allEntries = readdirSync(directoryPath, {
    withFileTypes: true,
  })
    .map((entry) => ({
      href: `${hrefPrefix}${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`,
      isDirectory: entry.isDirectory(),
      name: entry.name,
    }))
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
  const truncated = allEntries.length > MAX_DIRECTORY_LISTING_ENTRIES;
  const entries = allEntries.slice(0, MAX_DIRECTORY_LISTING_ENTRIES);

  const parentPath = parentEncodedPath(pathname);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8" />',
    `  <title>Index of ${escapeHtml(pathname)}</title>`,
    "</head>",
    "<body>",
    `  <h1>Index of ${escapeHtml(pathname)}</h1>`,
    "  <ul>",
    ...(parentPath
      ? [`    <li><a href="${escapeHtml(parentPath)}">../</a></li>`]
      : []),
    ...entries.map(
      (entry) =>
        `    <li><a href="${escapeHtml(entry.href)}">${escapeHtml(entry.name)}${entry.isDirectory ? "/" : ""}</a></li>`,
    ),
    ...(truncated
      ? [
          `    <li><em>Directory listing truncated to ${MAX_DIRECTORY_LISTING_ENTRIES} entries.</em></li>`,
        ]
      : []),
    "  </ul>",
    "</body>",
    "</html>",
  ].join("\n");
}

function buildFileResponse(filePath: string): Response {
  return new Response(Bun.file(filePath), {
    headers: {
      "cache-control": "no-store",
    },
  });
}

function readCurrentRootState(): CurrentRootState {
  if (!configuredRootPath || !existsSync(rootPath)) {
    return {
      exists: false,
      realRootPath: rootPath,
      rootIsDirectory: false,
      rootIsFile: false,
    };
  }
  const realRootPath = realpathSync(rootPath);
  if (worktreeRootPath && !pathIsWithinRoot(worktreeRootPath, realRootPath)) {
    return {
      exists: false,
      realRootPath,
      rootIsDirectory: false,
      rootIsFile: false,
    };
  }
  const rootStats = statSync(realRootPath);
  return {
    exists: true,
    realRootPath,
    rootIsDirectory: rootStats.isDirectory(),
    rootIsFile: rootStats.isFile(),
  };
}

function resolveExistingTarget(
  realRootPath: string,
  absolutePath: string,
): string | null {
  const normalizedPath = resolve(absolutePath);
  if (!pathIsWithinRoot(realRootPath, normalizedPath)) {
    return null;
  }

  try {
    const realTargetPath = realpathSync(normalizedPath);
    if (!pathIsWithinRoot(realRootPath, realTargetPath)) {
      return null;
    }
    return realTargetPath;
  } catch {
    return null;
  }
}

function resolveDirectoryTarget(
  realRootPath: string,
  pathname: string,
): string | null {
  const decodedPathname = decodeURIComponent(pathname);
  const trimmedPathname = decodedPathname.replace(/^\/+/, "");
  return resolveExistingTarget(
    realRootPath,
    resolve(realRootPath, trimmedPathname),
  );
}

function handleDirectoryRequest(
  realRootPath: string,
  request: Request,
): Response {
  const url = new URL(request.url);
  let targetPath: string | null = null;
  try {
    targetPath = resolveDirectoryTarget(realRootPath, url.pathname);
  } catch {
    return new Response("Bad request.", {
      status: 400,
    });
  }
  if (!targetPath || !existsSync(targetPath)) {
    return new Response("Not found.", {
      status: 404,
    });
  }

  const targetStats = statSync(targetPath);
  if (targetStats.isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      const redirectUrl = new URL(request.url);
      redirectUrl.pathname = encodedPathPrefix(url.pathname);
      return Response.redirect(redirectUrl, 307);
    }

    const indexPath = resolveExistingTarget(
      realRootPath,
      resolve(targetPath, "index.html"),
    );
    if (indexPath && statSync(indexPath).isFile()) {
      return buildFileResponse(indexPath);
    }

    return new Response(directoryListingHtml(targetPath, url.pathname), {
      headers: {
        "cache-control": "no-store",
        "content-type": "text/html; charset=utf-8",
      },
      status: 200,
    });
  }

  if (!targetStats.isFile()) {
    return new Response("Not found.", {
      status: 404,
    });
  }

  return buildFileResponse(targetPath);
}

function handleSingleFileRequest(
  realRootPath: string,
  request: Request,
): Response {
  const url = new URL(request.url);
  const decodedPathname = decodeURIComponent(url.pathname);
  const rootName = basename(rootPath);
  if (decodedPathname !== "/" && decodedPathname !== `/${rootName}`) {
    return new Response("Not found.", {
      status: 404,
    });
  }
  return buildFileResponse(realRootPath);
}

function applyInstanceHeader(response: Response): Response {
  if (configuredServerInstanceId) {
    response.headers.set(
      WEB_SERVER_SHARE_UPSTREAM_INSTANCE_HEADER,
      configuredServerInstanceId,
    );
  }
  return response;
}

function handleRequest(request: Request): Response {
  if (request.method !== "GET") {
    return applyInstanceHeader(
      new Response("Method not allowed.", {
        headers: {
          allow: "GET",
        },
        status: 405,
      }),
    );
  }

  const currentRoot = readCurrentRootState();
  if (currentRoot.rootIsDirectory) {
    return applyInstanceHeader(
      handleDirectoryRequest(currentRoot.realRootPath, request),
    );
  }
  if (currentRoot.rootIsFile) {
    return applyInstanceHeader(
      handleSingleFileRequest(currentRoot.realRootPath, request),
    );
  }
  return applyInstanceHeader(
    new Response("Hosted path is unavailable.", {
      status: 404,
    }),
  );
}

function stopServer(): void {
  if (server) {
    try {
      server.stop(true);
    } catch {
      // Ignore repeated stop attempts during shutdown.
    }
    server = null;
  }
  postStatus({
    type: "stopped",
  });
}

parentPort?.on("message", (command: WebServerWorkerCommand) => {
  if (!command || command.type !== "kill") {
    return;
  }
  stopServer();
});

try {
  if (!configuredRootPath) {
    throw new Error("Web server rootPath is required.");
  }
  const currentRoot = readCurrentRootState();
  if (!currentRoot.exists) {
    throw new Error(`Hosted path does not exist: ${configuredRootPath}`);
  }
  if (!currentRoot.rootIsDirectory && !currentRoot.rootIsFile) {
    throw new Error(
      `Hosted path must be a file or directory: ${configuredRootPath}`,
    );
  }

  server = Bun.serve({
    fetch: handleRequest,
    hostname: configuredHost,
    port: 0,
  });
  if (typeof server.port !== "number") {
    throw new Error("Web server did not report a listening port.");
  }

  postStatus({
    type: "ready",
    host: configuredHost,
    port: server.port,
    rootPath: currentRoot.realRootPath,
  });
} catch (error) {
  postError(error);
}
