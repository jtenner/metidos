import { dirname, isAbsolute, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import type {
	AppRPCSchema,
	RpcProcedureCallOptions,
	RpcRequestPriority,
	RpcThreadDetail,
} from "./rpc-schema";

const DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";
const DEFAULT_RPC_TIMEOUT_MS = 30_000;

type RpcRequestMap = AppRPCSchema["requests"];
type RpcMethodName = keyof RpcRequestMap;

type RpcRequestMessage<K extends RpcMethodName = RpcMethodName> = {
	type: "request";
	id: number;
	method: K;
	params: RpcRequestMap[K]["params"];
	priority: RpcRequestPriority;
	timeoutMs?: number;
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

type PendingRpcRequest = {
	reject: (reason?: unknown) => void;
	resolve: (value: unknown) => void;
	timeoutId: ReturnType<typeof setTimeout> | null;
};

type ThreadLifecycleStatus = "Turning" | "Errored" | "Stopped" | "Created";

const activeThreadId = readIntegerEnv("JOLT_ACTIVE_THREAD_ID");
const activeProjectId = readIntegerEnv("JOLT_ACTIVE_PROJECT_ID");
const activeWorktreePath = readStringEnv("JOLT_ACTIVE_WORKTREE_PATH");
const rpcUrl = readStringEnv("JOLT_RPC_URL") ?? DEFAULT_RPC_URL;

class JoltRpcClient {
	private connecting: Promise<WebSocket> | null = null;
	private nextRequestId = 1;
	private pendingRequests = new Map<number, PendingRpcRequest>();
	private socket: WebSocket | null = null;

	constructor(private readonly url: string) {}

	async call<K extends RpcMethodName>(
		method: K,
		params: RpcRequestMap[K]["params"],
		options?: RpcProcedureCallOptions,
	): Promise<RpcRequestMap[K]["response"]> {
		const socket = await this.waitForOpenSocket();
		const requestId = this.nextRequestId;
		this.nextRequestId += 1;

		const priority = normalizeRpcRequestPriority(options?.priority);
		const timeoutMs = normalizeTimeoutMs(options?.timeoutMs);
		return new Promise<RpcRequestMap[K]["response"]>(
			(resolveRequest, reject) => {
				const timeoutId =
					timeoutMs === null
						? null
						: setTimeout(() => {
								this.pendingRequests.delete(requestId);
								reject(
									new Error(
										`RPC "${String(method)}" timed out after ${timeoutMs}ms.`,
									),
								);
							}, timeoutMs);

				this.pendingRequests.set(requestId, {
					resolve: (value) => {
						resolveRequest(value as RpcRequestMap[K]["response"]);
					},
					reject,
					timeoutId,
				});

				const message: RpcRequestMessage<K> = {
					type: "request",
					id: requestId,
					method,
					params,
					priority,
					...(timeoutMs === null ? {} : { timeoutMs }),
				};

				try {
					socket.send(JSON.stringify(message));
				} catch (error) {
					this.clearPendingRequest(requestId);
					reject(error);
				}
			},
		);
	}

	private clearPendingRequest(requestId: number): PendingRpcRequest | null {
		const pending = this.pendingRequests.get(requestId) ?? null;
		if (!pending) {
			return null;
		}
		this.pendingRequests.delete(requestId);
		if (pending.timeoutId) {
			clearTimeout(pending.timeoutId);
		}
		return pending;
	}

	private async waitForOpenSocket(): Promise<WebSocket> {
		if (this.socket && this.socket.readyState === WebSocket.OPEN) {
			return this.socket;
		}
		if (this.connecting) {
			return this.connecting;
		}

		this.connecting = new Promise<WebSocket>((resolveSocket, reject) => {
			const nextSocket = new WebSocket(this.url);

			const resetSocket = (reason: unknown) => {
				if (this.socket === nextSocket) {
					this.socket = null;
				}
				if (this.connecting) {
					this.connecting = null;
				}
				reject(reason);
			};

			nextSocket.addEventListener("open", () => {
				this.socket = nextSocket;
				this.connecting = null;
				resolveSocket(nextSocket);
			});

			nextSocket.addEventListener("message", (event) => {
				const message = JSON.parse(String(event.data)) as RpcResponseMessage;
				if (message.type !== "response") {
					return;
				}
				const pending = this.clearPendingRequest(message.id);
				if (!pending) {
					return;
				}
				if (message.ok) {
					pending.resolve(message.result);
					return;
				}
				pending.reject(new Error(message.error));
			});

			nextSocket.addEventListener("close", () => {
				if (this.socket === nextSocket) {
					this.socket = null;
				}
				if (this.connecting) {
					this.connecting = null;
				}
				const pending = [...this.pendingRequests.keys()];
				for (const requestId of pending) {
					this.clearPendingRequest(requestId)?.reject(
						new Error("Jolt RPC connection closed."),
					);
				}
			});

			nextSocket.addEventListener("error", () => {
				resetSocket(new Error(`Could not connect to Jolt RPC at ${this.url}.`));
			});
		});

		return this.connecting;
	}
}

const rpcClient = new JoltRpcClient(rpcUrl);

function readIntegerEnv(name: string): number | null {
	const raw = process.env[name]?.trim();
	if (!raw || !/^\d+$/.test(raw)) {
		return null;
	}
	return Number.parseInt(raw, 10);
}

function readStringEnv(name: string): string | null {
	const raw = process.env[name]?.trim();
	return raw ? raw : null;
}

function normalizeTimeoutMs(value: number | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_RPC_TIMEOUT_MS;
	}
	return Math.max(1, Math.floor(value));
}

function normalizeRpcRequestPriority(
	value: RpcRequestPriority | undefined,
): RpcRequestPriority {
	switch (value) {
		case "background":
		case "default":
		case "foreground":
			return value;
		default:
			return "foreground";
	}
}

function canonicalPath(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new Error("Path is required.");
	}

	const baseDirectory = activeWorktreePath ?? process.cwd();
	const resolvedPath = isAbsolute(trimmed)
		? resolve(trimmed)
		: resolve(baseDirectory, trimmed);
	const normalized = resolvedPath.replace(/\\/g, "/").replace(/\/+$/, "");
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
	return canonicalPath(left) === canonicalPath(right);
}

