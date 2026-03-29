import { Electroview } from "electrobun/view";

import type {
	AppRPCSchema,
	ProjectProcedures,
	RpcProject,
	RpcWorktree,
	RpcWorktreeSnapshot,
} from "../bun/rpc-schema";

const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {},
		messages: {},
	},
});

new Electroview({ rpc });

const procedures: ProjectProcedures = rpc.request;

declare global {
	interface Window {
		jtIdeProcedures: ProjectProcedures;
	}
}

type ProjectNodeState = {
	expanded: boolean;
	worktrees: RpcWorktree[];
	loadingWorktrees: boolean;
	error: string;
	openWorktrees: Set<string>;
};

type WorktreeNodeState = {
	loading: boolean;
	opened: boolean;
	snapshot?: RpcWorktreeSnapshot;
	error: string;
};

type AppState = {
	projects: RpcProject[];
	projectStates: Map<number, ProjectNodeState>;
	worktreeStates: Map<string, WorktreeNodeState>;
	sidebarCollapsed: boolean;
	selectedProjectId: number | null;
	selectedWorktreePath: string | null;
	chatInput: string;
	isSending: boolean;
	messageLines: { speaker: "assistant" | "user"; text: string }[];
};

const appState: AppState = {
	projects: [],
	projectStates: new Map(),
	worktreeStates: new Map(),
	sidebarCollapsed: false,
	selectedProjectId: null,
	selectedWorktreePath: null,
	chatInput: "",
	isSending: false,
	messageLines: [
		{
			speaker: "assistant",
			text: "Neural context attached. Ask me about the selected project or worktree, and I will generate diffs, refactors, and command-safe patches.",
		},
	],
};

const appRoot = document.getElementById("app");
if (!appRoot) {
	throw new Error("Mainview root not found");
}

window.jtIdeProcedures = procedures;

function shortName(value: string): string {
	const cleaned = value.replace(/[\\/]$/, "");
	const parts = cleaned.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? value;
}

function worktreeKey(projectId: number, worktreePath: string): string {
	return `${projectId}::${worktreePath}`;
}

function projectState(projectId: number): ProjectNodeState {
	const state = appState.projectStates.get(projectId);
	if (state) return state;

	const created: ProjectNodeState = {
		expanded: false,
		worktrees: [],
		loadingWorktrees: false,
		error: "",
		openWorktrees: new Set(),
	};
	appState.projectStates.set(projectId, created);
	return created;
}

function worktreeState(
	projectId: number,
	worktreePath: string,
): WorktreeNodeState {
	const key = worktreeKey(projectId, worktreePath);
	const state = appState.worktreeStates.get(key);
	if (state) return state;

	const created: WorktreeNodeState = {
		loading: false,
		opened: false,
		error: "",
	};
	appState.worktreeStates.set(key, created);
	return created;
}

function selectedProject(): RpcProject | null {
	if (!appState.selectedProjectId) return null;
	return (
		appState.projects.find(
			(project) => project.id === appState.selectedProjectId,
		) ?? null
	);
}

function selectedProjectLabel(): string {
	const project = selectedProject();
	return project ? `${project.name} · ${project.path}` : "No project selected";
}

function selectedWorktreeLabel(): string {
	if (!appState.selectedWorktreePath) return "";
	return shortName(appState.selectedWorktreePath);
}

async function refreshProjectsFromDb(): Promise<void> {
	appState.projects = await procedures.listProjects({ includeClosed: true });
	for (const project of appState.projects) {
		projectState(project.id);
	}

	if (!appState.selectedProjectId && appState.projects.length > 0) {
		appState.selectedProjectId = appState.projects[0]?.id ?? null;
	}
}

async function expandProject(project: RpcProject): Promise<void> {
	const state = projectState(project.id);
	const expanded = state.expanded;
	state.expanded = !expanded;

	if (!expanded) {
		state.loadingWorktrees = true;
		render();
		try {
			const result = await procedures.openProject({
				projectPath: project.path,
				name: project.name,
			});
			state.worktrees = result.worktrees;
			state.error = "";
			if (!appState.selectedProjectId) {
				appState.selectedProjectId = project.id;
			}
		} catch (error) {
			state.error = String(error instanceof Error ? error.message : error);
			state.expanded = false;
		} finally {
			state.loadingWorktrees = false;
		}
		render();
		return;
	}

	for (const path of state.openWorktrees) {
		try {
			await procedures.closeWorktree({
				projectId: project.id,
				worktreePath: path,
			});
		} catch {
			// best effort
		}
		appState.worktreeStates.delete(worktreeKey(project.id, path));
	}
	state.openWorktrees.clear();

	try {
		await procedures.closeProject({ projectId: project.id });
	} catch {
		// best effort
	}
	render();
}

