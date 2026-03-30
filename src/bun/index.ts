import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { initAppDatabase } from "./db";
import {
	closeProjectProcedure,
	closeWorktreeProcedure,
	createThreadProcedure,
	createWorktreeProcedure,
	deleteProjectProcedure,
	getThreadProcedure,
	listDirectorySuggestionsProcedure,
	listProjectWorktreesProcedure,
	listProjectsProcedure,
	listThreadsProcedure,
	markThreadErrorSeenProcedure,
	openProjectProcedure,
	openWorktreeProcedure,
	sendThreadMessageProcedure,
	shutdownProjectPolling,
} from "./project-procedures";
import type { AppRPCSchema } from "./rpc-schema";

const DEFAULT_SERVER_PORT = "7599";
const MAINVIEW_SOURCE_DIR = resolve(process.cwd(), "src/mainview");
const MAINVIEW_ENTRYPOINT = resolve(process.cwd(), "src/mainview/index.ts");
const MAINVIEW_HTML_PATH = resolve(process.cwd(), "src/mainview/index.html");
const MAINVIEW_CSS_PATH = resolve(process.cwd(), "src/mainview/index.css");
const MAINVIEW_BUILD_DIR = resolve(process.cwd(), ".jt-ide-build");
const FIRA_CODE_VARIABLE_FONT_PATH = resolve(
	process.cwd(),
	"node_modules/firacode/distr/woff2/FiraCode-VF.woff2",
);
const MAINVIEW_RELOAD_DEBOUNCE_MS = 90;
const MAINVIEW_WATCH_INTERVAL_MS = 250;

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage = {
	type: "request";
	id: number;
	method: RpcMethodName;
	params: RpcRequestMap[RpcMethodName]["params"];
};

type RpcResponseMessage =
	| {
			type: "response";
			id: number;
			ok: true;
			result: unknown;
	  }
	| {
			type: "response";
			id: number;
			ok: false;
			error: string;
	  };

type RpcReloadMessage = {
	type: "reload";
	reason: string;
};

type RpcSocketMessage = RpcResponseMessage | RpcReloadMessage;

type RpcRequestHandlerMap = {
	[K in keyof RpcRequestMap]: (
		params: RpcRequestMap[K]["params"],
	) => Promise<RpcRequestMap[K]["response"]>;
};

function isStringInteger(value: string): boolean {
	return /^\d+$/.test(value);
}

function readCliPort(args: string[]): string | null {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--port" || arg === "-p") {
			const nextArg = args[index + 1];
			if (!nextArg) {
				throw new Error(`Missing value for ${arg}`);
			}
			return nextArg;
		}
		if (arg.startsWith("--port=")) {
			return arg.slice("--port=".length);
		}
		if (arg.startsWith("-p=")) {
			return arg.slice("-p=".length);
		}
	}

	return null;
}

function resolveServerPort(args: string[], envPort?: string): number {
	const configuredPort = readCliPort(args) ?? envPort ?? DEFAULT_SERVER_PORT;
	if (!isStringInteger(configuredPort)) {
		throw new Error(
			`Invalid port "${configuredPort}". Expected an integer string from --port, -p, or JT_IDE_PORT.`,
		);
	}

	const parsedPort = Number.parseInt(configuredPort, 10);
	if (parsedPort < 1 || parsedPort > 65_535) {
		throw new Error(
			`Invalid port "${configuredPort}". Expected an integer string between 1 and 65535.`,
		);
	}

	return parsedPort;
}

const SERVER_ARGS = Bun.argv.slice(2);
const SERVER_PORT = resolveServerPort(SERVER_ARGS, process.env.JT_IDE_PORT);
const IS_DEV_SERVER =
	SERVER_ARGS.includes("--dev") || process.env.JT_IDE_DEV === "1";

const rpcHandlers: RpcRequestHandlerMap = {
	getHomeDirectory: async () => ({
		homeDirectory: homedir(),
		supportsTildePath:
			process.platform === "darwin" || process.platform === "linux",
	}),
	listDirectorySuggestions: (params) =>
		listDirectorySuggestionsProcedure(params),
	listProjects: (params) => listProjectsProcedure(params),
	listThreads: (params) => listThreadsProcedure(params),
	openProject: (params) => openProjectProcedure(params),
	closeProject: (params) => closeProjectProcedure(params),
	deleteProject: (params) => deleteProjectProcedure(params),
	listProjectWorktrees: (params) => listProjectWorktreesProcedure(params),
	createWorktree: (params) => createWorktreeProcedure(params),
	createThread: (params) => createThreadProcedure(params),
	getThread: (params) => getThreadProcedure(params),
	markThreadErrorSeen: (params) => markThreadErrorSeenProcedure(params),
	sendThreadMessage: (params) => sendThreadMessageProcedure(params),
	openWorktree: (params) => openWorktreeProcedure(params),
	closeWorktree: (params) => closeWorktreeProcedure(params),
};

const rpcClients = new Set<ServerWebSocket<unknown>>();
const pendingMainviewChanges = new Set<string>();

