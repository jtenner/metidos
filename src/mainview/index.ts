import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
	AppRPCSchema,
	ProjectProcedures,
	RpcProcedureCallOptions,
	RpcRequestPriority,
	RpcWorktreeGitHistoryChanged,
	RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import App from "./App";

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type PendingRequest = {
	method: RpcMethodName;
	reject: (reason?: unknown) => void;
	resolve: (value: unknown) => void;
};

type RpcRequestMessage<K extends RpcMethodName = RpcMethodName> = {
	type: "request";
	id: number;
	method: K;
	params: RpcRequestMap[K]["params"];
	priority: RpcRequestPriority;
	timeoutMs?: number;
};

type RpcCancelMessage = {
	type: "cancel";
	id: number;
};

type RpcResponseMessage = {
	type: "response";
	id: number;
	ok: boolean;
	result?: unknown;
	error?: string;
};

type RpcReloadMessage = {
	type: "reload";
	reason: string;
};

type RpcTasksChangedMessage = RpcWorktreeTasksChanged & {
	type: "tasks-changed";
};

type RpcGitHistoryChangedMessage = RpcWorktreeGitHistoryChanged & {
	type: "git-history-changed";
};

type RpcSocketMessage =
	| RpcResponseMessage
	| RpcReloadMessage
	| RpcTasksChangedMessage
	| RpcGitHistoryChangedMessage;

type RpcClientMessage = RpcRequestMessage | RpcCancelMessage;

type RuntimeConfig = {
	devServer: boolean;
};

const WORKTREE_TASKS_CHANGED_EVENT_NAME = "jt-ide:worktree-tasks-changed";
const WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME =
	"jt-ide:worktree-git-history-changed";

declare global {
	interface WindowEventMap {
		"jt-ide:worktree-tasks-changed": CustomEvent<RpcWorktreeTasksChanged>;
		"jt-ide:worktree-git-history-changed": CustomEvent<RpcWorktreeGitHistoryChanged>;
	}

	interface Window {
		jtIdeProcedures: ProjectProcedures;
		__jtIdeAppMountedAt?: number;
		__jtIdeRuntime?: RuntimeConfig;
	}
}

const runtimeConfig: RuntimeConfig = window.__jtIdeRuntime ?? {
	devServer: false,
};

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketProtocol}//${window.location.host}/rpc`);
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;
let resolveConnection!: () => void;
let rejectConnection!: (reason?: unknown) => void;
let isPageUnloading = false;
let devRecoveryScheduled = false;
let devRecoveryTimer: number | null = null;

const connectionReady = new Promise<void>((resolve, reject) => {
	resolveConnection = resolve;
	rejectConnection = reject;
});

function clearDevRecoveryTimer(): void {
	if (devRecoveryTimer !== null) {
		window.clearTimeout(devRecoveryTimer);
		devRecoveryTimer = null;
	}
}

function reloadWindow(reason: string): void {
	if (!runtimeConfig.devServer || isPageUnloading) {
		return;
	}

	console.info(`[jt-ide] reloading dev client (${reason})`);
	isPageUnloading = true;
	clearDevRecoveryTimer();
	window.location.reload();
}

async function waitForDevServer(): Promise<void> {
	if (!runtimeConfig.devServer || isPageUnloading) {
		return;
	}

	try {
		const response = await fetch("/health", {
			cache: "no-store",
		});
		if (response.ok) {
			reloadWindow("server-ready");
			return;
		}
	} catch {
		// Ignore transient failures while the watch process restarts.
	}

	devRecoveryTimer = window.setTimeout(() => {
		void waitForDevServer();
	}, 250);
}

function scheduleDevRecovery(reason: string): void {
	if (!runtimeConfig.devServer || isPageUnloading || devRecoveryScheduled) {
		return;
	}

	devRecoveryScheduled = true;
	console.info(`[jt-ide] waiting for dev server restart (${reason})`);
	clearDevRecoveryTimer();
	devRecoveryTimer = window.setTimeout(() => {
		void waitForDevServer();
	}, 120);
}