async function listKnownProjects() {
	return rpcClient.call("listProjects", { includeClosed: true });
}

async function resolveProjectId(params?: {
	projectId?: number | null | undefined;
	projectPath?: string | null | undefined;
}): Promise<number> {
	if (typeof params?.projectId === "number") {
		return params.projectId;
	}

	if (params?.projectPath?.trim()) {
		const projectPath = canonicalPath(params.projectPath);
		const projects = await listKnownProjects();
		const matched = projects.find((project) =>
			samePath(project.path, projectPath),
		);
		if (matched) {
			return matched.id;
		}
		throw new Error(`Project not found: ${params.projectPath}`);
	}

	if (typeof activeProjectId === "number") {
		return activeProjectId;
	}

	throw new Error("projectId or projectPath required with no active project.");
}

async function resolveProjectIdForWorktreePath(
	worktreePath: string,
	preferredProjectId?: number | null,
): Promise<number> {
	if (typeof preferredProjectId === "number") {
		const worktrees = await rpcClient.call("listProjectWorktrees", {
			projectId: preferredProjectId,
		});
		if (
			worktrees.worktrees.some((worktree) =>
				samePath(worktree.path, worktreePath),
			)
		) {
			return preferredProjectId;
		}
	}

	if (
		typeof activeProjectId === "number" &&
		activeProjectId !== preferredProjectId
	) {
		const worktrees = await rpcClient.call("listProjectWorktrees", {
			projectId: activeProjectId,
		});
		if (
			worktrees.worktrees.some((worktree) =>
				samePath(worktree.path, worktreePath),
			)
		) {
			return activeProjectId;
		}
	}

	for (const project of await listKnownProjects()) {
		if (
			typeof preferredProjectId === "number" &&
			project.id === preferredProjectId
		) {
			continue;
		}
		if (typeof activeProjectId === "number" && project.id === activeProjectId) {
			continue;
		}
		const worktrees = await rpcClient.call("listProjectWorktrees", {
			projectId: project.id,
		});
		if (
			worktrees.worktrees.some((worktree) =>
				samePath(worktree.path, worktreePath),
			)
		) {
			return project.id;
		}
	}

	throw new Error(`Worktree not found: ${worktreePath}`);
}

