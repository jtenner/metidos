/**
 * @file src/bun/pi/web-server/tools.ts
 * @description Project-scoped static web-server tool definitions.
 */

import { existsSync, realpathSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { relative, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  createWebServerShare,
  initAppDatabase,
  stopWebServerShareByServerInstanceId,
} from "../../db";
import { pathIsWithinRoot } from "../../project-procedures/shared";
import { textToolResult } from "../metidos/shared";
import {
  buildWebServerShareOpenUrl,
  buildWebServerShareRouteUrl,
  generateWebServerShareOpaqueToken,
  hashWebServerShareOpaqueToken,
  resolveWebServerShareOrigin,
} from "./share";

const WEB_SERVER_HOST = "127.0.0.1";
const WEB_SERVER_THREAD_START_TIMEOUT_MS = 5_000;
const WEB_SERVER_THREAD_STOP_TIMEOUT_MS = 2_000;
const WEB_SERVER_THREAD_URL = new URL("./thread.ts", import.meta.url);
const WEB_SERVER_HOST_DESCRIPTION_CACHE_TTL_MS = 30_000;
const MAX_HOSTED_WEB_SERVERS_PER_MANAGER = 8;

type PiWebServerToolScope = {
  ownerUserId?: number | undefined;
  projectId?: number | undefined;
  threadId?: number | undefined;
  worktreePathContext: string;
};

type PiWebServerHostLink = {
  host: string;
  url: string;
};

type PiWebServerHostResult = {
  computerName: string | null;
  host: string;
  id: number;
  links: PiWebServerHostLink[];
  path: string;
  port: number;
  serverInstanceId: string;
  shareClaimToken: string | null;
  shareOpenUrl: string | null;
  shareRouteUrl: string | null;
  url: string;
};

type PiWebServerListResult = {
  servers: PiWebServerHostResult[];
};

type PiWebServerStopResult = {
  found: boolean;
  id: number;
};

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

type HostedWebServerEntry = PiWebServerHostResult & {
  absolutePath: string;
  worker: Worker;
};

const WebServerHostParameters = Type.Object({
  path: Type.String({
    description:
      "File or directory path to host, relative to the current project root or as an absolute path inside it.",
    minLength: 1,
  }),
});

const WebServerStopParameters = Type.Object({
  id: Type.Integer({
    minimum: 1,
  }),
});

const WebServerListParameters = Type.Object({});

export function buildPiWebServerPromptLine(): string {
  return "Project-scoped WebServer tools are installed in this runtime: web_server_host, web_server_stop, and web_server_list. Use them to host a file or directory from the current workspace on a loopback-only static HTTP server reachable from the local machine. Successful hosts also get a stable share/open URL plus a claim token delivered in the RPC details; the UI must POST that token to /share/open before navigating to the clean /s/<thread>/<server>/ route.";
}

export type PiWebServerManager = {
  dispose: () => Promise<void>;
  hostPath: (candidatePath: string) => Promise<PiWebServerHostResult>;
  listServers: () => PiWebServerHostResult[];
  stopServer: (id: number) => Promise<boolean>;
};

function formatHttpUrl(host: string, port: number): string {
  return host.includes(":")
    ? `http://[${host}]:${port}/`
    : `http://${host}:${port}/`;
}

function isLoopbackDirectWebServerHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

function collectReachableWebServerHosts(): {
  computerName: string | null;
  hosts: string[];
} {
  const seenHosts = new Set<string>();
  const orderedHosts: string[] = [];
  const addHost = (candidateHost: string | null | undefined) => {
    const trimmedHost = candidateHost?.trim();
    if (!trimmedHost) {
      return;
    }
    const normalizedHost = trimmedHost.split("%")[0]?.trim() ?? "";
    if (!isLoopbackDirectWebServerHost(normalizedHost)) {
      return;
    }
    if (seenHosts.has(normalizedHost)) {
      return;
    }
    seenHosts.add(normalizedHost);
    orderedHosts.push(normalizedHost);
  };

  const hostName = hostname().trim() || null;
  const computerName =
    hostName && isLoopbackDirectWebServerHost(hostName) ? hostName : null;
  addHost(computerName);
  addHost("localhost");
  addHost("127.0.0.1");
  addHost("::1");

  return {
    computerName,
    hosts: orderedHosts,
  };
}

function buildWebServerReachableLinks(port: number): {
  computerName: string | null;
  links: PiWebServerHostLink[];
  preferredHost: string | null;
} {
  const { computerName, hosts } = collectReachableWebServerHosts();
  return {
    computerName,
    links: hosts.map((host) => ({
      host,
      url: formatHttpUrl(host, port),
    })),
    preferredHost: hosts[0] ?? null,
  };
}

let cachedWebServerHostToolDescription: {
  expiresAt: number;
  value: string;
} | null = null;

function buildWebServerHostToolDescription(): string {
  const now = Date.now();
  if (
    cachedWebServerHostToolDescription &&
    cachedWebServerHostToolDescription.expiresAt > now
  ) {
    return cachedWebServerHostToolDescription.value;
  }

  const { computerName, hosts } = collectReachableWebServerHosts();
  const dynamicHostDetails = [
    ...(computerName ? [`Current computer name: ${computerName}.`] : []),
    ...(hosts.length > 0
      ? [`Loopback direct hosts for this server: ${hosts.join(", ")}.`]
      : []),
  ].join(" ");
  const description = [
    "Host a project-local file or directory on a static HTTP server bound to loopback.",
    "The path must stay inside the current project root.",
    "Returns a preferred stable share/open link first, then direct clickable markdown links for loopback addresses only.",
    dynamicHostDetails,
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  cachedWebServerHostToolDescription = {
    expiresAt: now + WEB_SERVER_HOST_DESCRIPTION_CACHE_TTL_MS,
    value: description,
  };
  return description;
}

function formatHostedWebServerMarkdown(server: PiWebServerHostResult): string {
  return [
    `Hosted ${server.path} as web server ${server.id}.`,
    "",
    ...(server.shareOpenUrl
      ? [
          `- Preferred share link: [${server.shareOpenUrl}](${server.shareOpenUrl})`,
          ...(server.shareRouteUrl
            ? [
                `- Stable share route after claiming once: \`${server.shareRouteUrl}\``,
              ]
            : []),
        ]
      : []),
    `- Bound on: \`${server.host}:${server.port}\``,
    `- Server instance id: \`${server.serverInstanceId}\``,
    ...(server.computerName
      ? [
          `- Computer name: [${server.computerName}](${formatHttpUrl(server.computerName, server.port)})`,
        ]
      : []),
    "",
    "Open one of these direct links:",
    ...server.links.map((link) => `- [${link.url}](${link.url})`),
  ].join("\n");
}

function formatWebServerListMarkdown(
  servers: readonly PiWebServerHostResult[],
): string {
  return [
    "| id | path | port |",
    "| --- | --- | --- |",
    ...(servers.length > 0
      ? servers.map(
          (server) => `| ${server.id} | ${server.path} | ${server.port} |`,
        )
      : ["| _None_ |  |  |"]),
  ].join("\n");
}

function buildShareUrls(options: {
  preferredHost: string | null;
  serverId: number;
  threadId: number | undefined;
  claimToken: string | null;
}): {
  shareOpenUrl: string | null;
  shareRouteUrl: string | null;
} {
  if (typeof options.threadId !== "number") {
    return {
      shareOpenUrl: null,
      shareRouteUrl: null,
    };
  }
  const origin = resolveWebServerShareOrigin({
    fallbackHost: options.preferredHost,
  });
  return {
    shareOpenUrl: options.claimToken
      ? buildWebServerShareOpenUrl(origin, options.claimToken)
      : null,
    shareRouteUrl: buildWebServerShareRouteUrl(
      origin,
      options.threadId,
      options.serverId,
      "/",
    ),
  };
}

function stopHostedWebServerShare(serverInstanceId: string): void {
  try {
    stopWebServerShareByServerInstanceId(initAppDatabase(), serverInstanceId);
  } catch {
    // Ignore share-state cleanup failures during worker teardown paths.
  }
}

export function createPiWebServerManager(
  scope: PiWebServerToolScope,
): PiWebServerManager {
  let nextServerId = 1;
  const hostedServers = new Map<number, HostedWebServerEntry>();

  function listServers(): PiWebServerHostResult[] {
    return [...hostedServers.values()]
      .sort((left, right) => left.id - right.id)
      .map(({ absolutePath: _absolutePath, worker: _worker, ...server }) => ({
        ...server,
      }));
  }

  function resolveHostedPath(candidatePath: string): {
    absolutePath: string;
    displayPath: string;
    realWorkspacePath: string;
  } {
    const trimmedPath = candidatePath.trim();
    if (!trimmedPath) {
      throw new Error("Path is required.");
    }

    const workspacePath = resolve(scope.worktreePathContext);
    const absolutePath = resolve(workspacePath, trimmedPath);
    if (!pathIsWithinRoot(workspacePath, absolutePath)) {
      throw new Error(
        `Path is outside the current project root: ${candidatePath.trim()}`,
      );
    }
    if (!existsSync(absolutePath)) {
      throw new Error(`Path does not exist: ${candidatePath.trim()}`);
    }

    const realWorkspacePath = realpathSync(workspacePath);
    const realAbsolutePath = realpathSync(absolutePath);
    if (!pathIsWithinRoot(realWorkspacePath, realAbsolutePath)) {
      throw new Error(
        `Path is outside the current project root: ${candidatePath.trim()}`,
      );
    }

    const stats = statSync(realAbsolutePath);
    if (!stats.isDirectory() && !stats.isFile()) {
      throw new Error(
        `Path must be a file or directory: ${candidatePath.trim()}`,
      );
    }

    const relativePath = relative(workspacePath, absolutePath).replaceAll(
      "\\",
      "/",
    );
    return {
      absolutePath,
      displayPath: relativePath || ".",
      realWorkspacePath,
    };
  }

  function awaitWorkerMessage(
    worker: Worker,
    options: {
      predicate: (message: WebServerWorkerStatusMessage) => boolean;
      timeoutMs: number;
      timeoutMessage: string;
    },
  ): Promise<WebServerWorkerStatusMessage> {
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(options.timeoutMessage));
      }, options.timeoutMs);

      const handleMessage = (message: WebServerWorkerStatusMessage) => {
        if (!message || !options.predicate(message)) {
          return;
        }
        cleanup();
        resolvePromise(message);
      };
      const handleError = (error: Error) => {
        cleanup();
        reject(new Error(error.message || "Web server worker failed."));
      };
      const cleanup = () => {
        clearTimeout(timeout);
        worker.off("message", handleMessage);
        worker.off("error", handleError);
        worker.off("messageerror", handleError);
      };

      worker.on("message", handleMessage);
      worker.on("error", handleError);
      worker.on("messageerror", handleError);
    });
  }

  async function stopServer(id: number): Promise<boolean> {
    const current = hostedServers.get(id);
    if (!current) {
      return false;
    }

    hostedServers.delete(id);
    if (current.shareOpenUrl) {
      stopHostedWebServerShare(current.serverInstanceId);
    }
    try {
      current.worker.postMessage({
        type: "kill",
      } satisfies WebServerWorkerCommand);
      await awaitWorkerMessage(current.worker, {
        predicate: (message) =>
          message.type === "stopped" || message.type === "error",
        timeoutMessage: `Timed out while stopping web server ${id}.`,
        timeoutMs: WEB_SERVER_THREAD_STOP_TIMEOUT_MS,
      });
    } catch {
      // Fall through to forced termination below.
    }

    current.worker.terminate();
    return true;
  }

  async function hostPath(
    candidatePath: string,
  ): Promise<PiWebServerHostResult> {
    if (hostedServers.size >= MAX_HOSTED_WEB_SERVERS_PER_MANAGER) {
      throw new Error(
        `This thread already has ${MAX_HOSTED_WEB_SERVERS_PER_MANAGER} hosted web servers. Stop an existing server before starting another one.`,
      );
    }

    const { absolutePath, displayPath, realWorkspacePath } =
      resolveHostedPath(candidatePath);
    const serverId = nextServerId;
    const serverInstanceId = crypto.randomUUID();
    nextServerId += 1;

    const worker = new Worker(WEB_SERVER_THREAD_URL, {
      name: `metidos-web-server-${serverId}`,
      workerData: {
        host: WEB_SERVER_HOST,
        rootPath: absolutePath,
        serverInstanceId,
        worktreeRootPath: realWorkspacePath,
      },
    });
    let shareRegistered = false;
    let workerStopped = false;
    const removeHostedServer = () => {
      workerStopped = true;
      hostedServers.delete(serverId);
      if (shareRegistered) {
        shareRegistered = false;
        stopHostedWebServerShare(serverInstanceId);
      }
    };
    const handleWorkerError = () => {
      removeHostedServer();
      worker.terminate().catch(() => {
        // Ignore termination failures after the worker has already errored.
      });
    };
    worker.on("error", handleWorkerError);
    worker.on("message", (message: WebServerWorkerStatusMessage | null) => {
      if (message?.type === "stopped" || message?.type === "error") {
        removeHostedServer();
      }
    });

    let readyMessage: Extract<WebServerWorkerStatusMessage, { type: "ready" }>;
    try {
      const message = await awaitWorkerMessage(worker, {
        predicate: (nextMessage) =>
          nextMessage.type === "ready" || nextMessage.type === "error",
        timeoutMessage: `Timed out while starting a web server for ${displayPath}.`,
        timeoutMs: WEB_SERVER_THREAD_START_TIMEOUT_MS,
      });
      if (message.type === "error") {
        throw new Error(message.error);
      }
      if (message.type !== "ready") {
        throw new Error("Web server worker did not report readiness.");
      }
      readyMessage = message;
    } catch (error) {
      worker.terminate();
      throw error;
    }

    const reachableLinks = buildWebServerReachableLinks(readyMessage.port);
    let claimToken: string | null = null;
    if (typeof scope.threadId === "number") {
      claimToken = generateWebServerShareOpaqueToken();
      try {
        createWebServerShare(initAppDatabase(), {
          claimTokenHash: hashWebServerShareOpaqueToken(claimToken),
          projectId: scope.projectId ?? null,
          serverId,
          serverInstanceId,
          targetPort: readyMessage.port,
          threadId: scope.threadId,
          worktreePath: scope.worktreePathContext,
        });
        shareRegistered = true;
      } catch (error) {
        try {
          worker.postMessage({
            type: "kill",
          } satisfies WebServerWorkerCommand);
        } catch {
          // Ignore follow-up shutdown failures while surfacing share creation errors.
        }
        worker.terminate();
        throw error;
      }
    }

    const shareUrls = buildShareUrls({
      claimToken,
      preferredHost: reachableLinks.preferredHost,
      serverId,
      threadId: scope.threadId,
    });
    const result = {
      computerName: reachableLinks.computerName,
      host: readyMessage.host,
      id: serverId,
      links: reachableLinks.links,
      path: displayPath,
      port: readyMessage.port,
      serverInstanceId,
      shareClaimToken: claimToken,
      shareOpenUrl: shareUrls.shareOpenUrl,
      shareRouteUrl: shareUrls.shareRouteUrl,
      url: formatHttpUrl(readyMessage.host, readyMessage.port),
    } satisfies PiWebServerHostResult;
    if (workerStopped) {
      removeHostedServer();
      worker.terminate();
      throw new Error("Web server worker stopped before registration.");
    }
    hostedServers.set(serverId, {
      ...result,
      absolutePath,
      worker,
    });
    return result;
  }

  async function dispose(): Promise<void> {
    const snapshot = [...hostedServers.values()];
    hostedServers.clear();
    const terminatePromises: Promise<number>[] = [];
    for (const entry of snapshot) {
      if (entry.shareOpenUrl) {
        stopHostedWebServerShare(entry.serverInstanceId);
      }
      try {
        entry.worker.postMessage({
          type: "kill",
        } satisfies WebServerWorkerCommand);
      } catch {
        // Ignore workers that are already gone.
      }
      terminatePromises.push(entry.worker.terminate());
    }
    await Promise.allSettled(terminatePromises);
  }

  return {
    dispose,
    hostPath,
    listServers,
    stopServer,
  };
}

