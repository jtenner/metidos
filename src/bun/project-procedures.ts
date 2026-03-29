import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { ProjectRecord } from "./db";
import {
	getProjectById,
	initAppDatabase,
	listProjects,
	setProjectClosed,
	upsertProject,
} from "./db";
import type {
	AppRPCSchema,
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

function normalizePath(value: string): string {
	return resolve(value);
}

function normalizeWorktreePath(
	projectPath: string,
	worktreePath: string,
): string {
	return resolve(projectPath, worktreePath);
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
	if (!existsSync(projectPath)) {
		throw new Error(`Project path does not exist: ${projectPath}`);
	}

	const project = upsertProject(db, {
		projectPath,
		name: params.name ?? basename(projectPath),
	});
	const state = ensureProjectPoller(project);
	await refreshProjectPoll(project.id);

	return {
		project,
		worktrees: state.worktrees,
	};
}

export async function listProjectWorktreesProcedure(
	params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
): Promise<RpcProjectWorktreesResult> {
	const project = projectByIdForPath(params.projectId);
	if (!projectPollMap.has(project.id)) {
		ensureProjectPoller(project);
		await refreshProjectPoll(project.id);
	}
	const state = projectPollMap.get(project.id);
	if (!state) {
		throw new Error(`Project state missing for id: ${project.id}`);
	}

	return {
		project,
		worktrees: state.worktrees,
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