async function toggleWorktree(
	projectId: number,
	worktreePath: string,
): Promise<void> {
	const project = appState.projects.find((entry) => entry.id === projectId);
	if (!project) return;

	const pState = projectState(projectId);
	const wState = worktreeState(projectId, worktreePath);
	const willOpen = !wState.opened;
	wState.loading = true;
	render();

	if (!willOpen) {
		try {
			await procedures.closeWorktree({ projectId, worktreePath });
			wState.opened = false;
			wState.snapshot = undefined;
		} catch {
			// best effort
		} finally {
			wState.loading = false;
			pState.openWorktrees.delete(worktreePath);
			if (appState.selectedWorktreePath === worktreePath) {
				appState.selectedWorktreePath = null;
			}
			render();
		}
		return;
	}

	try {
		const result = await procedures.openWorktree({
			projectId,
			worktreePath,
		});
		wState.opened = true;
		wState.error = "";
		wState.snapshot = result.worktree;
		pState.openWorktrees.add(worktreePath);
		appState.selectedProjectId = projectId;
		appState.selectedWorktreePath = worktreePath;
	} catch (error) {
		wState.error = String(error instanceof Error ? error.message : error);
	}

	wState.loading = false;
	render();
}

function openProjectNode(projectId: number): void {
	const project = appState.projects.find((entry) => entry.id === projectId);
	if (!project) return;
	void expandProject(project);
}

function handleSendMessage(): void {
	const trimmed = appState.chatInput.trim();
	if (!trimmed || appState.isSending) return;

	appState.messageLines.push({ speaker: "user", text: trimmed });
	appState.chatInput = "";
	appState.isSending = true;
	render();

	setTimeout(() => {
		appState.messageLines.push({
			speaker: "assistant",
			text: `Queued action against ${selectedWorktreeLabel() || selectedProjectLabel()}. ${
				selectedWorktreeLabel()
					? `Worktree ${selectedWorktreeLabel()} is being prepared for diff-aware execution.`
					: "Reply is pending integration with the Bun-side Codex event stream."
			}`,
		});
		appState.isSending = false;
		render();
	}, 600);
}

function createHeader(): HTMLElement {
	const header = document.createElement("header");
	header.className =
		"border-b border-slate-800 bg-slate-900 px-5 py-3 flex items-center justify-between";

	const left = document.createElement("div");
	left.className = "text-lg font-bold text-violet-300";
	left.textContent = "The Monolithic Intelligence";

	const nav = document.createElement("nav");
	nav.className = "hidden md:flex gap-6 text-xs uppercase tracking-wide";
	for (const item of ["File Tree", "Codex", "Diff", "Tasks"]) {
		const tab = document.createElement("button");
		tab.className =
			item === "Codex"
				? "text-violet-300 border-b border-violet-400 pb-1"
				: "text-slate-400 hover:text-slate-200 transition-colors";
		tab.textContent = item;
		nav.appendChild(tab);
	}
	header.append(left, nav);
	return header;
}

