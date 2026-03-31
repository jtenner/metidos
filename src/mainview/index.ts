import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type {
	AppRPCSchema,
	ProjectProcedures,
	RpcWorktreeGitHistoryChanged,
	RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import App from "./App";

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type PendingRequest = {
	reject: (reason?: unknown) => void;
	resolve: (value: unknown) => void;
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

async function sendRequest<K extends RpcMethodName>(
	method: K,
	params: RpcRequestMap[K]["params"],
): Promise<RpcRequestMap[K]["response"]> {
	await connectionReady;
	const id = nextRequestId++;
	const response = new Promise<RpcRequestMap[K]["response"]>(
		(resolve, reject) => {
			pendingRequests.set(id, {
				reject,
				resolve: (value) => resolve(value as RpcRequestMap[K]["response"]),
			});
		},
	);

	socket.send(
		JSON.stringify({
			id,
			method,
			params,
			type: "request",
		}),
	);

	return response;
}

const procedures: ProjectProcedures = {
	getHomeDirectory: (params) => sendRequest("getHomeDirectory", params),
	listDirectorySuggestions: (params) =>
		sendRequest("listDirectorySuggestions", params),
	getCodexModelCatalog: (params) => sendRequest("getCodexModelCatalog", params),
	listProjects: (params) => sendRequest("listProjects", params),
	listThreads: (params) => sendRequest("listThreads", params),
	openProject: (params) => sendRequest("openProject", params),
	closeProject: (params) => sendRequest("closeProject", params),
	deleteProject: (params) => sendRequest("deleteProject", params),
	listProjectWorktrees: (params) => sendRequest("listProjectWorktrees", params),
	listProjectTasks: (params) => sendRequest("listProjectTasks", params),
	createWorktree: (params) => sendRequest("createWorktree", params),
	createThread: (params) => sendRequest("createThread", params),
	getThread: (params) => sendRequest("getThread", params),
	markThreadErrorSeen: (params) => sendRequest("markThreadErrorSeen", params),
	sendThreadMessage: (params) => sendRequest("sendThreadMessage", params),
	runProjectTask: (params) => sendRequest("runProjectTask", params),
	renameThread: (params) => sendRequest("renameThread", params),
	setThreadPinned: (params) => sendRequest("setThreadPinned", params),
	updateThreadModel: (params) => sendRequest("updateThreadModel", params),
	deleteThread: (params) => sendRequest("deleteThread", params),
	openWorktree: (params) => sendRequest("openWorktree", params),
	listWorktreeGitHistory: (params) =>
		sendRequest("listWorktreeGitHistory", params),
	getWorktreeGitCommitDiff: (params) =>
		sendRequest("getWorktreeGitCommitDiff", params),
	closeWorktree: (params) => sendRequest("closeWorktree", params),
	setWorktreePinned: (params) => sendRequest("setWorktreePinned", params),
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