let mainviewBundlePath = resolve(MAINVIEW_BUILD_DIR, "index.js");
let mainviewBuildPromise: Promise<string> | null = null;
let mainviewRebuildQueued = false;
let devMainviewPollTimer: ReturnType<typeof setInterval> | null = null;
let pendingMainviewReloadTimer: ReturnType<typeof setTimeout> | null = null;
let mainviewFileStamps = new Map<string, number>();

function stringResponse(body: string, contentType: string): Response {
	return new Response(body, {
		headers: {
			"content-type": contentType,
			"cache-control": "no-store",
		},
	});
}

function fileResponse(path: string, contentType: string): Response {
	return new Response(Bun.file(path), {
		headers: {
			"content-type": contentType,
			"cache-control": "no-store",
		},
	});
}

async function htmlResponse(): Promise<Response> {
	const runtimeScript = `<script>window.__jtIdeRuntime=${JSON.stringify({
		devServer: IS_DEV_SERVER,
	})};</script>`;
	const template = await Bun.file(MAINVIEW_HTML_PATH).text();
	const html = template.includes("</head>")
		? template.replace("</head>", `${runtimeScript}\n\t</head>`)
		: `${runtimeScript}\n${template}`;

	return stringResponse(html, "text/html; charset=utf-8");
}

