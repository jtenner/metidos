import {
	type FSWatcher,
	existsSync,
	readFileSync,
	readdirSync,
	statSync,
	watch,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import {
	Codex,
	type Thread as CodexThread,
	type ModelReasoningEffort,
	type ThreadItem,
} from "@openai/codex-sdk";

import type { ProjectRecord, ThreadMessageRecord, ThreadRecord } from "./db";
import {
	DEFAULT_THREAD_MODEL,
	DEFAULT_THREAD_REASONING_EFFORT,
	createThread,
	createThreadMessage,
	deleteProject,
	deleteThread,
	getProject,
	getProjectById,
	getThreadById,
	initAppDatabase,
	listProjectWorktreePins,
	listProjects,
	listThreadMessages,
	listThreads,
	markThreadErrorSeen,
	markThreadFailed,
	markThreadRan,
	renameThread,
	setProjectClosed,
	setProjectWorktreePinned,
	setThreadModel,
	setThreadPinned,
	setThreadReasoningEffort,
	setThreadUsage,
	settleInProgressThreadMessages,
	touchThread,
	updateThreadCodexId,
	upsertProject,
	upsertThreadActivity,
} from "./db";
import type {
	AppRPCSchema,
	RpcCodexModelCatalog,
	RpcCodexModelOption,
	RpcCodexReasoningEffort,
	RpcCodexReasoningEffortOption,
	RpcCreateWorktreeResult,
	RpcGitCommitDiffResult,
	RpcGitHistoryEntry,
	RpcOpenWorktreeResult,
	RpcProject,
	RpcProjectTask,
	RpcProjectWorktreesResult,
	RpcRequestContext,
	RpcRequestPriority,
	RpcThread,
	RpcThreadCompaction,
	RpcThreadDetail,
	RpcThreadMessage,
	RpcThreadRunStatus,
	RpcThreadUsage,
	RpcWorktree,
	RpcWorktreeGitHistoryResult,
	RpcWorktreeGitHistorySummary,
	RpcWorktreeSnapshot,
} from "./rpc-schema";

const db = initAppDatabase();
const JOLT_DEFAULT_RPC_URL = "ws://127.0.0.1:7599/rpc";
const JOLT_MCP_SERVER_NAME = "jolt";
const JOLT_SIDECAR_SERVER_PATH = resolve(
	process.cwd(),
	"src/bun/codex-sidecar-mcp.ts",
);

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

export function startProcedureCacheMaintenance(): void {
	if (directorySuggestionRefreshTimer !== null) {
		return;
	}

	directorySuggestionRefreshTimer = setInterval(() => {
		refreshRecentDirectorySuggestionEntries();
	}, DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS);
}

export function warmProcedureStartupCaches(): void {
	const homeDirectory = homedir();
	if (safeIsDirectory(homeDirectory)) {
		try {
			readDirectorySuggestionEntries(homeDirectory);
		} catch (error) {
			console.error(
				`Failed to warm directory suggestion cache for ${homeDirectory}`,
				error,
			);
		}
	}

	const mostRecentThread = listThreads(db)[0] ?? null;
	if (mostRecentThread) {
		warmThreadDetailCache(mostRecentThread.id);
	}
}

export async function getCodexModelCatalogProcedure(
	_params?: AppRPCSchema["requests"]["getCodexModelCatalog"]["params"],
): Promise<RpcCodexModelCatalog> {
	return buildCodexModelCatalog();
}

const PROJECT_POLL_INTERVAL_MS = 4_000;
const PROJECT_WORKTREE_CACHE_STALE_MS = 12_000;
const GIT_HISTORY_POLL_INTERVAL_MS = 2_000;
const DEFAULT_GIT_HISTORY_PAGE_SIZE = 20;
const GIT_HISTORY_PREFETCH_CHUNK_SIZE = DEFAULT_GIT_HISTORY_PAGE_SIZE * 4;
const DIRECTORY_SUGGESTION_CACHE_TTL_MS = 60_000;
const DIRECTORY_SUGGESTION_CACHE_MAX_ENTRIES = 96;
const DIRECTORY_SUGGESTION_REFRESH_BATCH_SIZE = 6;
const DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS = 5_000;
const DIRECTORY_SUGGESTION_REFRESH_RECENT_WINDOW_MS = 90_000;
const THREAD_DETAIL_CACHE_MAX_ENTRIES = 32;
const GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES = 64;
const GIT_LOG_FIELD_SEPARATOR = "\u001f";
const GIT_LOG_RECORD_SEPARATOR = "\u001e";

type GitCommandPriority = "foreground" | "background";

type GitCommandOptions = {
	priority?: GitCommandPriority;
	signal?: AbortSignal | null;
};

type ProjectWorktreeReadOptions = GitCommandOptions & {
	forceRefresh?: boolean;
};

type GitCommandQueueTask = {
	abort: (reason: string) => void;
	detachAbortListener: () => void;
	priority: GitCommandPriority;
	reject: (reason?: unknown) => void;
	run: () => void;
	signal: AbortSignal;
	started: boolean;
};

type PendingGitCommitDiffRequest = {
	promise: Promise<RpcGitCommitDiffResult>;
};

type PendingGitHistoryPrefetch = {
	controller: AbortController;
	priority: GitCommandPriority;
	promise: Promise<void>;
};

type TaskWatchTarget = {
	kind: "directory" | "tasks";
	path: string;
};

type WorktreePollState = {
	diff: string[];
	files: string[];
	history: RpcWorktreeGitHistorySummary;
	historyEntries: RpcGitHistoryEntry[];
	historyNextOffset: number | null;
	historyPolling: boolean;
	historyPrefetch: PendingGitHistoryPrefetch | null;
	historySignature: string | null;
	historyTimer: ReturnType<typeof setInterval> | null;
	tasks: RpcProjectTask[] | null;
	taskWatchTargets: TaskWatchTarget[];
	taskWatchers: FSWatcher[];
	lastUpdatedAt: string;
};

type ProjectPollState = {
	id: number;
	project: ProjectRecord;
	projectPath: string;
	worktrees: RpcWorktree[];
	worktreesLoadedAt: number;
	activeWorktreePath: string | null;
	projectTimer: ReturnType<typeof setInterval> | null;
	openWorktrees: Map<string, WorktreePollState>;
};

const projectPollMap = new Map<number, ProjectPollState>();
const codexThreadMap = new Map<number, CodexThread>();
const threadRunStatusMap = new Map<number, RpcThreadRunStatus>();
const threadTurnAbortControllerMap = new Map<number, AbortController>();
const threadTurnCompletionMap = new Map<number, Promise<void>>();
const directorySuggestionCache = new Map<
	string,
	{
		directoryNames: string[];
		lastAccessedAt: number;
		loadedAt: number;
	}
>();
const threadDetailCache = new Map<number, RpcThreadDetail>();
const gitCommitDiffCache = new Map<string, RpcGitCommitDiffResult>();
const gitCommitDiffRequestCache = new Map<
	string,
	PendingGitCommitDiffRequest
>();
const gitCommandQueueMap = new Map<
	string,
	{
		active: boolean;
		activeTask: GitCommandQueueTask | null;
		backgroundTasks: GitCommandQueueTask[];
		foregroundTasks: GitCommandQueueTask[];
	}
>();
let directorySuggestionRefreshTimer: ReturnType<typeof setInterval> | null =
	null;
let worktreeTaskChangeListener:
	| ((projectId: number, worktreePath: string) => void)
	| null = null;
let worktreeGitHistoryChangeListener:
	| ((projectId: number, worktreePath: string) => void)
	| null = null;
const DEFAULT_COMPACTION_ESTIMATE_RATIO = 0.8;
const COMPACTION_INFERENCE_MIN_PREVIOUS_WINDOW_RATIO = 0.72;
const COMPACTION_INFERENCE_MAX_CURRENT_RATIO = 0.68;
const COMPACTION_INFERENCE_MIN_DROP_WINDOW_RATIO = 0.16;

function joltRpcUrl(): string {
	const configured = process.env.JOLT_RPC_URL?.trim();
	if (configured) {
		return configured;
	}

	const configuredPort = process.env.JOLT_PORT?.trim();
	if (configuredPort) {
		return `ws://127.0.0.1:${configuredPort}/rpc`;
	}

	return JOLT_DEFAULT_RPC_URL;
}

function createCodexClient(
	thread: Pick<ThreadRecord, "id" | "projectId" | "worktreePath">,
): Codex {
	return new Codex({
		config: {
			mcp_servers: {
				[JOLT_MCP_SERVER_NAME]: {
					command: process.execPath,
					args: [JOLT_SIDECAR_SERVER_PATH],
					env: {
						JOLT_PROJECT_ID: String(thread.projectId),
						JOLT_THREAD_ID: String(thread.id),
						JOLT_WORKTREE_PATH: thread.worktreePath,
						JOLT_RPC_URL: joltRpcUrl(),
					},
				},
			},
		},
	});
}

function readLruValue<Key, Value>(
	cache: Map<Key, Value>,
	key: Key,
): Value | null {
	if (!cache.has(key)) {
		return null;
	}

	const value = cache.get(key);
	if (typeof value === "undefined") {
		return null;
	}

	cache.delete(key);
	cache.set(key, value);
	return value;
}

function writeLruValue<Key, Value>(
	cache: Map<Key, Value>,
	key: Key,
	value: Value,
	maxEntries: number,
): void {
	if (cache.has(key)) {
		cache.delete(key);
	}
	cache.set(key, value);

	while (cache.size > maxEntries) {
		const oldest = cache.keys().next();
		if (oldest.done) {
			return;
		}
		cache.delete(oldest.value);
	}
}

function lruEntriesNewestFirst<Key, Value>(
	cache: Map<Key, Value>,
): Array<[Key, Value]> {
	return [...cache.entries()].reverse();
}

function createAbortError(reason: unknown, fallbackMessage: string): Error {
	if (reason instanceof Error) {
		return reason;
	}

	const error = new Error(
		typeof reason === "string" && reason.trim() ? reason : fallbackMessage,
		{
			cause: reason,
		},
	);
	if (reason instanceof DOMException && reason.name) {
		error.name = reason.name;
	} else {
		error.name = "AbortError";
	}
	return error;
}

function isAbortError(error: unknown): boolean {
	return (
		error instanceof Error &&
		(error.name === "AbortError" || error.name === "TimeoutError")
	);
}

function throwIfAborted(
	signal: AbortSignal | null | undefined,
	fallbackMessage: string,
): void {
	if (signal?.aborted) {
		throw createAbortError(signal.reason, fallbackMessage);
	}
}

async function awaitAbortableResult<T>(
	promise: Promise<T>,
	signal: AbortSignal | null | undefined,
	fallbackMessage: string,
): Promise<T> {
	if (!signal) {
		return promise;
	}
	if (signal.aborted) {
		throw createAbortError(signal.reason, fallbackMessage);
	}

	return new Promise<T>((resolve, reject) => {
		const handleAbort = () => {
			signal.removeEventListener("abort", handleAbort);
			reject(createAbortError(signal.reason, fallbackMessage));
		};
		signal.addEventListener("abort", handleAbort, {
			once: true,
		});
		void promise.then(
			(value) => {
				signal.removeEventListener("abort", handleAbort);
				resolve(value);
			},
			(error) => {
				signal.removeEventListener("abort", handleAbort);
				reject(error);
			},
		);
	});
}

function normalizeGitCommandOptions(
	options?: GitCommandPriority | GitCommandOptions,
): { priority: GitCommandPriority; signal: AbortSignal | null } {
	if (options === "foreground" || options === "background") {
		return {
			priority: options,
			signal: null,
		};
	}

	return {
		priority: options?.priority ?? "foreground",
		signal: options?.signal ?? null,
	};
}

function gitPriorityFromRpcRequest(
	priority: RpcRequestPriority,
): GitCommandPriority {
	return priority === "background" ? "background" : "foreground";
}

function gitCommandOptionsFromRequest(
	context?: RpcRequestContext,
): GitCommandOptions | undefined {
	if (!context) {
		return undefined;
	}

	return {
		priority: gitPriorityFromRpcRequest(context.priority),
		signal: context.signal,
	};
}

// Sourced from OpenAI's official models docs on March 29, 2026. The SDK accepts
// raw model IDs, but it does not expose a discovery API for enumerating them.
const CODEx_MODEL_OPTIONS: RpcCodexModelOption[] = [
	{
		id: "gpt-5.4",
		label: "GPT-5.4",
		group: "Frontier",
		summary: "Latest flagship model for complex reasoning and coding.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-pro",
		label: "GPT-5.4 Pro",
		group: "Frontier",
		summary: "Higher-precision GPT-5.4 variant for harder tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-mini",
		label: "GPT-5.4 Mini",
		group: "Frontier",
		summary: "Faster lower-cost GPT-5.4 model for coding and subagents.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.4-nano",
		label: "GPT-5.4 Nano",
		group: "Frontier",
		summary: "Cheapest GPT-5.4-class model for simple tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5-mini",
		label: "GPT-5 Mini",
		group: "Frontier",
		summary: "Near-frontier intelligence for cost-sensitive workloads.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5-nano",
		label: "GPT-5 Nano",
		group: "Frontier",
		summary: "Fastest and most cost-efficient GPT-5 model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5",
		label: "GPT-5",
		group: "Frontier",
		summary: "Previous GPT-5 frontier model for coding and agentic work.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-4.1",
		label: "GPT-4.1",
		group: "Frontier",
		summary: "Highest-capability non-reasoning general model.",
		deprecated: false,
		contextWindowTokens: 1_047_576,
	},
	{
		id: "gpt-5-codex",
		label: "GPT-5-Codex",
		group: "Coding",
		summary: "GPT-5 variant optimized for agentic coding in Codex.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.3-codex",
		label: "GPT-5.3-Codex",
		group: "Coding",
		summary: "Previous high-capability agentic coding model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.2-codex",
		label: "GPT-5.2-Codex",
		group: "Coding",
		summary: "Long-horizon coding model for complex repo work.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex",
		label: "GPT-5.1-Codex",
		group: "Coding",
		summary: "GPT-5.1 variant optimized for agentic coding in Codex.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex-max",
		label: "GPT-5.1-Codex-Max",
		group: "Coding",
		summary: "GPT-5.1 Codex variant tuned for longer-running tasks.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "gpt-5.1-codex-mini",
		label: "GPT-5.1-Codex-Mini",
		group: "Coding",
		summary: "Smaller cheaper GPT-5.1 Codex model.",
		deprecated: false,
		contextWindowTokens: 400_000,
	},
	{
		id: "codex-mini-latest",
		label: "Codex Mini Latest",
		group: "Coding",
		summary: "Deprecated fast reasoning model for older Codex workflows.",
		deprecated: true,
		contextWindowTokens: 200_000,
	},
];

const codexModelOptionMap = new Map(
	CODEx_MODEL_OPTIONS.map((model) => [model.id, model]),
);

const CODEX_REASONING_EFFORT_OPTIONS: RpcCodexReasoningEffortOption[] = [
	{
		id: "minimal",
		label: "Minimal",
	},
	{
		id: "low",
		label: "Low",
	},
	{
		id: "medium",
		label: "Medium",
	},
	{
		id: "high",
		label: "High",
	},
	{
		id: "xhigh",
		label: "Extra High",
	},
];

const codexReasoningEffortOptionMap = new Map(
	CODEX_REASONING_EFFORT_OPTIONS.map((option) => [option.id, option]),
);

function buildCodexModelCatalog(): RpcCodexModelCatalog {
	return {
		defaultModel: DEFAULT_THREAD_MODEL,
		defaultReasoningEffort: DEFAULT_THREAD_REASONING_EFFORT,
		models: CODEx_MODEL_OPTIONS,
		reasoningEfforts: CODEX_REASONING_EFFORT_OPTIONS,
	};
}

function contextWindowTokensForModel(model: string | null | undefined): number {
	const normalized = normalizeStoredCodexModel(model);
	return codexModelOptionMap.get(normalized)?.contextWindowTokens ?? 400_000;
}

function heuristicCompactionTriggerTokens(
	model: string | null | undefined,
): number {
	return Math.round(
		contextWindowTokensForModel(model) * DEFAULT_COMPACTION_ESTIMATE_RATIO,
	);
}

function resolveCodexModel(model: string | null | undefined): string {
	const normalized = model?.trim();
	if (!normalized) {
		return DEFAULT_THREAD_MODEL;
	}
	if (!codexModelOptionMap.has(normalized)) {
		throw new Error(`Unsupported Codex model: ${normalized}`);
	}
	return normalized;
}

function normalizeStoredCodexModel(model: string | null | undefined): string {
	const normalized = model?.trim();
	if (!normalized || !codexModelOptionMap.has(normalized)) {
		return DEFAULT_THREAD_MODEL;
	}
	return normalized;
}

function resolveCodexReasoningEffort(
	reasoningEffort: string | null | undefined,
): RpcCodexReasoningEffort {
	const normalized = reasoningEffort?.trim() as
		| ModelReasoningEffort
		| undefined;
	if (!normalized) {
		return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
	}
	if (!codexReasoningEffortOptionMap.has(normalized)) {
		throw new Error(`Unsupported reasoning effort: ${normalized}`);
	}
	return normalized;
}

function normalizeStoredCodexReasoningEffort(
	reasoningEffort: string | null | undefined,
): RpcCodexReasoningEffort {
	const normalized = reasoningEffort?.trim() as
		| ModelReasoningEffort
		| undefined;
	if (!normalized || !codexReasoningEffortOptionMap.has(normalized)) {
		return DEFAULT_THREAD_REASONING_EFFORT as RpcCodexReasoningEffort;
	}
	return normalized;
}

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

function readDirectorySuggestionNamesFromDisk(
	searchDirectory: string,
): string[] {
	return sortDirectoryNames(
		readdirSync(searchDirectory, { withFileTypes: true })
			.filter((entry) => {
				if (entry.name.startsWith(".")) {
					return false;
				}
				if (entry.isDirectory()) {
					return true;
				}
				if (entry.isSymbolicLink()) {
					return safeIsDirectory(resolve(searchDirectory, entry.name));
				}
				return false;
			})
			.map((entry) => entry.name),
	);
}

function refreshDirectorySuggestionEntries(
	searchDirectory: string,
	lastAccessedAt = Date.now(),
): string[] {
	try {
		const directoryNames =
			readDirectorySuggestionNamesFromDisk(searchDirectory);
		writeLruValue(
			directorySuggestionCache,
			searchDirectory,
			{
				directoryNames,
				lastAccessedAt,
				loadedAt: Date.now(),
			},
			DIRECTORY_SUGGESTION_CACHE_MAX_ENTRIES,
		);
		return directoryNames;
	} catch (error) {
		directorySuggestionCache.delete(searchDirectory);
		throw error;
	}
}

function readDirectorySuggestionEntries(searchDirectory: string): string[] {
	const now = Date.now();
	const cached = readLruValue(directorySuggestionCache, searchDirectory);
	if (cached && cached.loadedAt + DIRECTORY_SUGGESTION_CACHE_TTL_MS > now) {
		cached.lastAccessedAt = now;
		return cached.directoryNames;
	}

	return refreshDirectorySuggestionEntries(searchDirectory, now);
}

function refreshRecentDirectorySuggestionEntries(): void {
	const now = Date.now();
	for (const [searchDirectory, cached] of lruEntriesNewestFirst(
		directorySuggestionCache,
	)
		.filter(
			([, entry]) =>
				now - entry.lastAccessedAt <=
				DIRECTORY_SUGGESTION_REFRESH_RECENT_WINDOW_MS,
		)
		.slice(0, DIRECTORY_SUGGESTION_REFRESH_BATCH_SIZE)) {
		try {
			refreshDirectorySuggestionEntries(searchDirectory, cached.lastAccessedAt);
		} catch (error) {
			console.error(
				`Failed to refresh directory suggestion cache for ${searchDirectory}`,
				error,
			);
		}
	}
}

function safeIsDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function safeIsFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function tasksDirectoryPath(worktreePath: string): string {
	return resolve(worktreePath, ".tasks");
}

function normalizeRelativeTaskPath(taskPath: string): string {
	return taskPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
}

function taskTitleFromPath(taskPath: string): string {
	return taskPath.replace(/\.[^./\\]+$/, "").replace(/\\/g, "/");
}

function invalidateThreadDetailCache(threadId: number): void {
	threadDetailCache.delete(threadId);
}

function clearThreadRuntimeState(threadId: number): void {
	const activeController = threadTurnAbortControllerMap.get(threadId);
	if (activeController && !activeController.signal.aborted) {
		activeController.abort(
			createAbortError(null, "Thread runtime state was cleared."),
		);
	}
	threadTurnAbortControllerMap.delete(threadId);
	threadTurnCompletionMap.delete(threadId);
	codexThreadMap.delete(threadId);
	threadRunStatusMap.delete(threadId);
	invalidateThreadDetailCache(threadId);
}

function clearProjectThreadRuntimeState(projectId: number): void {
	for (const thread of listThreads(db)) {
		if (thread.projectId !== projectId) {
			continue;
		}
		clearThreadRuntimeState(thread.id);
	}
}

function formatTaskPrompt(taskTitle: string, taskContent: string): string {
	return `Your job is to perform the task: ${taskTitle}\n${taskContent.trim()}\n\nDo this now.`;
}

function formatPackageScriptTaskPrompt(task: {
	packageJsonPath: string;
	packageDirectory: string;
	scriptName: string;
	command: string;
}): string {
	return [
		`Your job is to run the package script "${task.scriptName}".`,
		`package.json: ${task.packageJsonPath}`,
		`Working directory: ${task.packageDirectory}`,
		`Run command: bun run ${task.scriptName}`,
		`Script definition: ${task.command}`,
		"",
		"Inspect the repository as needed, then run this task now and address any issues required to get it passing.",
	].join("\n");
}

function isIgnoredPackageDirectory(name: string): boolean {
	return (
		name === ".git" ||
		name === "node_modules" ||
		name === ".next" ||
		name === ".turbo" ||
		name === ".yarn" ||
		name === "dist" ||
		name === "build"
	);
}

function listProjectTaskFiles(
	tasksDirectory: string,
	prefix = "",
): RpcProjectTask[] {
	if (!safeIsDirectory(tasksDirectory)) {
		return [];
	}

	const tasks: RpcProjectTask[] = [];
	for (const entry of sortDirectoryNames(
		readdirSync(tasksDirectory).filter((value) => !value.startsWith(".")),
	)) {
		const fullPath = resolve(tasksDirectory, entry);
		const relativePath = prefix ? `${prefix}/${entry}` : entry;
		if (safeIsDirectory(fullPath)) {
			tasks.push(...listProjectTaskFiles(fullPath, relativePath));
			continue;
		}
		if (!safeIsFile(fullPath)) {
			continue;
		}
		tasks.push({
			id: `file:${relativePath.replace(/\\/g, "/")}`,
			kind: "file",
			path: relativePath.replace(/\\/g, "/"),
			title: taskTitleFromPath(relativePath),
			scriptName: null,
			command: null,
		});
	}

	return tasks;
}

function listPackageJsonTasks(
	rootDirectory: string,
	currentDirectory = rootDirectory,
): RpcProjectTask[] {
	if (!safeIsDirectory(currentDirectory)) {
		return [];
	}

	const tasks: RpcProjectTask[] = [];
	const entries = sortDirectoryNames(readdirSync(currentDirectory));
	const packageJsonPath = resolve(currentDirectory, "package.json");
	if (entries.includes("package.json") && safeIsFile(packageJsonPath)) {
		try {
			const parsed = JSON.parse(
				readFileSync(packageJsonPath, "utf8"),
			) as Partial<{
				scripts: Record<string, unknown>;
			}>;
			const scripts =
				parsed.scripts && typeof parsed.scripts === "object"
					? parsed.scripts
					: null;
			if (scripts) {
				const relativePackageJsonPath =
					relative(rootDirectory, packageJsonPath).replace(/\\/g, "/") ||
					"package.json";
				for (const scriptName of Object.keys(scripts).sort((a, b) =>
					a.localeCompare(b),
				)) {
					const command = scripts[scriptName];
					if (typeof command !== "string" || !command.trim()) {
						continue;
					}
					tasks.push({
						id: `script:${relativePackageJsonPath}:${scriptName}`,
						kind: "script",
						path: relativePackageJsonPath,
						title: scriptName,
						scriptName,
						command,
					});
				}
			}
		} catch {
			// Ignore invalid package.json files so one malformed package does not hide all tasks.
		}
	}

	for (const entry of entries) {
		if (entry === "package.json") {
			continue;
		}
		const fullPath = resolve(currentDirectory, entry);
		if (!safeIsDirectory(fullPath) || isIgnoredPackageDirectory(entry)) {
			continue;
		}
		tasks.push(...listPackageJsonTasks(rootDirectory, fullPath));
	}

	return tasks;
}

function addTaskWatchTarget(
	watchTargetKinds: Map<string, TaskWatchTarget["kind"]>,
	path: string,
	kind: TaskWatchTarget["kind"],
): void {
	const currentKind = watchTargetKinds.get(path);
	if (currentKind === "tasks" || currentKind === kind) {
		return;
	}
	watchTargetKinds.set(path, kind);
}

function collectTaskWatchTargets(
	worktreePath: string,
	currentDirectory: string,
	watchTargetKinds: Map<string, TaskWatchTarget["kind"]>,
): void {
	if (!safeIsDirectory(currentDirectory)) {
		return;
	}

	const entries = sortDirectoryNames(readdirSync(currentDirectory));
	const relativeDirectory =
		relative(worktreePath, currentDirectory).replace(/\\/g, "/") || ".";
	const insideTasksDirectory =
		relativeDirectory === ".tasks" || relativeDirectory.startsWith(".tasks/");
	addTaskWatchTarget(
		watchTargetKinds,
		currentDirectory,
		insideTasksDirectory ? "tasks" : "directory",
	);

	if (insideTasksDirectory) {
		for (const entry of entries) {
			if (entry.startsWith(".")) {
				continue;
			}
			const fullPath = resolve(currentDirectory, entry);
			if (safeIsDirectory(fullPath)) {
				collectTaskWatchTargets(worktreePath, fullPath, watchTargetKinds);
			}
		}
		return;
	}

	for (const entry of entries) {
		if (entry === ".tasks") {
			collectTaskWatchTargets(
				worktreePath,
				resolve(currentDirectory, entry),
				watchTargetKinds,
			);
			continue;
		}

		const fullPath = resolve(currentDirectory, entry);
		if (!safeIsDirectory(fullPath) || isIgnoredPackageDirectory(entry)) {
			continue;
		}
		collectTaskWatchTargets(worktreePath, fullPath, watchTargetKinds);
	}
}

function readTaskWatchTargets(worktreePath: string): TaskWatchTarget[] {
	const watchTargetKinds = new Map<string, TaskWatchTarget["kind"]>();
	collectTaskWatchTargets(worktreePath, worktreePath, watchTargetKinds);
	return [...watchTargetKinds.entries()].map(([path, kind]) => ({
		path,
		kind,
	}));
}

function sortProjectTasks(tasks: RpcProjectTask[]): RpcProjectTask[] {
	return [...tasks].sort((left, right) => {
		if (left.kind !== right.kind) {
			return left.kind === "file" ? -1 : 1;
		}
		const titleResult = left.title.localeCompare(right.title);
		if (titleResult !== 0) {
			return titleResult;
		}
		return left.path.localeCompare(right.path);
	});
}

function readProjectTasksFromDisk(worktreePath: string): RpcProjectTask[] {
	return sortProjectTasks([
		...listProjectTaskFiles(tasksDirectoryPath(worktreePath)),
		...listPackageJsonTasks(worktreePath),
	]);
}

function resolveProjectTaskFilePath(
	worktreePath: string,
	taskPath: string,
): string {
	const normalizedTaskPath = normalizeRelativeTaskPath(taskPath);
	if (!normalizedTaskPath) {
		throw new Error("Task path is required.");
	}

	const tasksDirectory = tasksDirectoryPath(worktreePath);
	if (!safeIsDirectory(tasksDirectory)) {
		throw new Error(`No .tasks directory found in ${worktreePath}.`);
	}

	const fullPath = resolve(tasksDirectory, normalizedTaskPath);
	const relativePath = relative(tasksDirectory, fullPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		relativePath.split(/[\\/]/).includes("..")
	) {
		throw new Error(`Task path must stay within ${tasksDirectory}.`);
	}
	if (!safeIsFile(fullPath)) {
		throw new Error(`Task not found: ${normalizedTaskPath}`);
	}

	return fullPath;
}

function resolvePackageJsonTask(
	worktreePath: string,
	task: RpcProjectTask,
): {
	packageJsonPath: string;
	packageDirectory: string;
	scriptName: string;
	command: string;
} {
	const normalizedPackageJsonPath = normalizeRelativeTaskPath(task.path);
	if (!normalizedPackageJsonPath) {
		throw new Error("Package task path is required.");
	}
	if (!task.scriptName?.trim()) {
		throw new Error("Package task script name is required.");
	}

	const packageJsonPath = resolve(worktreePath, normalizedPackageJsonPath);
	const relativePath = relative(worktreePath, packageJsonPath);
	if (
		relativePath === "" ||
		relativePath === ".." ||
		relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
		relativePath.split(/[\\/]/).includes("..")
	) {
		throw new Error(`Package task path must stay within ${worktreePath}.`);
	}
	if (!safeIsFile(packageJsonPath)) {
		throw new Error(`package.json not found: ${normalizedPackageJsonPath}`);
	}

	let parsed: Partial<{ scripts: Record<string, unknown> }>;
	try {
		parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Partial<{
			scripts: Record<string, unknown>;
		}>;
	} catch {
		throw new Error(`Invalid package.json: ${normalizedPackageJsonPath}`);
	}

	const command = parsed.scripts?.[task.scriptName];
	if (typeof command !== "string" || !command.trim()) {
		throw new Error(
			`Script "${task.scriptName}" not found in ${normalizedPackageJsonPath}`,
		);
	}

	const packageDirectory =
		relative(worktreePath, dirname(packageJsonPath)).replace(/\\/g, "/") || ".";
	return {
		packageJsonPath: normalizedPackageJsonPath,
		packageDirectory,
		scriptName: task.scriptName,
		command,
	};
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
	invalidateThreadDetailCache(threadId);
}

function toRpcThread(thread: ThreadRecord): RpcThread {
	return {
		...thread,
		model: normalizeStoredCodexModel(thread.model),
		reasoningEffort: normalizeStoredCodexReasoningEffort(
			thread.reasoningEffort,
		),
		usage: threadUsageFromRecord(thread),
		compaction: threadCompactionFromRecord(thread),
		runStatus: threadRunStatusFromRecord(thread),
	};
}

function threadUsageFromRecord(thread: ThreadRecord): RpcThreadUsage | null {
	if (
		thread.lastInputTokens === null &&
		thread.lastCachedInputTokens === null &&
		thread.lastOutputTokens === null
	) {
		return null;
	}
	return {
		inputTokens: thread.lastInputTokens ?? 0,
		cachedInputTokens: thread.lastCachedInputTokens ?? 0,
		outputTokens: thread.lastOutputTokens ?? 0,
	};
}

function threadCompactionFromRecord(thread: ThreadRecord): RpcThreadCompaction {
	return {
		estimatedTriggerTokens:
			thread.estimatedCompactionTriggerTokens ??
			heuristicCompactionTriggerTokens(thread.model),
		estimatedTriggerSource: thread.estimatedCompactionTriggerTokens
			? "observed"
			: "heuristic",
		maxObservedInputTokens: thread.maxInputTokens,
		inferredCount: thread.compactionCount,
		lastInferredAt: thread.lastCompactionAt,
		lastInferredBeforeInputTokens: thread.lastCompactionBeforeInputTokens,
		lastInferredAfterInputTokens: thread.lastCompactionAfterInputTokens,
	};
}

function buildNextCompactionTelemetry(
	thread: ThreadRecord,
	usage: RpcThreadUsage,
): {
	maxInputTokens: number;
	estimatedCompactionTriggerTokens: number | null;
	compactionCount: number;
	lastCompactionAt: string | null;
	lastCompactionBeforeInputTokens: number | null;
	lastCompactionAfterInputTokens: number | null;
} {
	const previousInputTokens = thread.lastInputTokens;
	const currentInputTokens = usage.inputTokens;
	const contextWindowTokens = contextWindowTokensForModel(thread.model);
	const heuristicTriggerTokens = heuristicCompactionTriggerTokens(thread.model);
	const baselineTriggerTokens =
		thread.estimatedCompactionTriggerTokens ?? heuristicTriggerTokens;
	const maxInputTokens = Math.max(
		thread.maxInputTokens ?? 0,
		currentInputTokens,
	);

	let estimatedCompactionTriggerTokens =
		thread.estimatedCompactionTriggerTokens ?? null;
	let compactionCount = thread.compactionCount;
	let lastCompactionAt = thread.lastCompactionAt;
	let lastCompactionBeforeInputTokens = thread.lastCompactionBeforeInputTokens;
	let lastCompactionAfterInputTokens = thread.lastCompactionAfterInputTokens;

	if (typeof previousInputTokens === "number" && previousInputTokens > 0) {
		const previousNearCompaction =
			previousInputTokens >=
			Math.round(
				Math.min(
					baselineTriggerTokens,
					contextWindowTokens * COMPACTION_INFERENCE_MIN_PREVIOUS_WINDOW_RATIO,
				),
			);
		const currentDroppedSharply =
			currentInputTokens <=
			Math.round(previousInputTokens * COMPACTION_INFERENCE_MAX_CURRENT_RATIO);
		const droppedByMeaningfulWindowShare =
			previousInputTokens - currentInputTokens >=
			Math.round(
				contextWindowTokens * COMPACTION_INFERENCE_MIN_DROP_WINDOW_RATIO,
			);

		if (
			previousNearCompaction &&
			currentDroppedSharply &&
			droppedByMeaningfulWindowShare
		) {
			const nextSample = previousInputTokens;
			const sampleCount = Math.max(compactionCount, 0);
			estimatedCompactionTriggerTokens =
				sampleCount > 0 && estimatedCompactionTriggerTokens
					? Math.round(
							(estimatedCompactionTriggerTokens * sampleCount + nextSample) /
								(sampleCount + 1),
						)
					: nextSample;
			compactionCount += 1;
			lastCompactionAt = getNow();
			lastCompactionBeforeInputTokens = previousInputTokens;
			lastCompactionAfterInputTokens = currentInputTokens;
		}
	}

	return {
		maxInputTokens,
		estimatedCompactionTriggerTokens,
		compactionCount,
		lastCompactionAt,
		lastCompactionBeforeInputTokens,
		lastCompactionAfterInputTokens,
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
		itemId: message.itemId,
		text: message.text,
		state:
			message.state === "in_progress" ||
			message.state === "completed" ||
			message.state === "failed"
				? message.state
				: null,
		createdAt: message.createdAt,
		updatedAt: message.updatedAt,
	};
}

function toRpcThreadMessages(
	messages: ThreadMessageRecord[],
): RpcThreadMessage[] {
	return messages.map(toRpcThreadMessage);
}

function codexThreadOptions(
	worktreePath: string,
	model: string,
	reasoningEffort: RpcCodexReasoningEffort,
) {
	return {
		approvalPolicy: "never" as const,
		model,
		modelReasoningEffort: reasoningEffort,
		networkAccessEnabled: true,
		sandboxMode: "workspace-write" as const,
		workingDirectory: worktreePath,
	};
}

function createManagedCodexThread(thread: ThreadRecord): CodexThread {
	const client = createCodexClient(thread);
	const model = normalizeStoredCodexModel(thread.model);
	const normalizedReasoningEffort = normalizeStoredCodexReasoningEffort(
		thread.reasoningEffort,
	);

	return thread.codexThreadId
		? client.resumeThread(
				thread.codexThreadId,
				codexThreadOptions(
					thread.worktreePath,
					model,
					normalizedReasoningEffort,
				),
			)
		: client.startThread(
				codexThreadOptions(
					thread.worktreePath,
					model,
					normalizedReasoningEffort,
				),
			);
}

async function ensureCodexThread(thread: ThreadRecord): Promise<CodexThread> {
	const active = codexThreadMap.get(thread.id);
	if (active) {
		return active;
	}

	const next = createManagedCodexThread(thread);
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

async function readThreadDetailCached(
	threadId: number,
): Promise<RpcThreadDetail> {
	const cached = readLruValue(threadDetailCache, threadId);
	if (cached) {
		return cached;
	}

	const detail = await buildThreadDetail(threadId);
	writeLruValue(
		threadDetailCache,
		threadId,
		detail,
		THREAD_DETAIL_CACHE_MAX_ENTRIES,
	);
	return detail;
}

function warmThreadDetailCache(threadId: number): void {
	void readThreadDetailCached(threadId).catch((error) => {
		console.error(`Failed to warm thread detail cache for ${threadId}`, error);
	});
}

async function settleCanceledThreadTurn(
	threadId: number,
	startedAt: string,
	lastAssistantItemId: string | null,
	lastAssistantText: string,
): Promise<void> {
	if (lastAssistantItemId && lastAssistantText.trim()) {
		await upsertAssistantChatActivity(
			threadId,
			lastAssistantItemId,
			lastAssistantText.trim(),
			"completed",
		);
	}
	settleInProgressThreadMessages(db, threadId);
	invalidateThreadDetailCache(threadId);
	markThreadRan(db, threadId);
	setThreadRunStatus(threadId, {
		state: "idle",
		startedAt,
		updatedAt: getNow(),
		error: null,
		hasUnreadError: false,
	});
}

async function runThreadMessageInBackground(
	threadId: number,
	input: string,
	startedAt: string,
	controller: AbortController,
): Promise<void> {
	let lastAssistantText = "";
	let lastAssistantItemId: string | null = null;
	let terminalError: string | null = null;
	let usage: RpcThreadUsage | null = null;

	try {
		const thread = threadById(threadId);
		const codexThread = await ensureCodexThread(thread);
		const { events } = await codexThread.runStreamed(input, {
			signal: controller.signal,
		});

		for await (const event of events) {
			if (event.type === "thread.started") {
				if (event.thread_id && event.thread_id !== thread.codexThreadId) {
					updateThreadCodexId(db, thread.id, event.thread_id);
					invalidateThreadDetailCache(thread.id);
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

			if (event.type === "turn.completed") {
				usage = {
					inputTokens: event.usage.input_tokens,
					cachedInputTokens: event.usage.cached_input_tokens,
					outputTokens: event.usage.output_tokens,
				};
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
				const nextAssistantText = item.text.trim();
				if (nextAssistantText) {
					lastAssistantText = nextAssistantText;
					lastAssistantItemId = item.id;
				}
				if (nextAssistantText) {
					await upsertAssistantChatActivity(
						threadId,
						item.id,
						nextAssistantText,
						event.type === "item.completed" ? "completed" : "in_progress",
					);
				}
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

		const finalAssistantText =
			lastAssistantText.trim() || "No response returned.";
		if (codexThread.id && codexThread.id !== thread.codexThreadId) {
			updateThreadCodexId(db, thread.id, codexThread.id);
			invalidateThreadDetailCache(thread.id);
		}
		if (lastAssistantItemId && lastAssistantText.trim()) {
			await upsertAssistantChatActivity(
				threadId,
				lastAssistantItemId,
				finalAssistantText,
				"completed",
			);
		} else {
			createThreadMessage(db, {
				threadId,
				role: "assistant",
				text: finalAssistantText,
			});
			invalidateThreadDetailCache(threadId);
		}
		if (usage) {
			setThreadUsage(
				db,
				threadId,
				usage,
				buildNextCompactionTelemetry(threadById(threadId), usage),
			);
			invalidateThreadDetailCache(threadId);
		}
		markThreadRan(db, threadId);
		setThreadRunStatus(threadId, {
			state: "idle",
			startedAt,
			updatedAt: getNow(),
			error: null,
			hasUnreadError: false,
		});
	} catch (error) {
		if (isAbortError(error) && controller.signal.aborted) {
			await settleCanceledThreadTurn(
				threadId,
				startedAt,
				lastAssistantItemId,
				lastAssistantText,
			);
			return;
		}

		const message = error instanceof Error ? error.message : String(error);
		if (lastAssistantItemId && lastAssistantText.trim()) {
			await upsertAssistantChatActivity(
				threadId,
				lastAssistantItemId,
				lastAssistantText,
				"failed",
			);
		}
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
	} finally {
		if (threadTurnAbortControllerMap.get(threadId) === controller) {
			threadTurnAbortControllerMap.delete(threadId);
		}
		threadTurnCompletionMap.delete(threadId);
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
	options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree[]> {
	const { signal } = normalizeGitCommandOptions(options);
	throwIfAborted(signal, "Project worktree read was aborted.");

	if (typeof projectId === "number") {
		const state = projectPollMap.get(projectId);
		if (state && state.worktreesLoadedAt > 0 && !options?.forceRefresh) {
			if (
				Date.now() - state.worktreesLoadedAt >
				PROJECT_WORKTREE_CACHE_STALE_MS
			) {
				void refreshProjectPoll(projectId, {
					priority: "background",
				}).catch((error) => {
					logBackgroundGitFailure(
						`Worktree refresh failed for project ${projectId}`,
						error,
					);
				});
			}
			return state.worktrees;
		}
	}

	const worktrees = await listFreshProjectWorktrees(
		projectPath,
		projectId,
		options,
	);
	if (typeof projectId === "number") {
		const state = projectPollMap.get(projectId);
		if (state) {
			state.worktrees = worktrees;
			state.worktreesLoadedAt = Date.now();
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
		const directories = readDirectorySuggestionEntries(searchDirectory)
			.filter((entry) => {
				if (
					normalizedPrefix &&
					!entry.toLocaleLowerCase().startsWith(normalizedPrefix)
				) {
					return false;
				}
				return true;
			})
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

function removeGitCommandTask(
	queue: {
		backgroundTasks: GitCommandQueueTask[];
		foregroundTasks: GitCommandQueueTask[];
	},
	task: GitCommandQueueTask,
): void {
	const foregroundIndex = queue.foregroundTasks.indexOf(task);
	if (foregroundIndex >= 0) {
		queue.foregroundTasks.splice(foregroundIndex, 1);
		return;
	}

	const backgroundIndex = queue.backgroundTasks.indexOf(task);
	if (backgroundIndex >= 0) {
		queue.backgroundTasks.splice(backgroundIndex, 1);
	}
}

function logBackgroundGitFailure(message: string, error: unknown): void {
	if (isAbortError(error)) {
		return;
	}

	console.error(message, error);
}

function scheduleGitCommandQueue(cwd: string): void {
	const queue = gitCommandQueueMap.get(cwd);
	if (!queue || queue.active) {
		return;
	}

	let nextTask =
		queue.foregroundTasks.shift() ?? queue.backgroundTasks.shift() ?? null;
	while (nextTask?.signal?.aborted) {
		nextTask.detachAbortListener();
		nextTask.reject(
			createAbortError(nextTask.signal.reason, "Git command was aborted."),
		);
		nextTask =
			queue.foregroundTasks.shift() ?? queue.backgroundTasks.shift() ?? null;
	}
	if (!nextTask) {
		gitCommandQueueMap.delete(cwd);
		return;
	}

	queue.active = true;
	queue.activeTask = nextTask;
	nextTask.run();
}

function enqueueGitCommand<T>(
	cwd: string,
	priority: GitCommandPriority,
	signal: AbortSignal | null,
	run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
	const queue = gitCommandQueueMap.get(cwd) ?? {
		active: false,
		activeTask: null,
		backgroundTasks: [],
		foregroundTasks: [],
	};
	gitCommandQueueMap.set(cwd, queue);

	return new Promise<T>((resolve, reject) => {
		const taskAbortController = new AbortController();
		const taskSignal = signal
			? AbortSignal.any([signal, taskAbortController.signal])
			: taskAbortController.signal;
		let settled = false;
		const finalize = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			task.detachAbortListener();
			callback();
		};

		const task: GitCommandQueueTask = {
			abort: (reason) => {
				taskAbortController.abort(createAbortError(null, reason));
			},
			detachAbortListener: () => {},
			priority,
			reject: (reason) =>
				finalize(() => {
					reject(reason);
				}),
			run: () => {
				task.started = true;
				void Promise.resolve()
					.then(() => {
						throwIfAborted(task.signal, "Git command was aborted.");
						return run(task.signal);
					})
					.then(
						(value) => {
							finalize(() => {
								resolve(value);
							});
						},
						(error) => {
							finalize(() => {
								reject(error);
							});
						},
					)
					.finally(() => {
						if (queue.activeTask === task) {
							queue.activeTask = null;
						}
						queue.active = false;
						scheduleGitCommandQueue(cwd);
					});
			},
			signal: taskSignal,
			started: false,
		};

		if (task.signal) {
			const handleAbort = () => {
				if (task.started) {
					return;
				}
				removeGitCommandTask(queue, task);
				finalize(() => {
					reject(
						createAbortError(task.signal.reason, "Git command was aborted."),
					);
				});
			};
			task.signal.addEventListener("abort", handleAbort, {
				once: true,
			});
			task.detachAbortListener = () => {
				task.signal.removeEventListener("abort", handleAbort);
			};
		}

		if (task.signal.aborted) {
			finalize(() => {
				reject(
					createAbortError(task.signal.reason, "Git command was aborted."),
				);
			});
			return;
		}

		if (priority === "foreground") {
			queue.foregroundTasks.push(task);
		} else {
			queue.backgroundTasks.push(task);
		}
		if (
			priority === "foreground" &&
			queue.activeTask &&
			queue.activeTask.priority === "background"
		) {
			queue.activeTask.abort(
				`Foreground git command preempted background work for ${cwd}.`,
			);
		}
		scheduleGitCommandQueue(cwd);
	});
}

async function runGitCommand(
	cwd: string,
	args: string[],
	options?: GitCommandPriority | GitCommandOptions,
): Promise<string> {
	const { exitCode, stderr, stdout } = await runGitCommandResult(
		cwd,
		args,
		options,
	);
	if (exitCode !== 0) {
		throw new Error(stderr || `git command failed with exit code ${exitCode}`);
	}
	return stdout.trimEnd();
}

async function runGitCommandResult(
	cwd: string,
	args: string[],
	options?: GitCommandPriority | GitCommandOptions,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const { priority, signal } = normalizeGitCommandOptions(options);
	return enqueueGitCommand(cwd, priority, signal, async (taskSignal) => {
		throwIfAborted(signal, "Git command was aborted.");
		throwIfAborted(taskSignal, "Git command was aborted.");
		const proc = Bun.spawn({
			cmd: ["git", ...args],
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			signal: taskSignal,
		});

		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		throwIfAborted(signal, "Git command was aborted.");
		throwIfAborted(taskSignal, "Git command was aborted.");

		return {
			exitCode,
			stderr: stderr.trim(),
			stdout,
		};
	});
}

function gitCommandFailureMessage(result: {
	exitCode: number;
	stderr: string;
}): string {
	return (
		result.stderr || `git command failed with exit code ${result.exitCode}`
	);
}

function isNoHeadGitHistoryFailure(result: {
	exitCode: number;
	stderr: string;
}): boolean {
	if (result.exitCode === 0) {
		return false;
	}

	const normalizedError = result.stderr.toLowerCase();
	return (
		(normalizedError.includes("ambiguous argument 'head'") &&
			normalizedError.includes("unknown revision or path")) ||
		normalizedError.includes("bad revision 'head'") ||
		normalizedError.includes("bad default revision 'head'") ||
		normalizedError.includes("does not have any commits yet")
	);
}

async function runGitHistoryCommand(
	cwd: string,
	args: string[],
	options?: GitCommandPriority | GitCommandOptions,
): Promise<string | null> {
	const result = await runGitCommandResult(cwd, args, options);
	if (result.exitCode === 0) {
		return result.stdout.trimEnd();
	}
	if (isNoHeadGitHistoryFailure(result)) {
		return null;
	}
	throw new Error(gitCommandFailureMessage(result));
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
	invalidateThreadDetailCache(threadId);
}

async function upsertAssistantChatActivity(
	threadId: number,
	itemId: string,
	text: string,
	state: "in_progress" | "completed" | "failed",
): Promise<void> {
	upsertThreadActivity(db, {
		threadId,
		itemId,
		kind: "chat",
		role: "assistant",
		text,
		state,
	});
	invalidateThreadDetailCache(threadId);
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
	invalidateThreadDetailCache(threadId);
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
	invalidateThreadDetailCache(threadId);
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
				pinnedAt: null,
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
	options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcWorktree[]> {
	const porcelain = await runGitCommand(
		projectPath,
		["worktree", "list", "--porcelain"],
		options,
	);
	return parseWorktreeList(porcelain).map((worktree) => ({
		...worktree,
		path: normalizeWorktreePath(projectPath, worktree.path),
	}));
}

function mergeProjectWorktreePins(
	projectId: number,
	worktrees: RpcWorktree[],
): RpcWorktree[] {
	const pinnedAtByPath = new Map(
		listProjectWorktreePins(db, projectId).map((record) => [
			record.worktreePath,
			record.pinnedAt,
		]),
	);

	return worktrees.map((worktree) => ({
		...worktree,
		pinnedAt: pinnedAtByPath.get(worktree.path) ?? null,
	}));
}

async function listFreshProjectWorktrees(
	projectPath: string,
	projectId?: number,
	options?: GitCommandOptions,
): Promise<RpcWorktree[]> {
	const worktrees = await listWorktreesForProjectPath(projectPath, options);
	if (typeof projectId !== "number") {
		return worktrees;
	}
	return mergeProjectWorktreePins(projectId, worktrees);
}

async function readDiff(
	worktreePath: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<string[]> {
	const raw = await runGitCommand(
		worktreePath,
		["diff", "--name-status"],
		options,
	);
	if (!raw.trim()) return [];
	return raw.split(/\r?\n/).filter(Boolean);
}

async function readFiles(
	worktreePath: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<string[]> {
	const raw = await runGitCommand(worktreePath, ["status", "--short"], options);
	if (!raw.trim()) return [];
	return raw.split(/\r?\n/).filter(Boolean);
}

async function readWorktreeSnapshot(
	worktreePath: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<Omit<RpcWorktreeSnapshot, "path">> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	const controller = new AbortController();
	const signal = normalizedOptions.signal
		? AbortSignal.any([normalizedOptions.signal, controller.signal])
		: controller.signal;
	const snapshotOptions: GitCommandOptions = {
		priority: normalizedOptions.priority,
		signal,
	};

	const [diff, files] = await Promise.all([
		readDiff(worktreePath, snapshotOptions),
		readFiles(worktreePath, snapshotOptions),
	]).catch((error) => {
		controller.abort(createAbortError(null, "Worktree snapshot read failed."));
		throw error;
	});

	return {
		diff,
		files,
		lastUpdatedAt: getNow(),
	};
}

type DecoratedGitHistoryEntry = RpcGitHistoryEntry & {
	decoration: string;
};

function emptyGitHistorySummary(
	projectId: number,
	worktreePath: string,
	options?: {
		branch?: string | null;
		headHash?: string | null;
		headShortHash?: string | null;
		lastUpdatedAt?: string;
	},
): RpcWorktreeGitHistorySummary {
	return {
		projectId,
		worktreePath,
		branch: options?.branch ?? null,
		headHash: options?.headHash ?? null,
		headShortHash: options?.headShortHash ?? null,
		lastUpdatedAt: options?.lastUpdatedAt ?? getNow(),
	};
}

function parseGitHistoryEntryRecord(record: string): RpcGitHistoryEntry | null {
	const [hash, shortHash, subject, authorName, committedAt] = record.split(
		GIT_LOG_FIELD_SEPARATOR,
	);
	if (!hash || !shortHash) {
		return null;
	}

	return {
		hash,
		shortHash,
		subject: subject || shortHash,
		authorName: authorName || "Unknown",
		committedAt: committedAt || getNow(),
	};
}

function parseGitHistoryEntries(raw: string): RpcGitHistoryEntry[] {
	if (!raw) {
		return [];
	}

	return raw
		.split(GIT_LOG_RECORD_SEPARATOR)
		.map((record) => record.trim())
		.filter(Boolean)
		.map(parseGitHistoryEntryRecord)
		.filter((entry): entry is RpcGitHistoryEntry => entry !== null);
}

function parseDecoratedGitHistoryEntryRecord(
	record: string,
): DecoratedGitHistoryEntry | null {
	const [hash, shortHash, subject, authorName, committedAt, decoration] =
		record.split(GIT_LOG_FIELD_SEPARATOR);
	if (!hash || !shortHash) {
		return null;
	}

	return {
		hash,
		shortHash,
		subject: subject || shortHash,
		authorName: authorName || "Unknown",
		committedAt: committedAt || getNow(),
		decoration: decoration || "",
	};
}

function parseDecoratedGitHistoryEntries(
	raw: string,
): DecoratedGitHistoryEntry[] {
	if (!raw) {
		return [];
	}

	return raw
		.split(GIT_LOG_RECORD_SEPARATOR)
		.map((record) => record.trim())
		.filter(Boolean)
		.map(parseDecoratedGitHistoryEntryRecord)
		.filter((entry): entry is DecoratedGitHistoryEntry => entry !== null);
}

function parseGitBranchFromDecoration(decoration: string): string | null {
	for (const token of decoration.split(",")) {
		const trimmedToken = token.trim();
		if (!trimmedToken.startsWith("HEAD -> ")) {
			continue;
		}

		const branch = trimmedToken.replace("HEAD -> ", "").trim();
		return branch || null;
	}

	return null;
}

function buildGitHistorySignature(
	branch: string | null,
	headHash: string | null,
): string {
	return [branch ?? "", headHash ?? ""].join("\n");
}

function normalizeGitHistoryPageLimit(limit?: number): number {
	if (typeof limit !== "number" || !Number.isInteger(limit)) {
		return DEFAULT_GIT_HISTORY_PAGE_SIZE;
	}
	return Math.min(Math.max(limit, 1), DEFAULT_GIT_HISTORY_PAGE_SIZE);
}

async function readGitHistorySummary(
	projectId: number,
	worktreePath: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<{
	history: RpcWorktreeGitHistorySummary;
	signature: string;
}> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	const lastUpdatedAt = getNow();
	const rawHead = await runGitHistoryCommand(
		worktreePath,
		[
			"show",
			"--no-patch",
			"--decorate=short",
			"--pretty=format:%H%x1f%h%x1f%D",
			"HEAD",
		],
		normalizedOptions,
	);

	if (rawHead === null) {
		const branchResult = await runGitCommandResult(
			worktreePath,
			["symbolic-ref", "--quiet", "--short", "HEAD"],
			normalizedOptions,
		);
		if (
			branchResult.exitCode !== 0 &&
			!(branchResult.exitCode === 1 && !branchResult.stderr)
		) {
			throw new Error(gitCommandFailureMessage(branchResult));
		}
		const branch =
			branchResult.exitCode === 0
				? branchResult.stdout.trimEnd() || null
				: null;
		const history = emptyGitHistorySummary(projectId, worktreePath, {
			branch,
			lastUpdatedAt,
		});
		return {
			history,
			signature: buildGitHistorySignature(history.branch, history.headHash),
		};
	}

	const [headHash, headShortHash, decoration] = rawHead.split(
		GIT_LOG_FIELD_SEPARATOR,
	);
	const history = emptyGitHistorySummary(projectId, worktreePath, {
		branch: parseGitBranchFromDecoration(decoration || ""),
		headHash: headHash || null,
		headShortHash: headShortHash || headHash?.slice(0, 7) || null,
		lastUpdatedAt,
	});

	return {
		history,
		signature: buildGitHistorySignature(history.branch, history.headHash),
	};
}

async function readGitHistoryPageEntries(
	worktreePath: string,
	offset: number,
	limit: number,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<{
	entries: RpcGitHistoryEntry[];
	nextOffset: number | null;
}> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	const rawEntries = await runGitHistoryCommand(
		worktreePath,
		[
			"log",
			`--skip=${offset}`,
			`--max-count=${limit + 1}`,
			"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1e",
			"HEAD",
		],
		normalizedOptions,
	);
	if (rawEntries === null) {
		return {
			entries: [],
			nextOffset: null,
		};
	}
	const parsedEntries = parseGitHistoryEntries(rawEntries);
	const hasMore = parsedEntries.length > limit;

	return {
		entries: hasMore ? parsedEntries.slice(0, limit) : parsedEntries,
		nextOffset: hasMore ? offset + limit : null,
	};
}

async function readGitHistoryFirstPage(
	projectId: number,
	worktreePath: string,
	limit: number,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<{
	history: RpcWorktreeGitHistoryResult;
	summary: RpcWorktreeGitHistorySummary;
	signature: string;
}> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	const lastUpdatedAt = getNow();
	const rawEntries = await runGitHistoryCommand(
		worktreePath,
		[
			"log",
			"--decorate=short",
			`--max-count=${limit + 1}`,
			"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1f%D%x1e",
			"HEAD",
		],
		normalizedOptions,
	);
	if (rawEntries === null) {
		const { history: summary, signature } = await readGitHistorySummary(
			projectId,
			worktreePath,
			normalizedOptions,
		);
		return {
			history: {
				...summary,
				entries: [],
				limit,
				nextOffset: null,
			},
			summary,
			signature,
		};
	}
	const parsedEntries = parseDecoratedGitHistoryEntries(rawEntries);

	const firstEntry = parsedEntries[0];
	if (!firstEntry) {
		throw new Error(
			"Expected a first git history entry when history is not empty.",
		);
	}
	const hasMore = parsedEntries.length > limit;
	const trimmedEntries = hasMore
		? parsedEntries.slice(0, limit)
		: parsedEntries;
	const summary = emptyGitHistorySummary(projectId, worktreePath, {
		branch: parseGitBranchFromDecoration(firstEntry.decoration),
		headHash: firstEntry.hash,
		headShortHash: firstEntry.shortHash,
		lastUpdatedAt,
	});
	const entries = trimmedEntries.map(
		({ decoration: _decoration, ...entry }) => ({
			...entry,
		}),
	);

	return {
		history: {
			...summary,
			entries,
			limit,
			nextOffset: hasMore ? limit : null,
		},
		summary,
		signature: buildGitHistorySignature(summary.branch, summary.headHash),
	};
}

function applyGitHistoryCachePage(
	worktreeState: WorktreePollState,
	offset: number,
	page: {
		entries: RpcGitHistoryEntry[];
		nextOffset: number | null;
	},
): void {
	const prefix = worktreeState.historyEntries.slice(0, offset);
	worktreeState.historyEntries = [...prefix, ...page.entries];
	worktreeState.historyNextOffset = page.nextOffset;
}

function hasGitHistoryCacheRange(
	worktreeState: WorktreePollState,
	offset: number,
	limit: number,
): boolean {
	if (worktreeState.historyEntries.length >= offset + limit) {
		return true;
	}

	return (
		worktreeState.historyNextOffset === null &&
		worktreeState.historyEntries.length >= offset
	);
}

function buildGitHistoryResultFromCache(
	worktreeState: WorktreePollState,
	limit: number,
	offset: number,
): RpcWorktreeGitHistoryResult {
	const endOffset = Math.min(
		offset + limit,
		worktreeState.historyEntries.length,
	);

	return {
		...worktreeState.history,
		entries: worktreeState.historyEntries.slice(offset, endOffset),
		limit,
		nextOffset:
			endOffset < worktreeState.historyEntries.length
				? endOffset
				: worktreeState.historyNextOffset,
	};
}

function abortGitHistoryPrefetch(
	worktreeState: WorktreePollState,
	reason: string,
): void {
	const prefetch = worktreeState.historyPrefetch;
	if (!prefetch) {
		return;
	}

	if (worktreeState.historyPrefetch === prefetch) {
		worktreeState.historyPrefetch = null;
	}
	prefetch.controller.abort(createAbortError(null, reason));
}

async function fillGitHistoryCache(
	worktreeState: WorktreePollState,
	worktreePath: string,
	offset: number,
	limit: number,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<void> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	while (
		!hasGitHistoryCacheRange(worktreeState, offset, limit) &&
		worktreeState.historyNextOffset !== null
	) {
		throwIfAborted(
			normalizedOptions.signal,
			"Git history cache fill was aborted.",
		);
		const currentPrefetch = worktreeState.historyPrefetch;
		if (
			currentPrefetch &&
			normalizedOptions.priority === "foreground" &&
			currentPrefetch.priority === "background"
		) {
			abortGitHistoryPrefetch(
				worktreeState,
				`Foreground git history request replaced background warming for ${worktreePath}.`,
			);
			continue;
		}
		if (currentPrefetch) {
			await awaitAbortableResult(
				currentPrefetch.promise,
				normalizedOptions.signal,
				"Git history cache fill was aborted.",
			);
			continue;
		}

		const expectedSignature = worktreeState.historySignature;
		const fetchOffset = worktreeState.historyEntries.length;
		const fetchLimit = Math.max(
			GIT_HISTORY_PREFETCH_CHUNK_SIZE,
			offset + limit - fetchOffset,
		);
		const controller = new AbortController();
		const prefetch: PendingGitHistoryPrefetch = {
			controller,
			priority: normalizedOptions.priority,
			promise: Promise.resolve(),
		};
		const promise = (async () => {
			try {
				const page = await readGitHistoryPageEntries(
					worktreePath,
					fetchOffset,
					fetchLimit,
					{
						priority: normalizedOptions.priority,
						signal: controller.signal,
					},
				);
				if (
					worktreeState.historySignature !== expectedSignature ||
					worktreeState.historyEntries.length !== fetchOffset
				) {
					return;
				}
				applyGitHistoryCachePage(worktreeState, fetchOffset, page);
			} finally {
				if (worktreeState.historyPrefetch === prefetch) {
					worktreeState.historyPrefetch = null;
				}
			}
		})();
		prefetch.promise = promise;
		worktreeState.historyPrefetch = prefetch;
		await awaitAbortableResult(
			promise,
			normalizedOptions.signal,
			"Git history cache fill was aborted.",
		);
	}
}

function warmGitHistoryCache(
	worktreeState: WorktreePollState,
	worktreePath: string,
): void {
	if (
		worktreeState.historyNextOffset === null ||
		worktreeState.historyPrefetch
	) {
		return;
	}

	void fillGitHistoryCache(
		worktreeState,
		worktreePath,
		worktreeState.historyEntries.length,
		DEFAULT_GIT_HISTORY_PAGE_SIZE + 1,
		"background",
	).catch((error) => {
		logBackgroundGitFailure(
			`Git history prefetch failed for ${worktreePath}`,
			error,
		);
	});
}

async function readGitCommitDiffResult(
	projectId: number,
	worktreePath: string,
	commitHash: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcGitCommitDiffResult> {
	const raw = await runGitCommand(
		worktreePath,
		[
			"show",
			"--no-ext-diff",
			"--find-renames",
			"--submodule=diff",
			"--unified=3",
			`--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI${GIT_LOG_RECORD_SEPARATOR}`,
			commitHash,
		],
		options,
	);
	const separatorIndex = raw.indexOf(GIT_LOG_RECORD_SEPARATOR);
	if (separatorIndex < 0) {
		throw new Error(`Unable to read commit diff: ${commitHash}`);
	}

	const metadataRaw = raw.slice(0, separatorIndex);
	const diffText = raw.slice(separatorIndex + GIT_LOG_RECORD_SEPARATOR.length);
	const commit = parseGitHistoryEntryRecord(metadataRaw);
	if (!commit) {
		throw new Error(`Unable to read commit metadata: ${commitHash}`);
	}

	return {
		projectId,
		worktreePath,
		commit,
		diffText: diffText.replace(/^\r?\n/, ""),
	};
}

function gitCommitDiffCacheKey(
	worktreePath: string,
	commitHash: string,
): string {
	return `${worktreePath}\n${commitHash}`;
}

function findKnownProjectWorktree(
	projectId: number,
	worktreePath: string,
): RpcWorktree | null {
	const state = projectPollMap.get(projectId);
	if (!state?.worktrees.length) {
		return null;
	}
	return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

async function getCachedGitCommitDiffResult(
	projectId: number,
	worktreePath: string,
	commitHash: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<RpcGitCommitDiffResult> {
	const normalizedOptions = normalizeGitCommandOptions(options);
	const cacheKey = gitCommitDiffCacheKey(worktreePath, commitHash);
	const cached = readLruValue(gitCommitDiffCache, cacheKey);
	if (cached) {
		return cached;
	}

	const pending = gitCommitDiffRequestCache.get(cacheKey);
	if (pending) {
		return awaitAbortableResult(
			pending.promise,
			normalizedOptions.signal,
			"Commit diff read was aborted.",
		);
	}

	const pendingRequest: PendingGitCommitDiffRequest = {
		promise: Promise.resolve(null as never),
	};
	const promise = readGitCommitDiffResult(projectId, worktreePath, commitHash, {
		priority: normalizedOptions.priority,
	})
		.then((result) => {
			writeLruValue(
				gitCommitDiffCache,
				cacheKey,
				result,
				GIT_COMMIT_DIFF_CACHE_MAX_ENTRIES,
			);
			return result;
		})
		.finally(() => {
			if (gitCommitDiffRequestCache.get(cacheKey) === pendingRequest) {
				gitCommitDiffRequestCache.delete(cacheKey);
			}
		});
	pendingRequest.promise = promise;
	gitCommitDiffRequestCache.set(cacheKey, pendingRequest);

	return awaitAbortableResult(
		promise,
		normalizedOptions.signal,
		"Commit diff read was aborted.",
	);
}

function getNow(): string {
	return new Date().toISOString();
}

async function refreshProjectPoll(
	projectId: number,
	options?: GitCommandOptions,
): Promise<void> {
	const state = projectPollMap.get(projectId);
	if (!state) return;

	const worktrees = await listFreshProjectWorktrees(
		state.projectPath,
		state.id,
		options,
	);
	state.worktrees = worktrees;
	state.worktreesLoadedAt = Date.now();

	const activeWorktrees = new Set(worktrees.map((w) => w.path));
	for (const [wtPath] of state.openWorktrees) {
		if (!activeWorktrees.has(wtPath)) {
			stopWorktreePolling(state, wtPath);
		}
	}
	if (
		state.activeWorktreePath !== null &&
		!activeWorktrees.has(state.activeWorktreePath)
	) {
		state.activeWorktreePath = null;
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
			worktreesLoadedAt: 0,
			activeWorktreePath: null,
			projectTimer: null,
			openWorktrees: new Map(),
		};
		projectPollMap.set(project.id, state);
	}

	state.project = project;
	state.projectPath = project.path;

	if (!state.projectTimer) {
		state.projectTimer = setInterval(() => {
			refreshProjectPoll(project.id, {
				priority: "background",
			}).catch((error) => {
				logBackgroundGitFailure(
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

	stopWorktreeBackgroundPolling(
		active,
		`Stopped worktree polling for ${worktreePath}.`,
	);
	closeTaskWatchers(active);
	state.openWorktrees.delete(worktreePath);
}

function createWorktreePollState(
	projectId: number,
	worktreePath: string,
): WorktreePollState {
	return {
		diff: [],
		files: [],
		history: emptyGitHistorySummary(projectId, worktreePath),
		historyEntries: [],
		historyNextOffset: null,
		historyPolling: false,
		historyPrefetch: null,
		historySignature: null,
		historyTimer: null,
		tasks: null,
		taskWatchTargets: [],
		taskWatchers: [],
		lastUpdatedAt: getNow(),
	};
}

function ensureWorktreePollState(
	state: ProjectPollState,
	worktreePath: string,
): WorktreePollState {
	const existing = state.openWorktrees.get(worktreePath);
	if (existing) {
		return existing;
	}

	const worktreeState = createWorktreePollState(state.id, worktreePath);
	state.openWorktrees.set(worktreePath, worktreeState);
	return worktreeState;
}

function closeTaskWatchers(worktreeState: WorktreePollState): void {
	for (const watcher of worktreeState.taskWatchers) {
		try {
			watcher.close();
		} catch {
			// Ignore watcher shutdown failures during task watcher cleanup.
		}
	}
	worktreeState.taskWatchers = [];
}

function stopWorktreeBackgroundPolling(
	worktreeState: WorktreePollState,
	reason: string,
): void {
	if (worktreeState.historyTimer) {
		clearInterval(worktreeState.historyTimer);
		worktreeState.historyTimer = null;
	}
	abortGitHistoryPrefetch(worktreeState, reason);
}

function startWorktreeTaskPolling(
	state: ProjectPollState,
	worktreePath: string,
): WorktreePollState {
	const worktreeState = ensureWorktreePollState(state, worktreePath);
	if (worktreeState.taskWatchers.length > 0) {
		return worktreeState;
	}

	const invalidateTaskState = () => {
		if (
			worktreeState.tasks === null &&
			worktreeState.taskWatchTargets.length === 0
		) {
			return;
		}

		closeTaskWatchers(worktreeState);
		worktreeState.taskWatchTargets = [];
		worktreeState.tasks = null;
		worktreeState.lastUpdatedAt = getNow();
		worktreeTaskChangeListener?.(state.id, worktreePath);
	};

	for (const target of worktreeState.taskWatchTargets) {
		if (!safeIsDirectory(target.path)) {
			continue;
		}

		try {
			const watcher = watch(target.path, (eventType, filename) => {
				const watchedName = filename ? String(filename) : "";
				if (target.kind === "tasks") {
					if (watchedName.startsWith(".")) {
						return;
					}
					invalidateTaskState();
					return;
				}

				if (
					eventType === "rename" ||
					watchedName === "package.json" ||
					watchedName === ".tasks" ||
					!watchedName
				) {
					invalidateTaskState();
				}
			});
			watcher.on("error", (error) => {
				console.error(`Task watcher failed for ${target.path}`, error);
				invalidateTaskState();
			});
			worktreeState.taskWatchers.push(watcher);
		} catch (error) {
			console.error(`Failed to watch task inputs in ${target.path}`, error);
		}
	}

	return worktreeState;
}

function startWorktreeGitHistoryPolling(
	state: ProjectPollState,
	worktreePath: string,
): WorktreePollState {
	const worktreeState = ensureWorktreePollState(state, worktreePath);
	if (worktreeState.historyTimer) {
		return worktreeState;
	}

	const pollGitHistory = async () => {
		if (worktreeState.historyPolling) {
			return;
		}
		worktreeState.historyPolling = true;
		try {
			const previousSignature = worktreeState.historySignature;
			const { history, signature } = await readGitHistorySummary(
				state.id,
				worktreePath,
				"background",
			);
			worktreeState.history = history;
			if (previousSignature !== null && previousSignature !== signature) {
				worktreeState.historyEntries = [];
				worktreeState.historyNextOffset = null;
				abortGitHistoryPrefetch(
					worktreeState,
					`Git history signature changed for ${worktreePath}.`,
				);
			}
			worktreeState.historySignature = signature;
			worktreeState.lastUpdatedAt = history.lastUpdatedAt;

			if (previousSignature !== null && previousSignature !== signature) {
				worktreeGitHistoryChangeListener?.(state.id, worktreePath);
			}
		} catch (error) {
			logBackgroundGitFailure(
				`Git history poll failed for ${worktreePath}`,
				error,
			);
		} finally {
			worktreeState.historyPolling = false;
		}
	};

	worktreeState.historyTimer = setInterval(() => {
		void pollGitHistory();
	}, GIT_HISTORY_POLL_INTERVAL_MS);

	void pollGitHistory();

	return worktreeState;
}

function syncProjectWorktreeBackgroundPolling(state: ProjectPollState): void {
	for (const [worktreePath, worktreeState] of state.openWorktrees) {
		if (state.activeWorktreePath === worktreePath) {
			startWorktreeGitHistoryPolling(state, worktreePath);
			continue;
		}

		stopWorktreeBackgroundPolling(
			worktreeState,
			`Worktree ${worktreePath} is no longer the active view.`,
		);
	}
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
	options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree | null> {
	const worktrees = await readProjectWorktrees(
		project.path,
		project.id,
		options,
	);
	return worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

async function assertProjectWorktree(
	project: ProjectRecord,
	worktreePath: string,
	options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree> {
	const worktree = await findProjectWorktree(project, worktreePath, options);
	if (!worktree) {
		throw new Error(
			`Worktree not found for project ${project.path}: ${worktreePath}`,
		);
	}
	return worktree;
}

function trackedProjectWorktree(
	state: ProjectPollState,
	worktreePath: string,
): RpcWorktree | null {
	return state.worktrees.find((entry) => entry.path === worktreePath) ?? null;
}

async function ensureTrackedProjectWorktree(
	project: ProjectRecord,
	state: ProjectPollState,
	worktreePath: string,
	options?: ProjectWorktreeReadOptions,
): Promise<RpcWorktree> {
	const known = trackedProjectWorktree(state, worktreePath);
	if (known && !options?.forceRefresh) {
		return known;
	}

	await refreshProjectPoll(project.id, options);
	const refreshed = trackedProjectWorktree(state, worktreePath);
	if (refreshed) {
		return refreshed;
	}

	throw new Error(
		`Worktree not found for project ${project.path}: ${worktreePath}`,
	);
}

async function createThreadRecord(
	project: ProjectRecord,
	worktreePath: string,
	model: string,
	reasoningEffort: RpcCodexReasoningEffort,
	options?: ProjectWorktreeReadOptions,
): Promise<ThreadRecord> {
	const worktree = await assertProjectWorktree(project, worktreePath, {
		...options,
		forceRefresh: true,
	});

	const thread = createThread(db, {
		projectId: project.id,
		worktreePath,
		title: buildThreadTitle(worktree, worktreePath),
		model,
		reasoningEffort,
		codexThreadId: null,
	});
	try {
		const codexThread = createManagedCodexThread(thread);
		codexThreadMap.set(thread.id, codexThread);
		return thread;
	} catch (error) {
		clearThreadRuntimeState(thread.id);
		deleteThread(db, thread.id);
		throw error;
	}
}

export async function openProjectProcedure(
	params: AppRPCSchema["requests"]["openProject"]["params"],
	context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const projectPath = normalizePath(params.projectPath);
	assertProjectDirectory(projectPath);
	const existingProject = getProject(db, projectPath);

	let worktrees: RpcWorktree[];
	try {
		worktrees = await readProjectWorktrees(
			projectPath,
			existingProject?.id,
			requestGitOptions,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Project folder must be a git repository root or worktree: ${projectPath}${message ? ` (${message})` : ""}`,
		);
	}
	throwIfAborted(context?.signal, "Project open was aborted.");

	const project = upsertProject(db, {
		projectPath,
		name: params.name ?? basename(projectPath),
	});
	const state = ensureProjectPoller(project);
	state.worktrees = worktrees;
	state.worktreesLoadedAt = Date.now();

	return {
		project,
		worktrees: state.worktrees,
	};
}

export async function listProjectWorktreesProcedure(
	params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
	context?: RpcRequestContext,
): Promise<RpcProjectWorktreesResult> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const project = projectByIdForPath(params.projectId);
	ensureProjectPoller(project);
	const worktrees = await readProjectWorktrees(
		project.path,
		project.id,
		requestGitOptions,
	);

	return {
		project,
		worktrees,
	};
}

export async function listProjectTasksProcedure(
	params: AppRPCSchema["requests"]["listProjectTasks"]["params"],
	context?: RpcRequestContext,
): Promise<RpcProjectTask[]> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	const projectState = ensureProjectPoller(project);
	await ensureTrackedProjectWorktree(
		project,
		projectState,
		worktreePath,
		requestGitOptions,
	);
	const worktreeState = ensureWorktreePollState(projectState, worktreePath);
	if (worktreeState.tasks !== null) {
		startWorktreeTaskPolling(projectState, worktreePath);
		return worktreeState.tasks;
	}

	throwIfAborted(context?.signal, "Project task read was aborted.");
	const taskWatchTargets = readTaskWatchTargets(worktreePath);
	throwIfAborted(context?.signal, "Project task read was aborted.");
	const tasks = readProjectTasksFromDisk(worktreePath);
	worktreeState.taskWatchTargets = taskWatchTargets;
	worktreeState.tasks = tasks;
	worktreeState.lastUpdatedAt = getNow();
	startWorktreeTaskPolling(projectState, worktreePath);
	return tasks;
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

	const worktrees = await readProjectWorktrees(project.path, project.id, {
		forceRefresh: true,
	});
	return {
		project,
		worktrees,
		worktreePath,
	};
}

export async function setWorktreePinnedProcedure(
	params: AppRPCSchema["requests"]["setWorktreePinned"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath, {
		forceRefresh: true,
	});

	setProjectWorktreePinned(db, project.id, worktreePath, params.pinned);

	const state = ensureProjectPoller(project);
	const worktrees = await listFreshProjectWorktrees(project.path, project.id);
	state.worktrees = worktrees;
	state.worktreesLoadedAt = Date.now();

	return {
		project,
		worktrees,
	};
}

export async function createThreadProcedure(
	params: AppRPCSchema["requests"]["createThread"]["params"],
): Promise<RpcThreadDetail> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	const model = resolveCodexModel(params.model);
	const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
	const thread = await createThreadRecord(
		project,
		worktreePath,
		model,
		reasoningEffort,
		{
			forceRefresh: true,
		},
	);
	return readThreadDetailCached(thread.id);
}

export async function getThreadProcedure(
	params: AppRPCSchema["requests"]["getThread"]["params"],
): Promise<RpcThreadDetail> {
	return readThreadDetailCached(params.threadId);
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
	return readThreadDetailCached(thread.id);
}

export async function sendThreadMessageProcedure(
	params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
): Promise<RpcThreadDetail> {
	const thread = threadById(params.threadId);
	const input = params.input.trim();
	if (!input) {
		throw new Error("Thread input is required.");
	}

	return queueThreadMessage(thread, input);
}

async function queueThreadMessage(
	thread: ThreadRecord,
	input: string,
): Promise<RpcThreadDetail> {
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
	const controller = new AbortController();
	threadTurnAbortControllerMap.set(thread.id, controller);
	setThreadRunStatus(thread.id, {
		state: "working",
		startedAt,
		updatedAt: startedAt,
		error: null,
		hasUnreadError: false,
	});

	const completion = runThreadMessageInBackground(
		thread.id,
		input,
		startedAt,
		controller,
	);
	threadTurnCompletionMap.set(thread.id, completion);
	void completion;

	return readThreadDetailCached(thread.id);
}

export async function runProjectTaskProcedure(
	params: AppRPCSchema["requests"]["runProjectTask"]["params"],
): Promise<RpcThreadDetail> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath, {
		forceRefresh: true,
	});

	let taskPrompt: string;
	switch (params.task.kind) {
		case "script":
			taskPrompt = formatPackageScriptTaskPrompt(
				resolvePackageJsonTask(worktreePath, params.task),
			);
			break;
		case "file": {
			const taskFilePath = resolveProjectTaskFilePath(
				worktreePath,
				params.task.path,
			);
			const taskContent = await Bun.file(taskFilePath).text();
			if (!taskContent.trim()) {
				throw new Error(`Task file is empty: ${params.task.path}`);
			}
			taskPrompt = formatTaskPrompt(
				taskTitleFromPath(params.task.path),
				taskContent,
			);
			break;
		}
		default:
			throw new Error(`Unsupported project task kind: ${params.task.kind}`);
	}

	let thread = params.threadId ? threadById(params.threadId) : null;
	if (thread) {
		if (
			thread.projectId !== project.id ||
			normalizePath(thread.worktreePath) !== worktreePath
		) {
			throw new Error("Selected task must run in the active worktree thread.");
		}
	} else {
		thread = await createThreadRecord(
			project,
			worktreePath,
			resolveCodexModel(params.model),
			resolveCodexReasoningEffort(params.reasoningEffort),
			{
				forceRefresh: true,
			},
		);
	}

	return queueThreadMessage(thread, taskPrompt);
}

export async function stopThreadTurnProcedure(
	params: AppRPCSchema["requests"]["stopThreadTurn"]["params"],
): Promise<RpcThreadDetail> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state !== "working") {
		return readThreadDetailCached(thread.id);
	}

	const controller = threadTurnAbortControllerMap.get(thread.id);
	if (!controller) {
		throw new Error(
			"Thread stop is unavailable because no active run was found.",
		);
	}

	if (!controller.signal.aborted) {
		controller.abort(
			createAbortError(null, "Codex turn was stopped by the user."),
		);
	}

	await threadTurnCompletionMap.get(thread.id);
	return readThreadDetailCached(thread.id);
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
	invalidateThreadDetailCache(thread.id);
	return toRpcThread(threadById(thread.id));
}

export async function setThreadPinnedProcedure(
	params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
): Promise<RpcThread> {
	const thread = threadById(params.threadId);
	setThreadPinned(db, thread.id, params.pinned);
	invalidateThreadDetailCache(thread.id);
	return toRpcThread(threadById(thread.id));
}

export async function updateThreadModelProcedure(
	params: AppRPCSchema["requests"]["updateThreadModel"]["params"],
): Promise<RpcThread> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error("Thread model cannot change while Codex is processing.");
	}

	const model = resolveCodexModel(params.model);
	setThreadModel(db, thread.id, model);
	codexThreadMap.delete(thread.id);
	invalidateThreadDetailCache(thread.id);
	return toRpcThread(threadById(thread.id));
}

export async function updateThreadReasoningEffortProcedure(
	params: AppRPCSchema["requests"]["updateThreadReasoningEffort"]["params"],
): Promise<RpcThread> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error(
			"Thread reasoning effort cannot change while Codex is processing.",
		);
	}

	const reasoningEffort = resolveCodexReasoningEffort(params.reasoningEffort);
	setThreadReasoningEffort(db, thread.id, reasoningEffort);
	codexThreadMap.delete(thread.id);
	invalidateThreadDetailCache(thread.id);
	return toRpcThread(threadById(thread.id));
}

export async function deleteThreadProcedure(
	params: AppRPCSchema["requests"]["deleteThread"]["params"],
): Promise<AppRPCSchema["requests"]["deleteThread"]["response"]> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error("Thread is currently processing and cannot be deleted.");
	}

	clearThreadRuntimeState(thread.id);
	deleteThread(db, thread.id);
	return {
		success: true,
		threadId: thread.id,
		message: `Deleted thread ${thread.title}`,
	};
}

export async function openWorktreeProcedure(
	params: AppRPCSchema["requests"]["openWorktree"]["params"],
	context?: RpcRequestContext,
): Promise<RpcOpenWorktreeResult> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const project = projectByIdForPath(params.projectId);
	const state = ensureProjectPoller(project);
	const worktreePath = normalizePath(params.worktreePath);
	await ensureTrackedProjectWorktree(project, state, worktreePath, {
		...requestGitOptions,
		forceRefresh: true,
	});

	const worktreeState = ensureWorktreePollState(state, worktreePath);
	const historyPromise = readGitHistoryFirstPage(
		project.id,
		worktreePath,
		DEFAULT_GIT_HISTORY_PAGE_SIZE,
		requestGitOptions,
	);
	const snapshotPromise = readWorktreeSnapshot(worktreePath, requestGitOptions);
	const [{ history, summary, signature }, snapshot] = await Promise.all([
		historyPromise,
		snapshotPromise,
	]);
	worktreeState.diff = snapshot.diff;
	worktreeState.files = snapshot.files;
	worktreeState.history = summary;
	worktreeState.historyEntries = history.entries;
	worktreeState.historyNextOffset = history.nextOffset;
	worktreeState.historySignature = signature;
	worktreeState.lastUpdatedAt = snapshot.lastUpdatedAt;
	syncProjectWorktreeBackgroundPolling(state);
	warmGitHistoryCache(worktreeState, worktreePath);

	return {
		project,
		worktree: {
			path: worktreePath,
			...snapshot,
		},
		history,
	};
}

export async function listWorktreeGitHistoryProcedure(
	params: AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
	context?: RpcRequestContext,
): Promise<RpcWorktreeGitHistoryResult> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	const offset =
		Number.isInteger(params.offset) && typeof params.offset === "number"
			? Math.max(params.offset, 0)
			: 0;
	const limit = normalizeGitHistoryPageLimit(params.limit);

	const projectState = ensureProjectPoller(project);
	await ensureTrackedProjectWorktree(
		project,
		projectState,
		worktreePath,
		requestGitOptions,
	);
	const state = ensureWorktreePollState(projectState, worktreePath);
	if (offset === 0 && state.historySignature !== null) {
		if (!state.history.headHash) {
			syncProjectWorktreeBackgroundPolling(projectState);
			return {
				...state.history,
				entries: [],
				limit,
				nextOffset: null,
			};
		}

		await fillGitHistoryCache(state, worktreePath, 0, limit, requestGitOptions);
		syncProjectWorktreeBackgroundPolling(projectState);
		warmGitHistoryCache(state, worktreePath);
		return buildGitHistoryResultFromCache(state, limit, 0);
	}

	if (offset === 0) {
		const { history, summary, signature } = await readGitHistoryFirstPage(
			project.id,
			worktreePath,
			limit,
			requestGitOptions,
		);
		state.history = summary;
		state.historyEntries = history.entries;
		state.historyNextOffset = history.nextOffset;
		state.historySignature = signature;
		state.lastUpdatedAt = summary.lastUpdatedAt;
		syncProjectWorktreeBackgroundPolling(projectState);
		warmGitHistoryCache(state, worktreePath);
		return history;
	}

	let summary = state.history;
	let signature = state.historySignature;
	if (signature === null) {
		const loadedSummary = await readGitHistorySummary(
			project.id,
			worktreePath,
			requestGitOptions,
		);
		summary = loadedSummary.history;
		signature = loadedSummary.signature;
		state.history = summary;
		state.historyNextOffset = summary.headHash ? 0 : null;
		state.historySignature = signature;
		state.lastUpdatedAt = summary.lastUpdatedAt;
	}

	if (!summary.headHash) {
		return {
			...summary,
			entries: [],
			limit,
			nextOffset: null,
		};
	}

	await fillGitHistoryCache(
		state,
		worktreePath,
		offset,
		limit,
		requestGitOptions,
	);
	syncProjectWorktreeBackgroundPolling(projectState);
	warmGitHistoryCache(state, worktreePath);
	return buildGitHistoryResultFromCache(state, limit, offset);
}

export async function getWorktreeGitCommitDiffProcedure(
	params: AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
	context?: RpcRequestContext,
): Promise<RpcGitCommitDiffResult> {
	const requestGitOptions = gitCommandOptionsFromRequest(context);
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	if (!findKnownProjectWorktree(project.id, worktreePath)) {
		await assertProjectWorktree(project, worktreePath, requestGitOptions);
	}

	return getCachedGitCommitDiffResult(
		project.id,
		worktreePath,
		params.commitHash,
		requestGitOptions,
	);
}

export async function setActiveWorktreeProcedure(
	params: AppRPCSchema["requests"]["setActiveWorktree"]["params"],
): Promise<AppRPCSchema["requests"]["setActiveWorktree"]["response"]> {
	const hasProjectId = typeof params.projectId === "number";
	const hasWorktreePath =
		typeof params.worktreePath === "string" &&
		params.worktreePath.trim().length > 0;
	if (hasProjectId !== hasWorktreePath) {
		throw new Error(
			"Active worktree updates must provide both projectId and worktreePath, or neither.",
		);
	}

	const projectId = hasProjectId ? params.projectId : null;
	const worktreePath = hasWorktreePath
		? normalizePath(params.worktreePath ?? "")
		: null;
	if (projectId !== null) {
		ensureProjectPoller(projectByIdForPath(projectId));
	}

	for (const state of projectPollMap.values()) {
		const nextActiveWorktreePath = state.id === projectId ? worktreePath : null;
		if (state.activeWorktreePath === nextActiveWorktreePath) {
			continue;
		}
		state.activeWorktreePath = nextActiveWorktreePath;
		syncProjectWorktreeBackgroundPolling(state);
	}

	return {
		success: true,
		projectId,
		worktreePath,
	};
}

export async function closeWorktreeProcedure(
	params: AppRPCSchema["requests"]["closeWorktree"]["params"],
): Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]> {
	const state = projectPollMap.get(params.projectId);
	if (state) {
		const normalizedPath = normalizePath(params.worktreePath);
		stopWorktreePolling(state, normalizedPath);
		if (state.activeWorktreePath === normalizedPath) {
			state.activeWorktreePath = null;
		}
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
	const projectThreads = listThreads(db).filter(
		(thread) => thread.projectId === project.id,
	);
	const workingThread = projectThreads.find(
		(thread) => threadRunStatusFromRecord(thread).state === "working",
	);
	if (workingThread) {
		throw new Error(
			`Project cannot be deleted while thread "${workingThread.title}" is processing.`,
		);
	}

	stopProjectPoller(project.id);
	clearProjectThreadRuntimeState(project.id);
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

export function suspendActiveWorktreePolling(): void {
	for (const state of projectPollMap.values()) {
		if (state.activeWorktreePath === null) {
			continue;
		}
		state.activeWorktreePath = null;
		syncProjectWorktreeBackgroundPolling(state);
	}
}

export function shutdownProcedureCacheMaintenance(): void {
	if (directorySuggestionRefreshTimer !== null) {
		clearInterval(directorySuggestionRefreshTimer);
		directorySuggestionRefreshTimer = null;
	}
}

export function setWorktreeTaskChangeListener(
	listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
	worktreeTaskChangeListener = listener;
}

export function setWorktreeGitHistoryChangeListener(
	listener: ((projectId: number, worktreePath: string) => void) | null,
): void {
	worktreeGitHistoryChangeListener = listener;
}