window.addEventListener("beforeunload", () => {
	isPageUnloading = true;
	clearDevRecoveryTimer();
});

socket.addEventListener("open", () => {
	resolveConnection();
});

socket.addEventListener("message", (event) => {
	const payload = JSON.parse(String(event.data)) as RpcSocketMessage;
	if (payload.type === "reload") {
		reloadWindow(payload.reason);
		return;
	}
	if (payload.type === "tasks-changed") {
		window.dispatchEvent(
			new CustomEvent<RpcWorktreeTasksChanged>(
				WORKTREE_TASKS_CHANGED_EVENT_NAME,
				{
					detail: {
						projectId: payload.projectId,
						worktreePath: payload.worktreePath,
					},
				},
			),
		);
		return;
	}
	if (payload.type === "git-history-changed") {
		window.dispatchEvent(
			new CustomEvent<RpcWorktreeGitHistoryChanged>(
				WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
				{
					detail: {
						projectId: payload.projectId,
						worktreePath: payload.worktreePath,
					},
				},
			),
		);
		return;
	}

	const pending = pendingRequests.get(payload.id);
	if (!pending) {
		return;
	}
	pendingRequests.delete(payload.id);
	if (payload.ok) {
		pending.resolve(payload.result);
		return;
	}
	pending.reject(new Error(payload.error || "RPC request failed"));
});

socket.addEventListener("close", () => {
	const error = new Error("RPC connection closed");
	rejectConnection(error);
	for (const pending of pendingRequests.values()) {
		pending.reject(error);
	}
	pendingRequests.clear();

	if (runtimeConfig.devServer) {
		scheduleDevRecovery("rpc-close");
	}
});

socket.addEventListener("error", () => {
	console.error("jt-ide RPC socket encountered an error");
});

function createAbortError(reason: unknown, fallbackMessage: string): Error {
	if (reason instanceof Error) {
		return reason;
	}

	const message =
		typeof reason === "string" && reason.trim() ? reason : fallbackMessage;
	const error = new Error(message, {
		cause: reason,
	});
	if (reason instanceof DOMException && reason.name) {
		error.name = reason.name;
	}
	return error;
}

function normalizeTimeoutMs(timeoutMs?: number): number | null {
	if (
		typeof timeoutMs !== "number" ||
		!Number.isFinite(timeoutMs) ||
		timeoutMs <= 0
	) {
		return null;
	}
	return Math.max(1, Math.floor(timeoutMs));
}

function buildRequestSignal(
	options?: RpcProcedureCallOptions,
): AbortSignal | null {
	const signals: AbortSignal[] = [];
	if (options?.signal) {
		signals.push(options.signal);
	}

	const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
	if (timeoutMs !== null) {
		signals.push(AbortSignal.timeout(timeoutMs));
	}

	if (signals.length === 0) {
		return null;
	}
	if (signals.length === 1) {
		return signals[0] ?? null;
	}
	return AbortSignal.any(signals);
}

async function waitForConnection(signal: AbortSignal | null): Promise<void> {
	if (!signal) {
		await connectionReady;
		return;
	}
	if (signal.aborted) {
		throw createAbortError(signal.reason, "RPC request aborted.");
	}

	await Promise.race([
		connectionReady,
		new Promise<never>((_, reject) => {
			const handleAbort = () => {
				signal.removeEventListener("abort", handleAbort);
				reject(createAbortError(signal.reason, "RPC request aborted."));
			};
			signal.addEventListener("abort", handleAbort, {
				once: true,
			});
		}),
	]);
}

function sendSocketMessage(message: RpcClientMessage): void {
	socket.send(JSON.stringify(message));
}