function prepareWebServerStopArguments(args: { id: number | string }): {
  id: number;
} {
  if (typeof args.id === "number") {
    return {
      id: args.id,
    };
  }

  const parsed = Number.parseInt(args.id.trim(), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("id must be a positive integer.");
  }
  return {
    id: parsed,
  };
}

export function createPiWebServerTools(
  scope: PiWebServerToolScope,
  manager = createPiWebServerManager(scope),
): ToolDefinition[] {
  return [
    defineTool<typeof WebServerHostParameters, PiWebServerHostResult>({
      get description() {
        return buildWebServerHostToolDescription();
      },
      execute: async (_toolCallId, params) => {
        const server = await manager.hostPath(params.path);
        return textToolResult(formatHostedWebServerMarkdown(server), server);
      },
      label: "Host Web Server",
      name: "web_server_host",
      parameters: WebServerHostParameters,
      promptGuidelines: [
        "Use this when you need a loopback-only static HTTP server for a file or directory inside the current workspace.",
        "The result prefers a stable share/open link first, delivers the share claim token in RPC details for the UI to POST to /share/open, then includes direct clickable markdown links for loopback addresses only.",
        "The path must stay inside the current project root.",
      ],
      promptSnippet:
        "Host a project-local file or directory on a local HTTP server",
    }),
    defineTool<typeof WebServerStopParameters, PiWebServerStopResult>({
      description:
        "Stop a static HTTP server previously started with web_server_host.",
      execute: async (_toolCallId, params) => {
        const stopped = await manager.stopServer(params.id);
        return textToolResult(
          stopped
            ? `Stopped web server ${params.id}.`
            : `Web server ${params.id} was not found.`,
          {
            found: stopped,
            id: params.id,
          },
        );
      },
      label: "Stop Web Server",
      name: "web_server_stop",
      parameters: WebServerStopParameters,
      prepareArguments: (args) => prepareWebServerStopArguments(args as never),
      promptSnippet: "Stop a hosted local web server by id",
    }),
    defineTool<typeof WebServerListParameters, PiWebServerListResult>({
      description:
        "List every static HTTP server started in this thread runtime.",
      execute: async () => {
        const servers = manager.listServers();
        return textToolResult(formatWebServerListMarkdown(servers), {
          servers,
        });
      },
      label: "List Web Servers",
      name: "web_server_list",
      parameters: WebServerListParameters,
      promptSnippet: "List hosted local web servers",
    }),
  ];
}
