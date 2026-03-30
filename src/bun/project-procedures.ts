import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";

import type { ProjectRecord } from "./db";
import {
	deleteProject,
	getProjectById,
	initAppDatabase,
	listProjects,
	setProjectClosed,
	upsertProject,
} from "./db";
import type {
	AppRPCSchema,
	RpcCreateWorktreeResult,
	RpcOpenWorktreeResult,
	RpcProject,
	RpcProjectWorktreesResult,
	RpcWorktree,
	RpcWorktreeSnapshot,
} from "./rpc-schema";

const db = initAppDatabase();

export async function listProjectsProcedure(
	_params?: AppRPCSchema["requests"]["listProjects"]["params"],
): Promise<RpcProject[]> {
	return listProjects(db);
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