function createProjectNode(project: RpcProject): HTMLElement {
	const state = projectState(project.id);
	const wrapper = document.createElement("div");
	wrapper.className = "px-2";

	const row = document.createElement("button");
	row.type = "button";
	row.className = [
		"w-full text-left px-3 py-2 rounded-sm flex items-center gap-2 transition-colors",
		"hover:bg-slate-800",
		state.expanded ? "text-violet-200 bg-slate-800/60" : "text-slate-200",
	]
		.join(" ")
		.trim();
	row.addEventListener("click", () => {
		void openProjectNode(project.id);
	});

	const chevron = document.createElement("span");
	chevron.className = "text-[12px] text-slate-300";
	chevron.textContent = state.expanded ? "▾" : "▸";

	const status = document.createElement("span");
	status.className = project.isOpen
		? "w-2 h-2 rounded-full bg-emerald-500"
		: "w-2 h-2 rounded-full bg-slate-600";
	status.setAttribute("aria-hidden", "true");

	const name = document.createElement("span");
	name.className = "font-medium text-sm truncate";
	name.textContent = appState.sidebarCollapsed
		? shortName(project.path)
		: project.name;

	const path = document.createElement("span");
	path.className =
		"text-[10px] uppercase tracking-wide text-slate-400 ml-auto hidden lg:block";
	path.textContent = appState.sidebarCollapsed ? "" : shortName(project.path);

	row.append(chevron, status, name, path);
	wrapper.appendChild(row);

	if (!state.expanded || appState.sidebarCollapsed) {
		return wrapper;
	}

	if (state.loadingWorktrees) {
		const loading = document.createElement("div");
		loading.className = "ml-6 mt-1 text-xs text-slate-400";
		loading.textContent = "Loading worktrees...";
		wrapper.appendChild(loading);
		return wrapper;
	}

	if (state.error) {
		const err = document.createElement("div");
		err.className = "ml-6 mt-1 text-xs text-rose-400";
		err.textContent = state.error;
		wrapper.appendChild(err);
	}

	if (state.worktrees.length === 0) {
		const empty = document.createElement("div");
		empty.className = "ml-6 mt-1 text-xs text-slate-500";
		empty.textContent = "No worktrees found";
		wrapper.appendChild(empty);
		return wrapper;
	}

	for (const worktree of state.worktrees) {
		wrapper.appendChild(createWorktreeNode(project, worktree));
	}

	return wrapper;
}

function createWorktreeNode(
	project: RpcProject,
	worktree: RpcWorktree,
): HTMLElement {
	const state = worktreeState(project.id, worktree.path);
	const row = document.createElement("div");
	row.className = "ml-6 mt-1";

	const button = document.createElement("button");
	button.type = "button";
	button.className = [
		"w-full text-left px-3 py-2 rounded-sm flex flex-col gap-0.5 transition-colors",
		state.opened
			? "bg-slate-800/80 text-violet-100"
			: "hover:bg-slate-800 text-slate-300",
	].join(" ");
	button.addEventListener("click", () => {
		void toggleWorktree(project.id, worktree.path);
	});

	const heading = document.createElement("div");
	heading.className = "flex items-center gap-2";
	const branch = document.createElement("span");
	branch.className = "font-mono text-xs text-violet-300";
	branch.textContent = worktree.branch ?? "detached";
	const name = document.createElement("span");
	name.className = "text-sm";
	name.textContent = shortName(worktree.path);
	const stateText = document.createElement("span");
	stateText.className = "ml-auto text-[10px] text-slate-400 uppercase";
	stateText.textContent = state.opened ? "Tracking" : "Closed";
	heading.append(branch, name, stateText);
	button.appendChild(heading);

	const summary = document.createElement("div");
	summary.className = "text-[11px] text-slate-500";
	summary.textContent = worktree.path;
	row.append(button, summary);

	if (state.loading) {
		const loading = document.createElement("div");
		loading.className = "ml-3 text-xs text-slate-400";
		loading.textContent = "Syncing diff + file state...";
		row.appendChild(loading);
	}

	if (state.error) {
		const err = document.createElement("div");
		err.className = "ml-3 text-xs text-rose-400";
		err.textContent = state.error;
		row.appendChild(err);
	}

	if (state.opened && state.snapshot) {
		const details = document.createElement("div");
		details.className =
			"ml-3 mt-1 border-l border-slate-700 pl-3 text-xs text-slate-300";
		const header = document.createElement("div");
		header.className = "font-medium text-slate-100";
		header.textContent = `Monitoring: ${selectedWorktreeLabel()}`;
		const diffs = document.createElement("div");
		diffs.textContent = `${state.snapshot.diff.length} changed files (diff), ${state.snapshot.files.length} status entries`;
		details.append(header, diffs);
		row.appendChild(details);
	}

	return row;
}

