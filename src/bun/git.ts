import { existsSync, statSync } from "node:fs";
import { delimiter, relative, resolve } from "node:path";

import type {
	RpcGitCommitDiffResult,
	RpcGitHistoryEntry,
	RpcWorktree,
	RpcWorktreeGitHistoryResult,
	RpcWorktreeGitHistorySummary,
	RpcWorktreeSnapshot,
} from "./rpc-schema";

const GIT_EXECUTABLE_FALLBACK_DIRECTORIES =
	process.platform === "darwin"
		? [
				"/opt/homebrew/bin",
				"/usr/local/bin",
				"/usr/bin",
				"/bin",
				"/Library/Developer/CommandLineTools/usr/bin",
			]
		: process.platform === "win32"
			? [
					"C:\\Program Files\\Git\\cmd",
					"C:\\Program Files\\Git\\bin",
					"C:\\Program Files (x86)\\Git\\cmd",
					"C:\\Program Files (x86)\\Git\\bin",
				]
			: ["/usr/local/bin", "/usr/bin", "/bin"];
const GIT_LOG_FIELD_SEPARATOR = "\u001f";
const GIT_LOG_RECORD_SEPARATOR = "\u001e";

export const DEFAULT_GIT_HISTORY_PAGE_SIZE = 20;

export type GitCommandPriority = "foreground" | "background";

export type GitCommandOptions = {
	priority?: GitCommandPriority;
	signal?: AbortSignal | null;
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

type DecoratedGitHistoryEntry = RpcGitHistoryEntry & {
	decoration: string;
};

const gitCommandQueueMap = new Map<
	string,
	{
		active: boolean;
		activeTask: GitCommandQueueTask | null;
		backgroundTasks: GitCommandQueueTask[];
		foregroundTasks: GitCommandQueueTask[];
	}
>();
let cachedGitExecutablePath: string | null = null;

function getNow(): string {
	return new Date().toISOString();
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

function throwIfAborted(
	signal: AbortSignal | null | undefined,
	fallbackMessage: string,
): void {
	if (signal?.aborted) {
		throw createAbortError(signal.reason, fallbackMessage);
	}
}

function safeIsExecutableFile(path: string): boolean {
	try {
		const stats = statSync(path);
		if (!stats.isFile()) {
			return false;
		}
		return process.platform === "win32" || (stats.mode & 0o111) !== 0;
	} catch {
		return false;
	}
}

function gitExecutableCandidateNames(): string[] {
	return process.platform === "win32"
		? ["git.exe", "git.cmd", "git.bat", "git"]
		: ["git"];
}

function readProcessPathValue(): string {
	return process.env.PATH?.trim() || process.env.Path?.trim() || "";
}

function resolveGitExecutablePath(): string {
	if (
		cachedGitExecutablePath &&
		safeIsExecutableFile(cachedGitExecutablePath)
	) {
		return cachedGitExecutablePath;
	}

	const discoveredGitPath = Bun.which("git");
	if (discoveredGitPath && safeIsExecutableFile(discoveredGitPath)) {
		cachedGitExecutablePath = discoveredGitPath;
		return discoveredGitPath;
	}

	const searchDirectories = [
		...readProcessPathValue()
			.split(delimiter)
			.map((entry) => entry.trim())
			.filter(Boolean),
		...GIT_EXECUTABLE_FALLBACK_DIRECTORIES,
	];
	const seenDirectories = new Set<string>();

	for (const directory of searchDirectories) {
		if (seenDirectories.has(directory)) {
			continue;
		}
		seenDirectories.add(directory);

		for (const executableName of gitExecutableCandidateNames()) {
			const candidatePath = resolve(directory, executableName);
			if (!safeIsExecutableFile(candidatePath)) {
				continue;
			}
			cachedGitExecutablePath = candidatePath;
			return candidatePath;
		}
	}

	throw new Error(
		"Could not locate the git executable. Ensure git is installed and available on PATH.",
	);
}

export function normalizeGitCommandOptions(
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

async function runGitCommandResult(
	cwd: string,
	args: string[],
	options?: GitCommandPriority | GitCommandOptions,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
	const { priority, signal } = normalizeGitCommandOptions(options);
	return enqueueGitCommand(cwd, priority, signal, async (taskSignal) => {
		throwIfAborted(signal, "Git command was aborted.");
		throwIfAborted(taskSignal, "Git command was aborted.");
		const gitExecutablePath = resolveGitExecutablePath();
		const proc = Bun.spawn({
			cmd: [gitExecutablePath, ...args],
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

export async function runGitCommand(
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

export function normalizeGitPath(worktreePath: string, value: string): string {
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

export async function readFileChangeDiff(
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

function parseWorktreeList(raw: string): RpcWorktree[] {
	if (!raw.trim()) {
		return [];
	}

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

		if (!current) {
			continue;
		}

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

export async function listGitWorktreesForProjectPath(
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
		path: resolve(projectPath, worktree.path),
	}));
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
	if (!raw.trim()) {
		return [];
	}
	return raw.split(/\r?\n/).filter(Boolean);
}

async function readFiles(
	worktreePath: string,
	options?: GitCommandPriority | GitCommandOptions,
): Promise<string[]> {
	const raw = await runGitCommand(worktreePath, ["status", "--short"], options);
	if (!raw.trim()) {
		return [];
	}
	return raw.split(/\r?\n/).filter(Boolean);
}

export async function readWorktreeSnapshot(
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

export function normalizeGitHistoryPageLimit(limit?: number): number {
	if (typeof limit !== "number" || !Number.isInteger(limit)) {
		return DEFAULT_GIT_HISTORY_PAGE_SIZE;
	}
	return Math.min(Math.max(limit, 1), DEFAULT_GIT_HISTORY_PAGE_SIZE);
}

export async function readGitHistorySummary(
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

export async function readGitHistoryPageEntries(
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

export async function readGitHistoryFirstPage(
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

export async function readGitCommitDiffResult(
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
