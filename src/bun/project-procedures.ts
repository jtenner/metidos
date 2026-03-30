import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, relative, resolve } from "node:path";
import { Codex, type ThreadItem } from "@openai/codex-sdk";

import type { ProjectRecord, ThreadMessageRecord, ThreadRecord } from "./db";
import {
	DEFAULT_THREAD_MODEL,
	createThread,
	createThreadMessage,
	deleteProject,
	deleteThread,
	getProject,
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
	setThreadModel,
	setThreadPinned,
	setThreadUsage,
	touchThread,
	updateThreadCodexId,
	upsertProject,
	upsertThreadActivity,
} from "./db";
import type {
	AppRPCSchema,
	RpcCodexModelCatalog,
	RpcCodexModelOption,
	RpcCreateWorktreeResult,
	RpcGitCommitDiffResult,
	RpcGitHistoryEntry,
	RpcOpenWorktreeResult,
	RpcProject,
	RpcProjectTask,
	RpcProjectWorktreesResult,
	RpcThread,
	RpcThreadCompaction,
	RpcThreadDetail,
	RpcThreadMessage,
	RpcThreadRunStatus,
	RpcThreadUsage,
	RpcWorktree,
	RpcWorktreeGitHistoryResult,
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
const DIFF_POLL_INTERVAL_MS = 2_000;
const FILE_POLL_INTERVAL_MS = 4_000;
const GIT_HISTORY_POLL_INTERVAL_MS = 2_000;
const TASK_POLL_INTERVAL_MS = 1_500;
const DIRECTORY_SUGGESTION_CACHE_TTL_MS = 60_000;
const DIRECTORY_SUGGESTION_CACHE_MAX_ENTRIES = 96;
const DIRECTORY_SUGGESTION_REFRESH_BATCH_SIZE = 6;
const DIRECTORY_SUGGESTION_REFRESH_POLL_INTERVAL_MS = 5_000;
const DIRECTORY_SUGGESTION_REFRESH_RECENT_WINDOW_MS = 90_000;
const THREAD_DETAIL_CACHE_MAX_ENTRIES = 32;
const GIT_HISTORY_ENTRY_LIMIT = 20;
const GIT_LOG_FIELD_SEPARATOR = "\u001f";
const GIT_LOG_RECORD_SEPARATOR = "\u001e";

type WorktreePollState = {
	diff: string[];
	files: string[];
	diffTimer: ReturnType<typeof setInterval> | null;
	filesTimer: ReturnType<typeof setInterval> | null;
	history: RpcWorktreeGitHistoryResult;
	historySignature: string | null;
	historyTimer: ReturnType<typeof setInterval> | null;
	taskInputs: Map<string, number>;
	taskTimer: ReturnType<typeof setInterval> | null;
	lastUpdatedAt: string;
};

type ProjectPollState = {
	id: number;
	project: ProjectRecord;
	projectPath: string;
	worktrees: RpcWorktree[];
	worktreesLoadedAt: number;
	projectTimer: ReturnType<typeof setInterval> | null;
	openWorktrees: Map<string, WorktreePollState>;
};

const projectPollMap = new Map<number, ProjectPollState>();
const codexThreadMap = new Map<number, ReturnType<typeof codex.startThread>>();
const threadRunStatusMap = new Map<number, RpcThreadRunStatus>();
const directorySuggestionCache = new Map<
	string,
	{
		directoryNames: string[];
		lastAccessedAt: number;
		loadedAt: number;
	}
>();
const threadDetailCache = new Map<number, RpcThreadDetail>();
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

function buildCodexModelCatalog(): RpcCodexModelCatalog {
	return {
		defaultModel: DEFAULT_THREAD_MODEL,
		models: CODEx_MODEL_OPTIONS,
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
				Bun.file(packageJsonPath).textSync(),
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

function readTaskInputStamps(
	worktreePath: string,
	currentDirectory = worktreePath,
	result = new Map<string, number>(),
): Map<string, number> {
	if (!safeIsDirectory(currentDirectory)) {
		return result;
	}

	const entries = sortDirectoryNames(readdirSync(currentDirectory));
	const relativeDirectory =
		relative(worktreePath, currentDirectory).replace(/\\/g, "/") || ".";

	if (
		relativeDirectory === ".tasks" ||
		relativeDirectory.startsWith(".tasks/")
	) {
		for (const entry of entries) {
			if (entry.startsWith(".")) {
				continue;
			}
			const fullPath = resolve(currentDirectory, entry);
			if (safeIsDirectory(fullPath)) {
				readTaskInputStamps(worktreePath, fullPath, result);
				continue;
			}
			if (!safeIsFile(fullPath)) {
				continue;
			}
			const relativePath = relative(worktreePath, fullPath).replace(/\\/g, "/");
			result.set(relativePath, statSync(fullPath).mtimeMs);
		}
		return result;
	}

	const packageJsonPath = resolve(currentDirectory, "package.json");
	if (entries.includes("package.json") && safeIsFile(packageJsonPath)) {
		const relativePath = relative(worktreePath, packageJsonPath).replace(
			/\\/g,
			"/",
		);
		result.set(relativePath, statSync(packageJsonPath).mtimeMs);
	}

	for (const entry of entries) {
		if (entry === ".tasks") {
			readTaskInputStamps(
				worktreePath,
				resolve(currentDirectory, entry),
				result,
			);
			continue;
		}

		const fullPath = resolve(currentDirectory, entry);
		if (!safeIsDirectory(fullPath) || isIgnoredPackageDirectory(entry)) {
			continue;
		}
		readTaskInputStamps(worktreePath, fullPath, result);
	}

	return result;
}

function taskInputsChanged(
	previous: Map<string, number>,
	next: Map<string, number>,
): boolean {
	if (previous.size !== next.size) {
		return true;
	}

	for (const [path, mtimeMs] of next) {
		if (previous.get(path) !== mtimeMs) {
			return true;
		}
	}

	return false;
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
		parsed = JSON.parse(Bun.file(packageJsonPath).textSync()) as Partial<{
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

function codexThreadOptions(worktreePath: string, model: string) {
	return {
		approvalPolicy: "never" as const,
		model,
		modelReasoningEffort: "medium" as const,
		networkAccessEnabled: true,
		sandboxMode: "workspace-write" as const,
		workingDirectory: worktreePath,
	};
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
				codexThreadOptions(
					thread.worktreePath,
					normalizeStoredCodexModel(thread.model),
				),
			)
		: codex.startThread(
				codexThreadOptions(
					thread.worktreePath,
					normalizeStoredCodexModel(thread.model),
				),
			);
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

async function runThreadMessageInBackground(
	threadId: number,
	input: string,
	startedAt: string,
): Promise<void> {
	let lastAssistantText = "";
	let lastAssistantItemId: string | null = null;
	let terminalError: string | null = null;
	let usage: RpcThreadUsage | null = null;

	try {
		const thread = threadById(threadId);
		const codexThread = await ensureCodexThread(thread);
		const { events } = await codexThread.runStreamed(input);

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
	if (typeof projectId === "number") {
		const state = projectPollMap.get(projectId);
		if (state && state.worktreesLoadedAt > 0) {
			if (
				Date.now() - state.worktreesLoadedAt >
				PROJECT_WORKTREE_CACHE_STALE_MS
			) {
				void refreshProjectPoll(projectId).catch((error) => {
					console.error(
						`Worktree refresh failed for project ${projectId}`,
						error,
					);
				});
			}
			return state.worktrees;
		}
	}

	const worktrees = await listWorktreesForProjectPath(projectPath);
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

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
	const { exitCode, stderr, stdout } = await runGitCommandResult(cwd, args);
	if (exitCode !== 0) {
		throw new Error(stderr || `git command failed with exit code ${exitCode}`);
	}
	return stdout.trimEnd();
}

async function runGitCommandResult(
	cwd: string,
	args: string[],
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const proc = Bun.spawn({
		cmd: ["git", ...args],
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;

	return {
		exitCode,
		stderr: stderr.trim(),
		stdout,
	};
}

async function tryRunGitCommand(
	cwd: string,
	args: string[],
): Promise<string | null> {
	const result = await runGitCommandResult(cwd, args);
	if (result.exitCode !== 0) {
		return null;
	}
	return result.stdout.trimEnd();
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

function emptyGitHistoryResult(
	projectId: number,
	worktreePath: string,
	options?: {
		branch?: string | null;
		lastUpdatedAt?: string;
	},
): RpcWorktreeGitHistoryResult {
	return {
		projectId,
		worktreePath,
		branch: options?.branch ?? null,
		headHash: null,
		headShortHash: null,
		entries: [],
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

function buildGitHistorySignature(
	branch: string | null,
	headHash: string | null,
	entries: RpcGitHistoryEntry[],
): string {
	return [
		branch ?? "",
		headHash ?? "",
		...entries.map((entry) => entry.hash),
	].join("\n");
}

async function readGitHistory(
	projectId: number,
	worktreePath: string,
): Promise<{
	history: RpcWorktreeGitHistoryResult;
	signature: string;
}> {
	const branch =
		(
			await tryRunGitCommand(worktreePath, ["branch", "--show-current"])
		)?.trim() || null;
	const headHash =
		(await tryRunGitCommand(worktreePath, ["rev-parse", "HEAD"]))?.trim() ||
		null;
	const headShortHash =
		(
			await tryRunGitCommand(worktreePath, ["rev-parse", "--short=7", "HEAD"])
		)?.trim() || null;
	const lastUpdatedAt = getNow();

	if (!headHash || !headShortHash) {
		return {
			history: emptyGitHistoryResult(projectId, worktreePath, {
				branch,
				lastUpdatedAt,
			}),
			signature: buildGitHistorySignature(branch, null, []),
		};
	}

	const rawEntries =
		(await tryRunGitCommand(worktreePath, [
			"log",
			`--max-count=${GIT_HISTORY_ENTRY_LIMIT}`,
			"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI%x1e",
			headHash,
		])) ?? "";
	const entries = parseGitHistoryEntries(rawEntries);

	return {
		history: {
			projectId,
			worktreePath,
			branch,
			headHash,
			headShortHash,
			entries,
			lastUpdatedAt,
		},
		signature: buildGitHistorySignature(branch, headHash, entries),
	};
}

async function readGitCommitEntry(
	worktreePath: string,
	commitHash: string,
): Promise<RpcGitHistoryEntry> {
	const raw = await runGitCommand(worktreePath, [
		"show",
		"--no-patch",
		"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cI",
		commitHash,
	]);
	const entry = parseGitHistoryEntryRecord(raw);
	if (!entry) {
		throw new Error(`Unable to read commit metadata: ${commitHash}`);
	}
	return entry;
}

async function readGitCommitDiff(
	worktreePath: string,
	commitHash: string,
): Promise<string> {
	return runGitCommand(worktreePath, [
		"show",
		"--format=",
		"--no-ext-diff",
		"--find-renames",
		"--submodule=diff",
		"--unified=3",
		commitHash,
	]);
}

function getNow(): string {
	return new Date().toISOString();
}

async function refreshProjectPoll(projectId: number): Promise<void> {
	const state = projectPollMap.get(projectId);
	if (!state) return;

	const worktrees = await listWorktreesForProjectPath(state.projectPath);
	state.worktrees = worktrees;
	state.worktreesLoadedAt = Date.now();

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
			worktreesLoadedAt: 0,
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
	if (active.historyTimer) {
		clearInterval(active.historyTimer);
	}
	if (active.taskTimer) {
		clearInterval(active.taskTimer);
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
		history: emptyGitHistoryResult(state.id, worktreePath),
		historySignature: null,
		historyTimer: null,
		taskInputs: new Map(),
		taskTimer: null,
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

	const pollGitHistory = async () => {
		try {
			const previousSignature = worktreeState.historySignature;
			const { history, signature } = await readGitHistory(
				state.id,
				worktreePath,
			);
			worktreeState.history = history;
			worktreeState.historySignature = signature;
			worktreeState.lastUpdatedAt = history.lastUpdatedAt;

			if (previousSignature !== null && previousSignature !== signature) {
				worktreeGitHistoryChangeListener?.(state.id, worktreePath);
			}
		} catch (error) {
			console.error(`Git history poll failed for ${worktreePath}`, error);
		}
	};

	const pollTasks = () => {
		try {
			const nextTaskInputs = readTaskInputStamps(worktreePath);
			if (!taskInputsChanged(worktreeState.taskInputs, nextTaskInputs)) {
				return;
			}
			worktreeState.taskInputs = nextTaskInputs;
			worktreeState.lastUpdatedAt = getNow();
			worktreeTaskChangeListener?.(state.id, worktreePath);
		} catch (error) {
			console.error(`Task poll failed for ${worktreePath}`, error);
		}
	};

	worktreeState.diffTimer = setInterval(() => {
		void pollDiff();
	}, DIFF_POLL_INTERVAL_MS);
	worktreeState.filesTimer = setInterval(() => {
		void pollFiles();
	}, FILE_POLL_INTERVAL_MS);
	worktreeState.historyTimer = setInterval(() => {
		void pollGitHistory();
	}, GIT_HISTORY_POLL_INTERVAL_MS);
	worktreeState.taskTimer = setInterval(() => {
		pollTasks();
	}, TASK_POLL_INTERVAL_MS);

	state.openWorktrees.set(worktreePath, worktreeState);
	void pollDiff();
	void pollFiles();
	void pollGitHistory();

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

async function assertProjectWorktree(
	project: ProjectRecord,
	worktreePath: string,
): Promise<RpcWorktree> {
	const worktree = await findProjectWorktree(project, worktreePath);
	if (!worktree) {
		throw new Error(
			`Worktree not found for project ${project.path}: ${worktreePath}`,
		);
	}
	return worktree;
}

async function createThreadRecord(
	project: ProjectRecord,
	worktreePath: string,
	model: string,
): Promise<ThreadRecord> {
	const worktree = await assertProjectWorktree(project, worktreePath);
	const codexThread = codex.startThread(
		codexThreadOptions(worktreePath, model),
	);

	const thread = createThread(db, {
		projectId: project.id,
		worktreePath,
		title: buildThreadTitle(worktree, worktreePath),
		model,
		codexThreadId: codexThread.id ?? null,
	});
	codexThreadMap.set(thread.id, codexThread);
	return thread;
}

export async function openProjectProcedure(
	params: AppRPCSchema["requests"]["openProject"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const projectPath = normalizePath(params.projectPath);
	assertProjectDirectory(projectPath);
	const existingProject = getProject(db, projectPath);

	let worktrees: RpcWorktree[];
	try {
		worktrees = await readProjectWorktrees(projectPath, existingProject?.id);
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
	state.worktreesLoadedAt = Date.now();

	return {
		project,
		worktrees: state.worktrees,
	};
}

export async function listProjectWorktreesProcedure(
	params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const project = projectByIdForPath(params.projectId);
	ensureProjectPoller(project);
	const worktrees = await readProjectWorktrees(project.path, project.id);

	return {
		project,
		worktrees,
	};
}

export async function listProjectTasksProcedure(
	params: AppRPCSchema["requests"]["listProjectTasks"]["params"],
): Promise<RpcProjectTask[]> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath);
	startWorktreePolling(ensureProjectPoller(project), worktreePath);
	return sortProjectTasks([
		...listProjectTaskFiles(tasksDirectoryPath(worktreePath)),
		...listPackageJsonTasks(worktreePath),
	]);
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
	const model = resolveCodexModel(params.model);
	const thread = await createThreadRecord(project, worktreePath, model);
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
	setThreadRunStatus(thread.id, {
		state: "working",
		startedAt,
		updatedAt: startedAt,
		error: null,
		hasUnreadError: false,
	});

	void runThreadMessageInBackground(thread.id, input, startedAt);

	return readThreadDetailCached(thread.id);
}

export async function runProjectTaskProcedure(
	params: AppRPCSchema["requests"]["runProjectTask"]["params"],
): Promise<RpcThreadDetail> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath);

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
		);
	}

	return queueThreadMessage(thread, taskPrompt);
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

export async function deleteThreadProcedure(
	params: AppRPCSchema["requests"]["deleteThread"]["params"],
): Promise<AppRPCSchema["requests"]["deleteThread"]["response"]> {
	const thread = threadById(params.threadId);
	if (threadRunStatusFromRecord(thread).state === "working") {
		throw new Error("Thread is currently processing and cannot be deleted.");
	}

	codexThreadMap.delete(thread.id);
	threadRunStatusMap.delete(thread.id);
	invalidateThreadDetailCache(thread.id);
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

export async function listWorktreeGitHistoryProcedure(
	params: AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
): Promise<RpcWorktreeGitHistoryResult> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath);

	const state = startWorktreePolling(
		ensureProjectPoller(project),
		worktreePath,
	);
	const { history, signature } = await readGitHistory(project.id, worktreePath);
	state.history = history;
	state.historySignature = signature;
	state.lastUpdatedAt = history.lastUpdatedAt;
	return history;
}

export async function getWorktreeGitCommitDiffProcedure(
	params: AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
): Promise<RpcGitCommitDiffResult> {
	const project = projectByIdForPath(params.projectId);
	const worktreePath = normalizePath(params.worktreePath);
	await assertProjectWorktree(project, worktreePath);

	const [commit, diffText] = await Promise.all([
		readGitCommitEntry(worktreePath, params.commitHash),
		readGitCommitDiff(worktreePath, params.commitHash),
	]);

	return {
		projectId: project.id,
		worktreePath,
		commit,
		diffText,
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
