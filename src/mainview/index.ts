import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type { AppRPCSchema, ProjectProcedures } from "../bun/rpc-schema";
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

declare global {
	interface Window {
		jtIdeProcedures: ProjectProcedures;
		__jtIdeAppMountedAt?: number;
	}
}

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketProtocol}//${window.location.host}/rpc`);
const pendingRequests = new Map<number, PendingRequest>();
let nextRequestId = 1;
let resolveConnection!: () => void;
let rejectConnection!: (reason?: unknown) => void;
const connectionReady = new Promise<void>((resolve, reject) => {
	resolveConnection = resolve;
	rejectConnection = reject;
});

socket.addEventListener("open", () => {
	resolveConnection();
});

socket.addEventListener("message", (event) => {
	const payload = JSON.parse(String(event.data)) as RpcResponseMessage;
	if (payload.type !== "response") {
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
	listProjects: (params) => sendRequest("listProjects", params),
	openProject: (params) => sendRequest("openProject", params),
	closeProject: (params) => sendRequest("closeProject", params),
	listProjectWorktrees: (params) => sendRequest("listProjectWorktrees", params),
	openWorktree: (params) => sendRequest("openWorktree", params),
	closeWorktree: (params) => sendRequest("closeWorktree", params),
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