async function resolveWorktreeTarget(params?: {
	projectId?: number | null | undefined;
	projectPath?: string | null | undefined;
	worktreePath?: string | null | undefined;
}): Promise<{ projectId: number; worktreePath: string }> {
	if (params?.worktreePath?.trim()) {
		const worktreePath = canonicalPath(params.worktreePath);
		const explicitProjectId = await resolveProjectId({
			projectId: params.projectId ?? null,
			projectPath: params.projectPath ?? null,
		}).catch(() => null);
		return {
			projectId: await resolveProjectIdForWorktreePath(
				worktreePath,
				explicitProjectId,
			),
			worktreePath,
		};
	}

	if (typeof activeProjectId === "number" && activeWorktreePath) {
		return {
			projectId: activeProjectId,
			worktreePath: activeWorktreePath,
		};
	}

	throw new Error("worktreePath required with no active worktree.");
}

function resolveThreadId(threadId?: number | null): number {
	if (typeof threadId === "number") {
		return threadId;
	}
	if (typeof activeThreadId === "number") {
		return activeThreadId;
	}
	throw new Error("threadId required with no active thread.");
}

function summarizeThreadStatus(detail: RpcThreadDetail): ThreadLifecycleStatus {
	switch (detail.thread.runStatus.state) {
		case "working":
			return "Turning";
		case "failed":
			return "Errored";
		default:
			return detail.thread.lastRunAt === null && detail.messages.length === 0
				? "Created"
				: "Stopped";
	}
}

function threadStatusPayload(detail: RpcThreadDetail) {
	return {
		threadId: detail.thread.id,
		projectId: detail.thread.projectId,
		worktreePath: detail.thread.worktreePath,
		title: detail.thread.title,
		status: summarizeThreadStatus(detail),
		runState: detail.thread.runStatus.state,
		error: detail.thread.runStatus.error,
		hasUnreadError: detail.thread.runStatus.hasUnreadError,
		lastRunAt: detail.thread.lastRunAt,
	};
}

function textResult(text: string, structuredContent?: Record<string, unknown>) {
	return {
		content: [{ type: "text" as const, text }],
		...(typeof structuredContent === "undefined" ? {} : { structuredContent }),
	};
}

const server = new McpServer({
	name: "jolt",
	version: "0.0.1",
});

server.registerTool(
	"set_thread_title",
	{
		title: "Set Thread Title",
		description:
			"Update the current Jolt thread title. Use it whenever a short title would better match the current focus.",
		inputSchema: {
			title: z.string().trim().min(1).describe("Short title."),
			threadId: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Defaults to the current thread."),
		},
		annotations: {
			idempotentHint: false,
			openWorldHint: false,
			readOnlyHint: false,
		},
	},
	async ({ threadId, title }) => {
		const resolvedThreadId = resolveThreadId(threadId);
		const thread = await rpcClient.call("renameThread", {
			threadId: resolvedThreadId,
			title,
		});
		return textResult(`Renamed thread ${thread.id}.`, {
			threadId: thread.id,
			title: thread.title,
		});
	},
);

