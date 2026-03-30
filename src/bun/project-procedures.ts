import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { Codex, type ThreadItem } from "@openai/codex-sdk";

import type { ProjectRecord, ThreadMessageRecord, ThreadRecord } from "./db";
import {
	createThread,
	createThreadMessage,
	deleteProject,
	deleteThread,
	getProjectById,
	getThreadById,
	initAppDatabase,
	listProjects,
	listThreadMessages,
	listThreads,
	markThreadErrorSeen,
	markThreadFailed,
	markThreadRan,
	renameThread,
	setProjectClosed,
	setThreadPinned,
	touchThread,
	updateThreadCodexId,
	upsertProject,
	upsertThreadActivity,
} from "./db";
import type {
	AppRPCSchema,
	RpcCreateWorktreeResult,
	RpcOpenWorktreeResult,
	RpcProject,
	RpcProjectWorktreesResult,
	RpcThread,
	RpcThreadDetail,
	RpcThreadMessage,
	RpcThreadRunStatus,
	RpcWorktree,
	RpcWorktreeSnapshot,
} from "./rpc-schema";

const db = initAppDatabase();
const codex = new Codex();

export async function listProjectsProcedure(
	_params?: AppRPCSchema["requests"]["listProjects"]["params"],
): Promise<RpcProject[]> {
	return listProjects(db);
}

export async function listThreadsProcedure(
	_params?: AppRPCSchema["requests"]["listThreads"]["params"],
): Promise<RpcThread[]> {
	return listThreads(db).map(toRpcThread);
}

const PROJECT_POLL_INTERVAL_MS = 4_000;
const DIFF_POLL_INTERVAL_MS = 2_000;
const FILE_POLL_INTERVAL_MS = 4_000;
const DIRECTORY_SUGGESTION_LIMIT = 10;

type WorktreePollState = {
	diff: string[];
	files: string[];
	diffTimer: ReturnType<typeof setInterval> | null;
	filesTimer: ReturnType<typeof setInterval> | null;
	lastUpdatedAt: string;
};

type ProjectPollState = {
	id: number;
	project: ProjectRecord;
	projectPath: string;
	worktrees: RpcWorktree[];
	projectTimer: ReturnType<typeof setInterval> | null;
	openWorktrees: Map<string, WorktreePollState>;
};

const projectPollMap = new Map<number, ProjectPollState>();
const codexThreadMap = new Map<number, ReturnType<typeof codex.startThread>>();
const threadRunStatusMap = new Map<number, RpcThreadRunStatus>();

const THREAD_INIT_SCHEMA = {
	type: "object",
	properties: {
		status: {
			type: "string",
		},
	},
	required: ["status"],
	additionalProperties: false,
} as const;

function expandHomeShorthandPath(value: string): string {
	if (process.platform === "win32") {
		return value;
	}
	if (value === "~") {
		return homedir();
	}
	if (value.startsWith("~/")) {
		return resolve(homedir(), value.slice(2));
	}
	return value;
}

function normalizePath(value: string): string {
	return resolve(expandHomeShorthandPath(value));
}

function normalizeWorktreePath(
	projectPath: string,
	worktreePath: string,
): string {
	return resolve(projectPath, worktreePath);
}

function parseDirectorySuggestionQuery(query: string): {
	searchDirectory: string;
	namePrefix: string;
} {
	if (process.platform !== "win32" && (query === "~" || query === "~/")) {
		return {
			searchDirectory: homedir(),
			namePrefix: "",
		};
	}

	const hasTrailingSeparator = /[\\/]$/.test(query);
	const expandedQuery = expandHomeShorthandPath(query);
	if (hasTrailingSeparator) {
		return {
			searchDirectory: resolve(expandedQuery),
			namePrefix: "",
		};
	}

	return {
		searchDirectory: resolve(dirname(expandedQuery)),
		namePrefix: basename(expandedQuery),
	};
}

function sortDirectoryNames(values: string[]): string[] {
	return [...values].sort((left, right) =>
		left.localeCompare(right, undefined, {
			numeric: true,
			sensitivity: "base",
		}),
	);
}

function safeIsDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function shortName(value: string): string {
	const normalized = value.replace(/[\\/]$/, "");
	const parts = normalized.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? value;
}

function hasUnreadThreadError(thread: ThreadRecord): boolean {
	return Boolean(
		thread.lastErrorAt &&
			(!thread.lastErrorSeenAt || thread.lastErrorSeenAt < thread.lastErrorAt),
	);
}

function threadRunStatusFromRecord(thread: ThreadRecord): RpcThreadRunStatus {
	const active = threadRunStatusMap.get(thread.id);
	const hasUnreadError = hasUnreadThreadError(thread);
	if (active) {
		return {
			...active,
			hasUnreadError,
		};
	}

	const failureIsCurrent =
		thread.lastErrorAt &&
		(!thread.lastRunAt || thread.lastErrorAt >= thread.lastRunAt);
	if (failureIsCurrent) {
		return {
			state: "failed",
			startedAt: null,
			updatedAt: thread.lastErrorAt,
			error: thread.lastErrorMessage ?? "Codex turn failed.",
			hasUnreadError,
		};
	}

	return {
		state: "idle",
		startedAt: null,
		updatedAt: thread.lastRunAt ?? thread.updatedAt,
		error: null,
		hasUnreadError: false,
	};
}

function setThreadRunStatus(
	threadId: number,
	status: RpcThreadRunStatus,
): void {
	threadRunStatusMap.set(threadId, status);
}

function toRpcThread(thread: ThreadRecord): RpcThread {
	return {
		...thread,
		runStatus: threadRunStatusFromRecord(thread),
	};
}

type CommandActivityPayload = {
	command: string;
	output: string;
	exitCode: number | null;
};

type FileChangeActivityPayload = {
	path: string;
	changeKind: "add" | "delete" | "update";
	diffText: string;
};