function parseRpcRequestMessage(raw: string): RpcRequestMessage {
	const parsed = JSON.parse(raw) as Partial<RpcRequestMessage>;
	if (
		parsed.type !== "request" ||
		typeof parsed.id !== "number" ||
		typeof parsed.method !== "string" ||
		!(parsed.method in rpcHandlers)
	) {
		throw new Error("Invalid RPC request payload");
	}

	return parsed as RpcRequestMessage;
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

async function buildMainviewBundle(): Promise<string> {
	const buildResult = await Bun.build({
		entrypoints: [MAINVIEW_ENTRYPOINT],
		format: "esm",
		minify: false,
		outdir: MAINVIEW_BUILD_DIR,
		sourcemap: "external",
		target: "browser",
	});

	if (!buildResult.success) {
		for (const log of buildResult.logs) {
			console.error(log);
		}
		throw new Error("Failed to build browser bundle");
	}

	const mainviewBundle = buildResult.outputs.find((output) =>
		output.path.endsWith("index.js"),
	);
	if (!mainviewBundle) {
		throw new Error("Mainview JavaScript bundle was not emitted");
	}

	return mainviewBundle.path;
}

function queueMainviewBundleBuild(): Promise<string> {
	if (mainviewBuildPromise) {
		mainviewRebuildQueued = true;
		return mainviewBuildPromise;
	}

	mainviewBuildPromise = (async () => {
		try {
			do {
				mainviewRebuildQueued = false;
				mainviewBundlePath = await buildMainviewBundle();
			} while (mainviewRebuildQueued);

			return mainviewBundlePath;
		} finally {
			mainviewBuildPromise = null;
		}
	})();

	return mainviewBuildPromise;
}

function broadcastReload(reason: string): void {
	if (!IS_DEV_SERVER || rpcClients.size === 0) {
		return;
	}

	const payload: RpcReloadMessage = {
		type: "reload",
		reason,
	};
	const raw = JSON.stringify(payload satisfies RpcSocketMessage);
	for (const client of rpcClients) {
		try {
			client.send(raw);
		} catch {
			rpcClients.delete(client);
		}
	}
}

function normalizeWatchFilename(filename?: string | Buffer | null): string {
	if (typeof filename === "string") {
		return filename.trim();
	}
	if (filename) {
		return filename.toString("utf8").trim();
	}
	return "";
}

function flushPendingMainviewReloads(): void {
	pendingMainviewReloadTimer = null;
	const changedFiles = [...pendingMainviewChanges].map((entry) =>
		entry.toLowerCase(),
	);
	pendingMainviewChanges.clear();

	const requiresBuild = changedFiles.some(
		(entry) => !entry || entry.endsWith(".ts") || entry.endsWith(".tsx"),
	);
	const requiresReload =
		requiresBuild ||
		changedFiles.some(
			(entry) => !entry || entry === "index.css" || entry === "index.html",
		);
	if (!requiresReload) {
		return;
	}

	void (async () => {
		if (requiresBuild) {
			try {
				await queueMainviewBundleBuild();
			} catch (error) {
				console.error(
					"Failed to rebuild the mainview bundle after a source change",
					error,
				);
				return;
			}
		}

		broadcastReload(requiresBuild ? "mainview-source" : "mainview-asset");
	})();
}

function enqueueMainviewReload(filename?: string | Buffer | null): void {
	const normalizedFilename = normalizeWatchFilename(filename);
	pendingMainviewChanges.add(normalizedFilename);

	if (pendingMainviewReloadTimer) {
		clearTimeout(pendingMainviewReloadTimer);
	}
	pendingMainviewReloadTimer = setTimeout(
		flushPendingMainviewReloads,
		MAINVIEW_RELOAD_DEBOUNCE_MS,
	);
}

function readMainviewFileStamps(): Map<string, number> {
	const nextStamps = new Map<string, number>();

	for (const entry of readdirSync(MAINVIEW_SOURCE_DIR)) {
		const entryPath = resolve(MAINVIEW_SOURCE_DIR, entry);
		const stats = statSync(entryPath, {
			throwIfNoEntry: false,
		});
		if (!stats?.isFile()) {
			continue;
		}
		nextStamps.set(entry, stats.mtimeMs);
	}

	return nextStamps;
}

function startDevMainviewWatcher(): void {
	if (!IS_DEV_SERVER || devMainviewPollTimer) {
		return;
	}

	mainviewFileStamps = readMainviewFileStamps();
	devMainviewPollTimer = setInterval(() => {
		const nextStamps = readMainviewFileStamps();
		for (const [entry, mtimeMs] of nextStamps) {
			const previousMtimeMs = mainviewFileStamps.get(entry);
			if (previousMtimeMs !== mtimeMs) {
				enqueueMainviewReload(entry);
			}
		}
		for (const entry of mainviewFileStamps.keys()) {
			if (!nextStamps.has(entry)) {
				enqueueMainviewReload(entry);
			}
		}
		mainviewFileStamps = nextStamps;
	}, MAINVIEW_WATCH_INTERVAL_MS);
}

function shutdownDevWatchers(): void {
	if (devMainviewPollTimer) {
		clearInterval(devMainviewPollTimer);
		devMainviewPollTimer = null;
	}
	mainviewFileStamps.clear();

	if (pendingMainviewReloadTimer) {
		clearTimeout(pendingMainviewReloadTimer);
		pendingMainviewReloadTimer = null;
	}
	pendingMainviewChanges.clear();
}

async function bootstrap(): Promise<void> {
	initAppDatabase();
	await queueMainviewBundleBuild();
	startDevMainviewWatcher();

	const server = Bun.serve({
		port: SERVER_PORT,
		async fetch(request, serverInstance) {
			const { pathname } = new URL(request.url);

			if (pathname === "/rpc") {
				if (serverInstance.upgrade(request)) {
					return;
				}
				return new Response("WebSocket upgrade failed", { status: 400 });
			}

			if (pathname === "/" || pathname === "/index.html") {
				return htmlResponse();
			}

			if (pathname === "/index.css") {
				return fileResponse(MAINVIEW_CSS_PATH, "text/css; charset=utf-8");
			}

			if (pathname === "/index.js") {
				return fileResponse(
					mainviewBundlePath,
					"application/javascript; charset=utf-8",
				);
			}

			if (pathname === "/fonts/fira-code-vf.woff2") {
				return fileResponse(FIRA_CODE_VARIABLE_FONT_PATH, "font/woff2");
			}

			if (pathname === "/health") {
				return stringResponse(
					JSON.stringify({
						devServer: IS_DEV_SERVER,
						ok: true,
						port: SERVER_PORT,
					}),
					"application/json; charset=utf-8",
				);
			}

			return new Response("Not found", { status: 404 });
		},
		websocket: {
			open(ws) {
				rpcClients.add(ws);
			},
			close(ws) {
				rpcClients.delete(ws);
			},
			message(ws, rawMessage) {
				void (async () => {
					try {
						const payload =
							typeof rawMessage === "string"
								? rawMessage
								: Buffer.from(rawMessage).toString("utf8");
						const request = parseRpcRequestMessage(payload);
						const handler = rpcHandlers[request.method] as (
							params: RpcRequestMap[RpcMethodName]["params"],
						) => Promise<RpcRequestMap[RpcMethodName]["response"]>;
						const result = await handler(request.params);
						const response: RpcResponseMessage = {
							id: request.id,
							ok: true,
							result,
							type: "response",
						};
						ws.send(JSON.stringify(response satisfies RpcSocketMessage));
					} catch (error) {
						let requestId = -1;
						try {
							const parsed = JSON.parse(
								typeof rawMessage === "string"
									? rawMessage
									: Buffer.from(rawMessage).toString("utf8"),
							) as { id?: number };
							requestId = typeof parsed.id === "number" ? parsed.id : -1;
						} catch {
							requestId = -1;
						}
						const response: RpcResponseMessage = {
							id: requestId,
							ok: false,
							error: toErrorMessage(error),
							type: "response",
						};
						ws.send(JSON.stringify(response satisfies RpcSocketMessage));
					}
				})();
			},
		},
	});

	console.log(
		`jt-ide web app listening on http://localhost:${server.port}${IS_DEV_SERVER ? " (live reload enabled)" : ""}`,
	);
}

process.on("SIGINT", () => {
	shutdownDevWatchers();
	shutdownProjectPolling();
	process.exit(0);
});

process.on("SIGTERM", () => {
	shutdownDevWatchers();
	shutdownProjectPolling();
	process.exit(0);
});

await bootstrap();