async function sendRequest<K extends RpcMethodName>(
	method: K,
	params: RpcRequestMap[K]["params"],
	options?: RpcProcedureCallOptions,
): Promise<RpcRequestMap[K]["response"]> {
	const signal = buildRequestSignal(options);
	await waitForConnection(signal);
	if (signal?.aborted) {
		throw createAbortError(
			signal.reason,
			`RPC request "${String(method)}" aborted.`,
		);
	}

	const id = nextRequestId++;
	const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
	const priority = options?.priority ?? "default";

	const response = new Promise<RpcRequestMap[K]["response"]>(
		(resolve, reject) => {
			let settled = false;
			let removeAbortListener = () => {};
			const finalize = (callback: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				pendingRequests.delete(id);
				removeAbortListener();
				callback();
			};

			if (signal) {
				const handleAbort = () => {
					finalize(() => {
						if (socket.readyState === WebSocket.OPEN) {
							sendSocketMessage({
								type: "cancel",
								id,
							});
						}
						reject(
							createAbortError(
								signal.reason,
								`RPC request "${String(method)}" aborted.`,
							),
						);
					});
				};
				if (signal.aborted) {
					handleAbort();
					return;
				}
				signal.addEventListener("abort", handleAbort, {
					once: true,
				});
				removeAbortListener = () => {
					signal.removeEventListener("abort", handleAbort);
				};
			}

			pendingRequests.set(id, {
				method,
				reject: (reason) =>
					finalize(() => {
						reject(reason);
					}),
				resolve: (value) =>
					finalize(() => {
						resolve(value as RpcRequestMap[K]["response"]);
					}),
			});
			try {
				sendSocketMessage({
					type: "request",
					id,
					method,
					params,
					priority,
					...(timeoutMs !== null ? { timeoutMs } : {}),
				});
			} catch (error) {
				finalize(() => {
					reject(error);
				});
			}
		},
	);

	return response;
}

function createProcedure<K extends RpcMethodName>(
	method: K,
): ProjectProcedures[K] {
	return ((
		params?: RpcRequestMap[K]["params"],
		options?: RpcProcedureCallOptions,
	) =>
		sendRequest(
			method,
			params as RpcRequestMap[K]["params"],
			options,
		)) as ProjectProcedures[K];
}

const procedures: ProjectProcedures = {
	getHomeDirectory: createProcedure("getHomeDirectory"),
	listDirectorySuggestions: createProcedure("listDirectorySuggestions"),
	getCodexModelCatalog: createProcedure("getCodexModelCatalog"),
	listProjects: createProcedure("listProjects"),
	listThreads: createProcedure("listThreads"),
	openProject: createProcedure("openProject"),
	closeProject: createProcedure("closeProject"),
	deleteProject: createProcedure("deleteProject"),
	listProjectWorktrees: createProcedure("listProjectWorktrees"),
	listProjectTasks: createProcedure("listProjectTasks"),
	createWorktree: createProcedure("createWorktree"),
	createThread: createProcedure("createThread"),
	getThread: createProcedure("getThread"),
	markThreadErrorSeen: createProcedure("markThreadErrorSeen"),
	sendThreadMessage: createProcedure("sendThreadMessage"),
	runProjectTask: createProcedure("runProjectTask"),
	renameThread: createProcedure("renameThread"),
	setThreadPinned: createProcedure("setThreadPinned"),
	updateThreadModel: createProcedure("updateThreadModel"),
	deleteThread: createProcedure("deleteThread"),
	openWorktree: createProcedure("openWorktree"),
	listWorktreeGitHistory: createProcedure("listWorktreeGitHistory"),
	getWorktreeGitCommitDiff: createProcedure("getWorktreeGitCommitDiff"),
	closeWorktree: createProcedure("closeWorktree"),
	setWorktreePinned: createProcedure("setWorktreePinned"),
};

window.jtIdeProcedures = procedures;

const appRoot = document.getElementById("app");
if (!appRoot) {
	console.error("Mainview root not found");
	document.body.innerHTML =
		'<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Mainview root missing (id="app").</main>';
} else {
	console.log("React version:", React.version);
	console.log("Mounting React app (App.tsx)");
	const root = createRoot(appRoot);
	try {
		root.render(createElement(App, { procedures }));
		window.__jtIdeAppMountedAt = Date.now();
	} catch (error) {
		console.error("Failed to mount App.tsx", error);
		window.__jtIdeAppMountedAt = Number.NaN;
		appRoot.innerHTML =
			'<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Failed to initialize App UI. Check console for details.</main>';
	}
}