function parseActivityPayload<T>(value: string | null): T | null {
	if (!value) {
		return null;
	}
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

function toRpcThreadMessage(message: ThreadMessageRecord): RpcThreadMessage {
	if (message.kind === "command" && message.itemId) {
		const payload = parseActivityPayload<CommandActivityPayload>(
			message.payloadJson,
		);
		return {
			id: message.id,
			threadId: message.threadId,
			role: "assistant",
			kind: "command",
			itemId: message.itemId,
			text: message.text,
			state:
				message.state === "completed" || message.state === "failed"
					? message.state
					: "in_progress",
			command: payload?.command ?? message.text,
			output: payload?.output ?? "",
			exitCode: typeof payload?.exitCode === "number" ? payload.exitCode : null,
			createdAt: message.createdAt,
			updatedAt: message.updatedAt,
		};
	}

	if (message.kind === "file_change" && message.itemId) {
		const payload = parseActivityPayload<FileChangeActivityPayload>(
			message.payloadJson,
		);
		return {
			id: message.id,
			threadId: message.threadId,
			role: "assistant",
			kind: "file_change",
			itemId: message.itemId,
			text: message.text,
			state: message.state === "failed" ? "failed" : "completed",
			path: payload?.path ?? message.text,
			changeKind: payload?.changeKind ?? "update",
			diffText: payload?.diffText ?? "",
			createdAt: message.createdAt,
			updatedAt: message.updatedAt,
		};
	}

	if (message.kind === "reasoning" && message.itemId) {
		return {
			id: message.id,
			threadId: message.threadId,
			role: "assistant",
			kind: "reasoning",
			itemId: message.itemId,
			text: message.text,
			state: message.state === "completed" ? "completed" : "in_progress",
			createdAt: message.createdAt,
			updatedAt: message.updatedAt,
		};
	}

	return {
		id: message.id,
		threadId: message.threadId,
		role: message.role,
		kind: "chat",
		text: message.text,
		createdAt: message.createdAt,
		updatedAt: message.updatedAt,
	};
}

function toRpcThreadMessages(
	messages: ThreadMessageRecord[],
): RpcThreadMessage[] {
	return messages.map(toRpcThreadMessage);
}

function codexThreadOptions(worktreePath: string) {
	return {
		approvalPolicy: "never" as const,
		modelReasoningEffort: "medium" as const,
		networkAccessEnabled: true,
		sandboxMode: "workspace-write" as const,
		workingDirectory: worktreePath,
	};
}

async function initializeCodexThread(
	thread: ReturnType<typeof codex.startThread>,
): Promise<void> {
	await thread.run(
		"Initialize this coding thread. Respond with JSON containing a status field set to ready.",
		{
			outputSchema: THREAD_INIT_SCHEMA,
		},
	);
	if (!thread.id) {
		throw new Error("Codex did not return a thread identifier.");
	}
}

async function ensureCodexThread(
	thread: ThreadRecord,
): Promise<ReturnType<typeof codex.startThread>> {
	const active = codexThreadMap.get(thread.id);
	if (active) {
		return active;
	}

	const next = thread.codexThreadId
		? codex.resumeThread(
				thread.codexThreadId,
				codexThreadOptions(thread.worktreePath),
			)
		: codex.startThread(codexThreadOptions(thread.worktreePath));
	if (!thread.codexThreadId) {
		await initializeCodexThread(next);
		if (!next.id) {
			throw new Error("Codex did not return a thread identifier.");
		}
		updateThreadCodexId(db, thread.id, next.id);
	}
	codexThreadMap.set(thread.id, next);
	return next;
}

function buildThreadTitle(
	worktree: RpcWorktree | null,
	worktreePath: string,
): string {
	return worktree?.branch?.trim() || shortName(worktreePath);
}

function threadById(threadId: number): ThreadRecord {
	const thread = getThreadById(db, threadId);
	if (!thread) {
		throw new Error(`Thread not found: ${threadId}`);
	}
	return thread;
}

async function buildThreadDetail(threadId: number): Promise<RpcThreadDetail> {
	const thread = threadById(threadId);
	return {
		thread: toRpcThread(thread),
		messages: toRpcThreadMessages(listThreadMessages(db, thread.id)),
	};
}

async function runThreadMessageInBackground(
	threadId: number,
	input: string,
	startedAt: string,
): Promise<void> {
	try {
		const thread = threadById(threadId);
		const codexThread = await ensureCodexThread(thread);
		const { events } = await codexThread.runStreamed(input);
		let assistantText = "";
		let terminalError: string | null = null;

		for await (const event of events) {
			if (event.type === "thread.started") {
				if (event.thread_id && event.thread_id !== thread.codexThreadId) {
					updateThreadCodexId(db, thread.id, event.thread_id);
				}
				continue;
			}

			if (event.type === "turn.failed") {
				terminalError = event.error.message || "Codex turn failed.";
				continue;
			}

			if (event.type === "error") {
				terminalError = event.message || "Codex event stream failed.";
				continue;
			}

			if (
				event.type !== "item.started" &&
				event.type !== "item.updated" &&
				event.type !== "item.completed"
			) {
				continue;
			}

			const item = event.item;
			if (item.type === "agent_message") {
				assistantText = item.text.trim() || assistantText;
				continue;
			}

			if (item.type === "reasoning") {
				await upsertReasoningActivity(
					threadId,
					item,
					event.type === "item.completed" ? "completed" : "in_progress",
				);
				continue;
			}

			if (item.type === "command_execution") {
				await upsertCommandActivity(threadId, item);
				continue;
			}

			if (item.type === "file_change") {
				await upsertFileChangeActivity(threadId, thread.worktreePath, item);
			}
		}

		if (terminalError) {
			throw new Error(terminalError);
		}

		const finalAssistantText = assistantText.trim() || "No response returned.";
		if (codexThread.id && codexThread.id !== thread.codexThreadId) {
			updateThreadCodexId(db, thread.id, codexThread.id);
		}
		createThreadMessage(db, {
			threadId,
			role: "assistant",
			text: finalAssistantText,
		});
		markThreadRan(db, threadId);
		setThreadRunStatus(threadId, {
			state: "idle",
			startedAt,
			updatedAt: getNow(),
			error: null,
			hasUnreadError: false,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const errorMessage = `Codex turn failed: ${message}`;
		markThreadFailed(db, threadId, errorMessage);
		setThreadRunStatus(threadId, {
			state: "failed",
			startedAt,
			updatedAt: getNow(),
			error: errorMessage,
			hasUnreadError: true,
		});
		console.error(`Codex turn failed for thread ${threadId}`, error);
	}
}

function worktreePathFromName(
	projectPath: string,
	worktreeName: string,
): string {
	const token = worktreeName
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");
	if (!token) {
		throw new Error("Worktree name must contain at least one valid character.");
	}

	return resolve(dirname(projectPath), `${basename(projectPath)}-${token}`);
}

async function readProjectWorktrees(
	projectPath: string,
	projectId?: number,
): Promise<RpcWorktree[]> {
	const worktrees = await listWorktreesForProjectPath(projectPath);
	if (typeof projectId === "number") {
		const state = projectPollMap.get(projectId);
		if (state) {
			state.worktrees = worktrees;
		}
	}
	return worktrees;
}

export async function listDirectorySuggestionsProcedure(
	params: AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
): Promise<AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]> {
	const query = params.query.trim();
	if (!query) {
		return { directories: [] };
	}

	const { searchDirectory, namePrefix } = parseDirectorySuggestionQuery(query);
	if (!safeIsDirectory(searchDirectory)) {
		return { directories: [] };
	}

	try {
		const normalizedPrefix = namePrefix.toLocaleLowerCase();
		const directories = sortDirectoryNames(
			readdirSync(searchDirectory).filter((entry) => {
				if (entry.startsWith(".")) {
					return false;
				}
				if (
					normalizedPrefix &&
					!entry.toLocaleLowerCase().startsWith(normalizedPrefix)
				) {
					return false;
				}
				return safeIsDirectory(resolve(searchDirectory, entry));
			}),
		)
			.slice(0, DIRECTORY_SUGGESTION_LIMIT)
			.map((entry) => resolve(searchDirectory, entry));

		return { directories };
	} catch {
		return { directories: [] };
	}
}

function assertProjectDirectory(projectPath: string): void {
	if (!existsSync(projectPath)) {
		throw new Error(`Project path does not exist: ${projectPath}`);
	}
	if (!statSync(projectPath).isDirectory()) {
		throw new Error(`Project path must be a directory: ${projectPath}`);
	}
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
	const proc = Bun.spawn({
		cmd: ["git", ...args],
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	if (exitCode !== 0) {
		throw new Error(stderr || `git command failed with exit code ${exitCode}`);
	}

	return stdout.trim();
}

function normalizeGitPath(worktreePath: string, value: string): string {
	const resolvedPath = resolve(worktreePath, value);
	return relative(worktreePath, resolvedPath).replace(/\\/g, "/");
}

function splitLines(value: string): string[] {
	if (!value) {
		return [];
	}
	return value.replace(/\r\n/g, "\n").split("\n");
}

function buildSyntheticAddDiff(path: string, content: string): string {
	const lines = splitLines(content);
	const header = ["--- /dev/null", `+++ b/${path}`];
	if (lines.length === 0) {
		return [...header, "@@ -0,0 +1,0 @@"].join("\n");
	}
	return [
		...header,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map((line) => `+${line}`),
	].join("\n");
}

function buildSyntheticDeleteDiff(path: string, content: string): string {
	const lines = splitLines(content);
	const header = [`--- a/${path}`, "+++ /dev/null"];
	if (lines.length === 0) {
		return [...header, "@@ -1,0 +0,0 @@"].join("\n");
	}
	return [
		...header,
		`@@ -1,${lines.length} +0,0 @@`,
		...lines.map((line) => `-${line}`),
	].join("\n");
}

async function readTextFile(path: string): Promise<string> {
	return Bun.file(path).text();
}

async function readFileChangeDiff(
	worktreePath: string,
	changePath: string,
	changeKind: "add" | "delete" | "update",
): Promise<string> {
	const gitPath = normalizeGitPath(worktreePath, changePath);
	const fullPath = resolve(worktreePath, gitPath);

	if (changeKind !== "add") {
		try {
			const diff = await runGitCommand(worktreePath, [
				"diff",
				"--no-ext-diff",
				"--unified=3",
				"--",
				gitPath,
			]);
			if (diff.trim()) {
				return diff;
			}
		} catch {
			// Fall through to synthetic diff handling below.
		}
	}

	if (changeKind === "add" && existsSync(fullPath)) {
		try {
			return buildSyntheticAddDiff(gitPath, await readTextFile(fullPath));
		} catch {
			return `+++ b/${gitPath}\n+[binary or unreadable file added]`;
		}
	}

	if (changeKind === "delete") {
		try {
			const previous = await runGitCommand(worktreePath, [
				"show",
				`HEAD:${gitPath}`,
			]);
			return buildSyntheticDeleteDiff(gitPath, previous);
		} catch {
			return `--- a/${gitPath}\n-[file deleted]`;
		}
	}

	return "";
}

async function upsertReasoningActivity(
	threadId: number,
	item: Extract<ThreadItem, { type: "reasoning" }>,
	state: "in_progress" | "completed",
): Promise<void> {
	upsertThreadActivity(db, {
		threadId,
		itemId: item.id,
		kind: "reasoning",
		text: item.text.trim() || "Reasoning",
		state,
	});
}

async function upsertCommandActivity(
	threadId: number,
	item: Extract<ThreadItem, { type: "command_execution" }>,
): Promise<void> {
	upsertThreadActivity(db, {
		threadId,
		itemId: item.id,
		kind: "command",
		text: item.command,
		state: item.status,
		payloadJson: JSON.stringify({
			command: item.command,
			output: item.aggregated_output,
			exitCode: item.exit_code ?? null,
		} satisfies CommandActivityPayload),
	});
}

async function upsertFileChangeActivity(
	threadId: number,
	worktreePath: string,
	item: Extract<ThreadItem, { type: "file_change" }>,
): Promise<void> {
	await Promise.all(
		item.changes.map(async (change) => {
			const diffText =
				item.status === "completed"
					? await readFileChangeDiff(worktreePath, change.path, change.kind)
					: "";
			const gitPath = normalizeGitPath(worktreePath, change.path);
			upsertThreadActivity(db, {
				threadId,
				itemId: `${item.id}:${gitPath}`,
				kind: "file_change",
				text: gitPath,
				state: item.status,
				payloadJson: JSON.stringify({
					path: gitPath,
					changeKind: change.kind,
					diffText,
				} satisfies FileChangeActivityPayload),
			});
		}),
	);
}

function parseWorktreeList(raw: string): RpcWorktree[] {
	if (!raw.trim()) return [];

	const records: RpcWorktree[] = [];
	let current: Partial<RpcWorktree> | null = null;

	for (const line of raw.split(/\r?\n/)) {
		if (line.startsWith("worktree ")) {
			if (current?.path) {
				records.push(current as RpcWorktree);
			}
			current = {
				path: line.replace("worktree ", "").trim(),
				branch: null,
				head: null,
				bare: false,
			};
			continue;
		}

		if (!current) continue;

		if (line === "bare") {
			current.bare = true;
			continue;
		}
		if (line.startsWith("HEAD ")) {
			current.head = line.replace("HEAD ", "").trim();
			continue;
		}
		if (line.startsWith("branch ")) {
			const branchRef = line.replace("branch ", "").trim();
			current.branch = branchRef.startsWith("refs/heads/")
				? branchRef.replace("refs/heads/", "")
				: branchRef;
		}
	}

	if (current?.path) {
		records.push(current as RpcWorktree);
	}

	return records;
}

async function listWorktreesForProjectPath(
	projectPath: string,
): Promise<RpcWorktree[]> {
	const porcelain = await runGitCommand(projectPath, [
		"worktree",
		"list",
		"--porcelain",
	]);
	return parseWorktreeList(porcelain).map((worktree) => ({
		...worktree,
		path: normalizeWorktreePath(projectPath, worktree.path),
	}));
}

async function readDiff(worktreePath: string): Promise<string[]> {
	const raw = await runGitCommand(worktreePath, ["diff", "--name-status"]);
	if (!raw.trim()) return [];
	return raw.split(/\r?\n/).filter(Boolean);
}

async function readFiles(worktreePath: string): Promise<string[]> {
	const raw = await runGitCommand(worktreePath, ["status", "--short"]);
	if (!raw.trim()) return [];
	return raw.split(/\r?\n/).filter(Boolean);
}

function getNow(): string {
	return new Date().toISOString();
}

async function refreshProjectPoll(projectId: number): Promise<void> {
	const state = projectPollMap.get(projectId);
	if (!state) return;

	const worktrees = await listWorktreesForProjectPath(state.projectPath);
	state.worktrees = worktrees;

	const activeWorktrees = new Set(worktrees.map((w) => w.path));
	for (const [wtPath] of state.openWorktrees) {
		if (!activeWorktrees.has(wtPath)) {
			stopWorktreePolling(state, wtPath);
		}
	}
}

function ensureProjectPoller(project: ProjectRecord): ProjectPollState {
	let state = projectPollMap.get(project.id);
	if (!state) {
		state = {
			id: project.id,
			project,
			projectPath: project.path,
			worktrees: [],
			projectTimer: null,
			openWorktrees: new Map(),
		};
		projectPollMap.set(project.id, state);
	}

	state.project = project;
	state.projectPath = project.path;

	if (!state.projectTimer) {
		state.projectTimer = setInterval(() => {
			refreshProjectPoll(project.id).catch((error) => {
				console.error(
					`Worktree polling failed for project ${project.id}`,
					error,
				);
			});
		}, PROJECT_POLL_INTERVAL_MS);
	}

	return state;
}

function stopWorktreePolling(
	state: ProjectPollState,
	worktreePath: string,
): void {
	const active = state.openWorktrees.get(worktreePath);
	if (!active) return;

	if (active.diffTimer) {
		clearInterval(active.diffTimer);
	}
	if (active.filesTimer) {
		clearInterval(active.filesTimer);
	}
	state.openWorktrees.delete(worktreePath);
}

function startWorktreePolling(
	state: ProjectPollState,
	worktreePath: string,
): WorktreePollState {
	const existing = state.openWorktrees.get(worktreePath);
	if (existing) return existing;

	const worktreeState: WorktreePollState = {
		diff: [],
		files: [],
		diffTimer: null,
		filesTimer: null,
		lastUpdatedAt: getNow(),
	};

	const pollDiff = async () => {
		try {
			worktreeState.diff = await readDiff(worktreePath);
			worktreeState.lastUpdatedAt = getNow();
		} catch (error) {
			console.error(`Diff poll failed for ${worktreePath}`, error);
		}
	};

	const pollFiles = async () => {
		try {
			worktreeState.files = await readFiles(worktreePath);
			worktreeState.lastUpdatedAt = getNow();
		} catch (error) {
			console.error(`File poll failed for ${worktreePath}`, error);
		}
	};

	worktreeState.diffTimer = setInterval(() => {
		void pollDiff();
	}, DIFF_POLL_INTERVAL_MS);
	worktreeState.filesTimer = setInterval(() => {
		void pollFiles();
	}, FILE_POLL_INTERVAL_MS);

	state.openWorktrees.set(worktreePath, worktreeState);
	void pollDiff();
	void pollFiles();

	return worktreeState;
}

function stopProjectPoller(projectId: number): void {
	const state = projectPollMap.get(projectId);
	if (!state) return;
	if (state.projectTimer) {
		clearInterval(state.projectTimer);
	}
	for (const wtPath of state.openWorktrees.keys()) {
		stopWorktreePolling(state, wtPath);
	}
	projectPollMap.delete(projectId);
}

function projectByIdForPath(projectId: number): ProjectRecord {
	const project = getProjectById(db, projectId);
	if (!project) {
		throw new Error(`Project not currently tracked: ${projectId}`);
	}
	return project;
}

async function findProjectWorktree(
	project: ProjectRecord,
	worktreePath: string,
): Promise<RpcWorktree | null> {
	const worktrees = await readProjectWorktrees(project.path, project.id);
	return worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

export async function openProjectProcedure(
	params: AppRPCSchema["requests"]["openProject"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const projectPath = normalizePath(params.projectPath);
	assertProjectDirectory(projectPath);

	let worktrees: RpcWorktree[];
	try {
		worktrees = await readProjectWorktrees(projectPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Project folder must be a git repository root or worktree: ${projectPath}${message ? ` (${message})` : ""}`,
		);
	}

	const project = upsertProject(db, {
		projectPath,
		name: params.name ?? basename(projectPath),
	});
	const state = ensureProjectPoller(project);
	state.worktrees = worktrees;

	return {
		project,
		worktrees: state.worktrees,
	};
}

export async function listProjectWorktreesProcedure(
	params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const project = projectByIdForPath(params.projectId);
	const worktrees = await readProjectWorktrees(project.path, project.id);

	return {
		project,
		worktrees,
	};
}

export async function createWorktreeProcedure(
	params: AppRPCSchema["requests"]["createWorktree"]["params"],
): Promise<RpcCreateWorktreeResult> {
	const project = projectByIdForPath(params.projectId);
	const worktreeName = params.name.trim();
	if (!worktreeName) {
		throw new Error("Worktree name is required.");
	}

	const worktreePath = worktreePathFromName(project.path, worktreeName);
	if (existsSync(worktreePath)) {
		throw new Error(`Worktree path already exists: ${worktreePath}`);
	}

	await runGitCommand(project.path, [
		"worktree",
		"add",
		"-b",
		worktreeName,
		worktreePath,
	]);

	const worktrees = await readProjectWorktrees(project.path, project.id);
	return {
		project,
		worktrees,
		worktreePath,
	};
}

export async function createThreadProcedure(
	params: AppRPCSchema["requests"]["createThread"]["params"],
): Promise<RpcThreadDetail> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	const worktree = await findProjectWorktree(project, worktreePath);
	if (!worktree) {
		throw new Error(
			`Worktree not found for project ${project.path}: ${worktreePath}`,
		);
	}

	const codexThread = codex.startThread(codexThreadOptions(worktreePath));
	try {
		await initializeCodexThread(codexThread);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to start Codex thread: ${message}`);
	}

	const codexThreadId = codexThread.id;
	if (!codexThreadId) {
		throw new Error("Codex did not provide a persistent thread id.");
	}

	const thread = createThread(db, {
		projectId: project.id,
		worktreePath,
		title: buildThreadTitle(worktree, worktreePath),
		codexThreadId,
	});
	codexThreadMap.set(thread.id, codexThread);
	return buildThreadDetail(thread.id);
}

export async function getThreadProcedure(
	params: AppRPCSchema["requests"]["getThread"]["params"],
): Promise<RpcThreadDetail> {
	return buildThreadDetail(params.threadId);
}

export async function markThreadErrorSeenProcedure(
	params: AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
): Promise<RpcThreadDetail> {
	const thread = threadById(params.threadId);
	markThreadErrorSeen(db, thread.id);
	const currentStatus = threadRunStatusFromRecord(thread);
	setThreadRunStatus(thread.id, {
		...currentStatus,
		hasUnreadError: false,
	});
	return buildThreadDetail(thread.id);
}

export async function sendThreadMessageProcedure(
	params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
): Promise<RpcThreadDetail> {
	const thread = threadById(params.threadId);
	const input = params.input.trim();
	if (!input) {
		throw new Error("Thread input is required.");
	}

	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error("Thread is already processing a message.");
	}

	markThreadErrorSeen(db, thread.id);
	createThreadMessage(db, {
		threadId: thread.id,
		role: "user",
		text: input,
	});
	touchThread(db, thread.id);

	const startedAt = getNow();
	setThreadRunStatus(thread.id, {
		state: "working",
		startedAt,
		updatedAt: startedAt,
		error: null,
		hasUnreadError: false,
	});

	void runThreadMessageInBackground(thread.id, input, startedAt);

	return buildThreadDetail(thread.id);
}

export async function renameThreadProcedure(
	params: AppRPCSchema["requests"]["renameThread"]["params"],
): Promise<RpcThread> {
	const thread = threadById(params.threadId);
	const title = params.title.trim();
	if (!title) {
		throw new Error("Thread title is required.");
	}

	renameThread(db, thread.id, title);
	return toRpcThread(threadById(thread.id));
}

export async function setThreadPinnedProcedure(
	params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
): Promise<RpcThread> {
	const thread = threadById(params.threadId);
	setThreadPinned(db, thread.id, params.pinned);
	return toRpcThread(threadById(thread.id));
}

export async function deleteThreadProcedure(
	params: AppRPCSchema["requests"]["deleteThread"]["params"],
): Promise<AppRPCSchema["requests"]["deleteThread"]["response"]> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error("Thread is currently processing and cannot be deleted.");
	}

	codexThreadMap.delete(thread.id);
	threadRunStatusMap.delete(thread.id);
	deleteThread(db, thread.id);
	return {
		success: true,
		threadId: thread.id,
		message: `Deleted thread ${thread.title}`,
	};
}

export async function openWorktreeProcedure(
	params: AppRPCSchema["requests"]["openWorktree"]["params"],
): Promise<RpcOpenWorktreeResult> {
	const project = projectByIdForPath(params.projectId);
	const state = ensureProjectPoller(project);
	if (!state.worktrees.length) {
		await refreshProjectPoll(project.id);
	}

	const worktreePath = normalizePath(params.worktreePath);
	const target = state.worktrees.find((entry) => entry.path === worktreePath);
	if (!target) {
		throw new Error(
			`Worktree not found for project ${project.path}: ${worktreePath}`,
		);
	}

	const worktreeState = startWorktreePolling(state, worktreePath);
	await Promise.all([readDiff(worktreePath), readFiles(worktreePath)]).then(
		([diff, files]) => {
			worktreeState.diff = diff;
			worktreeState.files = files;
			worktreeState.lastUpdatedAt = getNow();
		},
	);

	return {
		project,
		worktree: {
			path: worktreePath,
			diff: worktreeState.diff,
			files: worktreeState.files,
			lastUpdatedAt: worktreeState.lastUpdatedAt,
		},
	};
}

export async function closeWorktreeProcedure(
	params: AppRPCSchema["requests"]["closeWorktree"]["params"],
): Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]> {
	const state = projectPollMap.get(params.projectId);
	if (state) {
		stopWorktreePolling(state, normalizePath(params.worktreePath));
	}

	return {
		success: true,
		projectId: params.projectId,
		worktreePath: normalizePath(params.worktreePath),
	};
}

export async function closeProjectProcedure(
	params: AppRPCSchema["requests"]["closeProject"]["params"],
): Promise<AppRPCSchema["requests"]["closeProject"]["response"]> {
	const project = projectByIdForPath(params.projectId);
	stopProjectPoller(project.id);
	setProjectClosed(db, project.id);
	return {
		success: true,
		projectId: project.id,
		message: `Closed project ${project.name}`,
	};
}

export async function deleteProjectProcedure(
	params: AppRPCSchema["requests"]["deleteProject"]["params"],
): Promise<AppRPCSchema["requests"]["deleteProject"]["response"]> {
	const project = projectByIdForPath(params.projectId);
	stopProjectPoller(project.id);
	deleteProject(db, project.id);
	return {
		success: true,
		projectId: project.id,
		message: `Removed project ${project.name}`,
	};
}

export function getOpenWorktreeSnapshot(
	projectId: number,
	worktreePath: string,
): RpcWorktreeSnapshot | null {
	const state = projectPollMap.get(projectId);
	if (!state) return null;
	const normalized = normalizePath(worktreePath);
	const worktreeState = state.openWorktrees.get(normalized);
	if (!worktreeState) return null;
	return {
		path: normalized,
		diff: worktreeState.diff,
		files: worktreeState.files,
		lastUpdatedAt: worktreeState.lastUpdatedAt,
	};
}

export function shutdownProjectPolling(): void {
	for (const projectId of projectPollMap.keys()) {
		stopProjectPoller(projectId);
	}
}