server.registerTool(
	"new_codex",
	{
		title: "New Codex",
		description:
			"Start a separate Jolt Codex thread. Use sparingly for distinct work or a different worktree.",
		inputSchema: {
			input: z.string().trim().min(1).describe("Initial prompt."),
			projectId: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Jolt project id."),
			projectPath: z
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Project path if projectId is unknown."),
			worktreePath: z
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Defaults to the current worktree."),
			model: z.string().trim().min(1).optional().describe("Model override."),
			reasoningEffort: z
				.enum(["minimal", "low", "medium", "high", "xhigh"])
				.optional()
				.describe("Reasoning override."),
		},
		annotations: {
			idempotentHint: false,
			openWorldHint: false,
			readOnlyHint: false,
		},
	},
	async ({
		input,
		model,
		projectId,
		projectPath,
		reasoningEffort,
		worktreePath,
	}) => {
		const target = await resolveWorktreeTarget({
			projectId,
			projectPath,
			worktreePath,
		});
		const created = await rpcClient.call("createThread", {
			projectId: target.projectId,
			worktreePath: target.worktreePath,
			model: model ?? null,
			reasoningEffort: reasoningEffort ?? null,
		});
		const started = await rpcClient.call("sendThreadMessage", {
			threadId: created.thread.id,
			input,
		});
		const payload = threadStatusPayload(started);
		return textResult(
			`Started thread ${payload.threadId} (${payload.status}).`,
			payload,
		);
	},
);

server.registerTool(
	"new_worktree",
	{
		title: "New Worktree",
		description:
			"Create a Jolt worktree. Use sparingly; this creates a branch and worktree.",
		inputSchema: {
			name: z.string().trim().min(1).describe("Branch/worktree name."),
			projectId: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Jolt project id."),
			projectPath: z
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Jolt project path."),
		},
		annotations: {
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: false,
			readOnlyHint: false,
		},
	},
	async ({ name, projectId, projectPath }) => {
		const resolvedProjectId = await resolveProjectId({
			projectId,
			projectPath,
		});
		const result = await rpcClient.call("createWorktree", {
			projectId: resolvedProjectId,
			name,
		});
		return textResult(`Created worktree ${result.worktreePath}.`, {
			projectId: result.project.id,
			projectPath: result.project.path,
			worktreePath: result.worktreePath,
		});
	},
);

server.registerTool(
	"set_active_worktree",
	{
		title: "Set Active Worktree",
		description:
			"Set the active Jolt worktree. Use sparingly when work clearly moves.",
		inputSchema: {
			projectId: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Jolt project id."),
			projectPath: z
				.string()
				.trim()
				.min(1)
				.optional()
				.describe("Jolt project path."),
			worktreePath: z.string().trim().min(1).describe("Worktree path."),
		},
		annotations: {
			idempotentHint: true,
			openWorldHint: false,
			readOnlyHint: false,
		},
	},
	async ({ projectId, projectPath, worktreePath }) => {
		const target = await resolveWorktreeTarget({
			projectId,
			projectPath,
			worktreePath,
		});
		await rpcClient.call("setActiveWorktree", {
			projectId: target.projectId,
			worktreePath: target.worktreePath,
		});
		return textResult("Set active worktree.", target);
	},
);

server.registerTool(
	"thread_status",
	{
		title: "Thread Status",
		description:
			"Get a Jolt thread status: Created, Turning, Stopped, or Errored.",
		inputSchema: {
			threadId: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Defaults to the current thread."),
		},
		annotations: {
			idempotentHint: true,
			openWorldHint: false,
			readOnlyHint: true,
		},
	},
	async ({ threadId }) => {
		const detail = await rpcClient.call("getThread", {
			threadId: resolveThreadId(threadId),
		});
		const payload = threadStatusPayload(detail);
		return textResult(
			`Thread ${payload.threadId}: ${payload.status}.`,
			payload,
		);
	},
);

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
}

void main().catch((error) => {
	console.error("Jolt sidecar MCP server failed", error);
	process.exit(1);
});