function createSidebar(): HTMLElement {
	const sidebar = document.createElement("aside");
	sidebar.className = [
		"shrink-0 border-r border-slate-800 bg-slate-900 transition-all duration-200",
		appState.sidebarCollapsed ? "w-14" : "w-80",
	].join(" ");

	const header = document.createElement("div");
	header.className =
		"flex items-center justify-between gap-2 px-3 py-3 border-b border-slate-800";

	if (!appState.sidebarCollapsed) {
		const title = document.createElement("div");
		title.className = "text-xs uppercase tracking-widest text-slate-300";
		title.textContent = "Projects";
		header.appendChild(title);
	}

	const toggle = document.createElement("button");
	toggle.type = "button";
	toggle.className = "px-2 py-1 rounded-sm text-violet-200 hover:bg-slate-800";
	toggle.textContent = appState.sidebarCollapsed ? "☰" : "⟨";
	toggle.addEventListener("click", () => {
		appState.sidebarCollapsed = !appState.sidebarCollapsed;
		render();
	});
	header.appendChild(toggle);
	sidebar.appendChild(header);

	const body = document.createElement("div");
	body.className = "h-full overflow-y-auto py-2 space-y-1";

	if (appState.projects.length === 0) {
		const empty = document.createElement("div");
		empty.className = "px-3 text-sm text-slate-400";
		empty.textContent = "No projects in database.";
		body.appendChild(empty);
	} else {
		for (const project of appState.projects) {
			body.appendChild(createProjectNode(project));
		}
	}

	sidebar.appendChild(body);
	return sidebar;
}

function createChatArea(): HTMLElement {
	const chat = document.createElement("main");
	chat.className = "flex-1 bg-[#191919] flex flex-col min-h-0";

	const contextBar = document.createElement("div");
	contextBar.className = "border-b border-slate-800 px-6 py-3";
	const breadcrumb = document.createElement("div");
	breadcrumb.className = "text-[11px] text-slate-400 uppercase tracking-wider";
	breadcrumb.textContent = selectedProjectLabel();
	contextBar.appendChild(breadcrumb);

	const messages = document.createElement("section");
	messages.className = "flex-1 overflow-y-auto px-6 py-6 space-y-6";

	for (const line of appState.messageLines) {
		const row = document.createElement("div");
		row.className =
			line.speaker === "assistant"
				? "max-w-3xl"
				: "max-w-3xl ml-auto text-right";
		const tag = document.createElement("div");
		tag.className = "text-[11px] uppercase tracking-wider text-slate-500 mb-1";
		tag.textContent =
			line.speaker === "assistant" ? "Codex • Assistant" : "Local User";
		const bubble = document.createElement("div");
		bubble.className =
			line.speaker === "assistant"
				? "rounded-sm border border-slate-700 bg-slate-800 px-4 py-3 text-sm leading-relaxed"
				: "rounded-sm bg-violet-900/40 border border-violet-500/40 px-4 py-3 text-sm leading-relaxed";
		bubble.textContent = line.text;
		row.append(tag, bubble);
		messages.appendChild(row);
	}

	const footer = document.createElement("footer");
	footer.className = "border-t border-slate-800 p-4 bg-slate-900";
	const controls = document.createElement("div");
	controls.className = "max-w-4xl mx-auto flex items-end gap-3";

	const textarea = document.createElement("textarea");
	textarea.className =
		"min-h-24 w-full resize-y rounded-sm bg-transparent border border-slate-700 p-3 text-sm focus:outline-none focus:border-violet-400";
	textarea.placeholder = "Ask Codex to review, refactor, or debug...";
	textarea.value = appState.chatInput;
	textarea.addEventListener("input", (event) => {
		const target = event.currentTarget as HTMLTextAreaElement;
		appState.chatInput = target.value;
	});
	textarea.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			handleSendMessage();
		}
	});

	const send = document.createElement("button");
	send.type = "button";
	send.className =
		"h-10 px-4 rounded-sm bg-violet-500 text-violet-950 font-semibold disabled:opacity-60";
	send.textContent = appState.isSending ? "Streaming..." : "Send";
	send.disabled = appState.isSending;
	send.addEventListener("click", () => {
		handleSendMessage();
	});

	controls.append(textarea, send);
	footer.appendChild(controls);
	chat.append(contextBar, messages, footer);
	return chat;
}

function render(): void {
	const shell = document.createElement("div");
	shell.className = "min-h-screen flex flex-col bg-slate-950 text-slate-100";

	const breadcrumbBar = createHeader();
	const workspace = document.createElement("div");
	workspace.className = "flex flex-1 min-h-0";

	workspace.append(createSidebar(), createChatArea());
	shell.appendChild(breadcrumbBar);
	shell.appendChild(workspace);

	appRoot.replaceChildren(shell);
}

async function initialize(): Promise<void> {
	await refreshProjectsFromDb();
	render();
}

initialize().catch((error) => {
	render();
	appState.messageLines.push({
		speaker: "assistant",
		text: `Unable to initialize project tree: ${
			error instanceof Error ? error.message : String(error)
		}`,
	});
});
