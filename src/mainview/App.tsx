import {
	FormEvent,
	KeyboardEvent,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from "react";
import type {
	ProjectProcedures,
	RpcProject,
	RpcWorktree,
	RpcWorktreeSnapshot,
} from "../bun/rpc-schema";

type Message = {
	speaker: "assistant" | "user";
	text: string;
	isSuggestion?: boolean;
};

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

type ProjectStateMap = Record<number, ProjectNodeState>;
type WorktreeStateMap = Record<string, WorktreeNodeState>;

const initialMessages: Message[] = [
	{
		speaker: "assistant",
		text: "Neural context attached. Ask me about the selected project or worktree, and I will generate diffs, refactors, and command-safe patches.",
	},
];

function shortName(value: string): string {
	const normalized = value.replace(/[\\/]$/, "");
	const parts = normalized.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? value;
}

function worktreeKey(projectId: number, worktreePath: string): string {
	return `${projectId}::${worktreePath}`;
}

function defaultProjectState(): ProjectNodeState {
	return {
		expanded: false,
		worktrees: [],
		loadingWorktrees: false,
		error: "",
		openWorktrees: new Set(),
	};
}

function defaultWorktreeState(): WorktreeNodeState {
	return {
		loading: false,
		opened: false,
		error: "",
	};
}

function projectPathLabel(project: RpcProject | null): string {
	if (!project) {
		return "No project selected";
	}
	return `${project.name} · ${project.path}`;
}

function materialSymbol(name: string, className = ""): JSX.Element {
	return (
		<span className={`material-symbols-outlined ${className}`.trim()}>
			{name}
		</span>
	);
}

type AppProps = {
	procedures: ProjectProcedures;
};

declare global {
	interface Window {
		__jtIdeAppMountedAt?: number;
	}
}

export default function App({ procedures }: AppProps): JSX.Element {
	const [projects, setProjects] = useState<RpcProject[]>([]);
	const [projectStates, setProjectStates] = useState<ProjectStateMap>({});
	const [worktreeStates, setWorktreeStates] = useState<WorktreeStateMap>({});
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [mobileProjectListOpen, setMobileProjectListOpen] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
		null,
	);
	const [selectedWorktreePath, setSelectedWorktreePath] = useState<
		string | null
	>(null);
	const [messages, setMessages] = useState<Message[]>(initialMessages);
	const [chatInput, setChatInput] = useState("");
	const [isSending, setIsSending] = useState(false);

	const selectedProject = useMemo(() => {
		if (!selectedProjectId) {
			return null;
		}
		return projects.find((entry) => entry.id === selectedProjectId) ?? null;
	}, [projects, selectedProjectId]);

	const getProjectState = useCallback(
		(projectId: number): ProjectNodeState =>
			projectStates[projectId] ?? defaultProjectState(),
		[projectStates],
	);

	const getWorktreeState = useCallback(
		(projectId: number, worktreePath: string): WorktreeNodeState => {
			const key = worktreeKey(projectId, worktreePath);
			return worktreeStates[key] ?? defaultWorktreeState();
		},
		[worktreeStates],
	);

	const setProjectState = useCallback(
		(projectId: number, update: Partial<ProjectNodeState>): void => {
			setProjectStates((prev) => {
				const next = {
					...prev,
				} as ProjectStateMap;
				next[projectId] = {
					...(next[projectId] ?? defaultProjectState()),
					...update,
				};
				return next;
			});
		},
		[],
	);

	const setWorktreeState = useCallback(
		(
			projectId: number,
			worktreePath: string,
			update: Partial<WorktreeNodeState>,
		): void => {
			const key = worktreeKey(projectId, worktreePath);
			setWorktreeStates((prev) => {
				const next = {
					...prev,
				} as WorktreeStateMap;
				next[key] = {
					...(next[key] ?? defaultWorktreeState()),
					...update,
				};
				return next;
			});
		},
		[],
	);

	const hydrateProjectRows = useCallback((items: RpcProject[]) => {
		setProjectStates((prev) => {
			const next = { ...prev } as ProjectStateMap;
			for (const item of items) {
				if (!next[item.id]) {
					next[item.id] = defaultProjectState();
				}
			}
			return next;
		});
	}, []);

	const initialize = useCallback(async () => {
		const loaded = await procedures.listProjects({ includeClosed: true });
		setProjects(loaded);
		hydrateProjectRows(loaded);
		if (!selectedProjectId && loaded[0]) {
			setSelectedProjectId(loaded[0].id);
		}
	}, [hydrateProjectRows, procedures, selectedProjectId]);

	const refreshProject = useCallback(
		async (project: RpcProject) => {
			const current = getProjectState(project.id);
			const expanded = !current.expanded;
			setProjectState(project.id, {
				expanded,
				loadingWorktrees: expanded,
				error: "",
			});

			if (!expanded) {
				const removed = [...current.openWorktrees];
				for (const path of removed) {
					try {
						await procedures.closeWorktree({
							projectId: project.id,
							worktreePath: path,
						});
					} catch {
						// best effort
					}
				}
				setWorktreeStates((prev) => {
					const next = { ...prev } as WorktreeStateMap;
					for (const path of removed) {
						delete next[worktreeKey(project.id, path)];
					}
					return next;
				});
				setProjectState(project.id, {
					expanded: false,
					openWorktrees: new Set(),
					loadingWorktrees: false,
				});
				try {
					await procedures.closeProject({ projectId: project.id });
				} catch {
					// best effort
				}
				if (
					topProjectPath(selectedWorktreePath) &&
					recordedWorktreeSelection(selectedProjectId, project.id)
				) {
					setSelectedWorktreePath(null);
				}
				return;
			}

			try {
				const result = await procedures.openProject({
					projectPath: project.path,
					name: project.name,
				});
				setProjectState(project.id, {
					worktrees: result.worktrees,
					loadingWorktrees: false,
					error: "",
				});
				if (!selectedProjectId) {
					setSelectedProjectId(project.id);
				}
			} catch (error) {
				setProjectState(project.id, {
					expanded: false,
					loadingWorktrees: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[
			getProjectState,
			selectedProjectId,
			setProjectState,
			procedures,
			selectedWorktreePath,
			selectedProjectId,
		],
	);

	const openOrCloseWorktree = useCallback(
		async (projectId: number, worktreePath: string) => {
			const target = getWorktreeState(projectId, worktreePath);
			const projectState = getProjectState(projectId);
			setWorktreeState(projectId, worktreePath, {
				loading: true,
				error: "",
			});

			if (target.opened) {
				try {
					await procedures.closeWorktree({ projectId, worktreePath });
					setWorktreeState(projectId, worktreePath, {
						opened: false,
						snapshot: undefined,
						loading: false,
					});
					setProjectState(projectId, {
						openWorktrees: new Set(
							[...projectState.openWorktrees].filter(
								(item) => item !== worktreePath,
							),
						),
					});
					if (selectedWorktreePath === worktreePath) {
						setSelectedWorktreePath(null);
					}
				} catch {
					setWorktreeState(projectId, worktreePath, {
						loading: false,
						error: "Unable to stop worktree polling.",
					});
				}
				return;
			}

			try {
				const result = await procedures.openWorktree({
					projectId,
					worktreePath,
				});
				setWorktreeState(projectId, worktreePath, {
					loading: false,
					opened: true,
					snapshot: result.worktree,
					error: "",
				});
				setProjectState(projectId, {
					openWorktrees: new Set([...projectState.openWorktrees, worktreePath]),
				});
				setSelectedProjectId(projectId);
				setSelectedWorktreePath(worktreePath);
			} catch (error) {
				setWorktreeState(projectId, worktreePath, {
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[
			getProjectState,
			getWorktreeState,
			procedures,
			selectedWorktreePath,
			setProjectState,
			setWorktreeState,
		],
	);

	const postMessage = useCallback(() => {
		const text = chatInput.trim();
		if (!text || isSending) {
			return;
		}

		setMessages((prev) => [...prev, { speaker: "user", text }]);
		setChatInput("");
		setIsSending(true);
		setTimeout(() => {
			setMessages((prev) => [
				...prev,
				{
					speaker: "assistant",
					text: `Queued action against ${
						selectedWorktreePath
							? shortName(selectedWorktreePath)
							: projectPathLabel(selectedProject)
					}.`,
					isSuggestion: true,
				},
			]);
			setIsSending(false);
		}, 500);
	}, [chatInput, isSending, selectedProject, selectedWorktreePath]);

	const onSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			postMessage();
		},
		[postMessage],
	);

	const onEnter = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && !event.shiftKey) {
				event.preventDefault();
				postMessage();
			}
		},
		[postMessage],
	);

	const renderDesktopMessages = messages.map((message, index) => {
		if (message.isSuggestion) {
			return (
				<div
					key={`${message.speaker}-${index}`}
					className="flex gap-6 bg-[#262626]/30 backdrop-blur-xl p-6 rounded-lg border border-[#484848]/10"
				>
					<div className="w-8 h-8 rounded-sm bg-[#fb81ae]/20 flex items-center justify-center shrink-0">
						{materialSymbol("auto_awesome", "text-[#ff96bb] text-sm")}
					</div>
					<div className="flex-1 space-y-4">
						<div className="font-label text-[10px] uppercase tracking-wider text-[#ff96bb] font-bold">
							Suggested Refactor
						</div>
						<p className="text-sm text-[#adabaa]">{message.text}</p>
						<div className="flex gap-3">
							<button
								type="button"
								className="px-4 py-2 bg-gradient-to-r from-[#948def] to-[#aaa4ff] text-[#281d7c] font-label text-[10px] font-bold uppercase tracking-wider rounded-sm hover:opacity-90 transition-opacity"
							>
								Execute Refactor
							</button>
							<button
								type="button"
								className="px-4 py-2 bg-[#262626] text-[#f2f0ef] font-label text-[10px] font-bold uppercase tracking-wider rounded-sm hover:text-[#aaa4ff] transition-colors"
							>
								Discard
							</button>
						</div>
					</div>
				</div>
			);
		}

		if (message.speaker === "assistant") {
			return (
				<div className="flex gap-6 group" key={`${message.speaker}-${index}`}>
					<div className="w-8 h-8 rounded-sm bg-[#9c95f8] flex items-center justify-center shrink-0">
						<span
							className="material-symbols-outlined text-[#1b0a71] text-sm"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							psychology
						</span>
					</div>
					<div className="flex-1 space-y-4">
						<div className="font-label text-[10px] uppercase tracking-widest text-[#aaa4ff] font-bold">
							Codex • Assistant
						</div>
						<div className="text-[#ffffff] leading-relaxed text-sm">
							{message.text}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div
				className="flex gap-6 justify-end"
				key={`${message.speaker}-${index}`}
			>
				<div className="flex-1 text-right space-y-2 max-w-2xl">
					<div className="font-label text-[10px] uppercase tracking-widest text-[#adabaa] font-bold">
						Local User
					</div>
					<div className="bg-[#262626] inline-block p-4 rounded-sm text-sm text-[#ffffff] text-left">
						{message.text}
					</div>
				</div>
				<div className="w-8 h-8 rounded-sm bg-[#262626] flex items-center justify-center shrink-0">
					{materialSymbol("person")}
				</div>
			</div>
		);
	});

	const renderMobileMessages = messages.map((message, index) => {
		if (message.speaker === "assistant") {
			return (
				<div
					className="flex flex-col items-start gap-3 max-w-full"
					key={`${message.speaker}-${index}`}
				>
					<div className="flex items-center gap-2 text-[#aaa4ff] px-1">
						<span
							className="material-symbols-outlined text-sm"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							hub
						</span>
						<span className="text-[10px] font-label uppercase tracking-wider font-bold">
							Intelligence
						</span>
					</div>
					<div className="glass-panel p-5 rounded-lg border border-[#aaa4ff]/10 w-full flex flex-col gap-4">
						<p className="text-sm leading-relaxed text-[#ffffff]">
							{message.text}
						</p>
					</div>
				</div>
			);
		}

		return (
			<div
				className="flex flex-col items-end gap-2 max-w-[90%] self-end"
				key={`${message.speaker}-${index}`}
			>
				<div className="flex items-center gap-2 text-[#adabaa] px-1">
					<span className="text-[10px] font-label uppercase">User</span>
					<span className="material-symbols-outlined text-xs">
						account_circle
					</span>
				</div>
				<div className="bg-[#1f2020] p-4 rounded-lg rounded-tr-none text-sm leading-relaxed text-[#ffffff] shadow-sm">
					{message.text}
				</div>
			</div>
		);
	});

	const projectTree = (
		<div className="space-y-2">
			{projects.length === 0 ? (
				<div className="px-3 text-sm text-[#a7a7a7]">
					No projects in database.
				</div>
			) : (
				projects.map((project) => {
					const state = getProjectState(project.id);
					const isActive = selectedProjectId === project.id;
					return (
						<div className="space-y-1" key={project.id}>
							<button
								type="button"
								className={`w-full px-3 py-2 rounded-sm flex items-center gap-2 text-left transition-colors ${
									isActive
										? "bg-[#262626] text-[#aaa4ff]"
										: "text-[#d7d7d7] hover:bg-[#1f2020]"
								}`}
								onClick={() => {
									void refreshProject(project);
									if (!isActive) {
										setSelectedProjectId(project.id);
									}
								}}
							>
								<span className="text-sm">{state.expanded ? "▾" : "▸"}</span>
								<span
									className={`w-2 h-2 rounded-full ${
										project.isOpen ? "bg-[#4fefb2]" : "bg-[#5f5f5f]"
									}`}
								/>
								<div className="font-medium text-sm truncate">
									{project.name}
								</div>
							</button>

							{state.expanded && !sidebarCollapsed ? (
								<div className="ml-3 space-y-1">
									{state.loadingWorktrees ? (
										<div className="text-xs text-[#a8a6a4] px-2 py-1">
											Loading worktrees...
										</div>
									) : null}
									{state.error ? (
										<div className="text-xs text-[#ff6e84] px-2 py-1">
											{state.error}
										</div>
									) : null}
									{state.worktrees.length === 0 ? (
										<div className="text-xs text-[#8f8d8b] px-2 py-1">
											No worktrees found.
										</div>
									) : null}
									{state.worktrees.map((worktree) => {
										const wState = getWorktreeState(project.id, worktree.path);
										return (
											<button
												type="button"
												key={worktree.path}
												className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
													wState.opened
														? "bg-[#1f2020] text-[#f2f0ef]"
														: "text-[#cfd1d4] hover:bg-[#202020]"
												}`}
												onClick={() => {
													void openOrCloseWorktree(project.id, worktree.path);
													setSelectedProjectId(project.id);
													if (!sidebarCollapsed) {
														setSelectedWorktreePath(worktree.path);
													}
												}}
											>
												<div className="flex items-center gap-2">
													<span className="font-mono text-xs text-[#948def]">
														{worktree.branch ?? "detached"}
													</span>
													<span className="text-sm">
														{shortName(worktree.path)}
													</span>
													<span className="ml-auto text-[10px] uppercase tracking-wide text-[#adabaa]">
														{wState.opened ? "Tracking" : "Closed"}
													</span>
												</div>
												{wState.loading ? (
													<div className="text-xs text-[#8f8d8b]">
														Syncing diff + file state...
													</div>
												) : null}
												{wState.error ? (
													<div className="text-xs text-[#ff6e84]">
														{wState.error}
													</div>
												) : null}
											</button>
										);
									})}
								</div>
							) : null}
						</div>
					);
				})
			)}
		</div>
	);

	useEffect(() => {
		void initialize();
	}, [initialize]);

	useEffect(() => {
		window.__jtIdeAppMountedAt = Date.now();
		console.log("App.tsx mounted", window.__jtIdeAppMountedAt);
	}, []);

	return (
		<div className="min-h-screen bg-[#0e0e0e] text-[#ffffff]">
			<div className="hidden md:flex flex-col min-h-screen">
				<header className="flex justify-between items-center w-full px-6 h-14 bg-[#131313] border-b border-[#262626] z-50">
					<div className="flex items-center gap-8">
						<h1 className="text-xl font-black tracking-tighter text-[#aaa4ff]">
							The Monolithic Intelligence
						</h1>
						<nav className="flex items-center gap-6">
							<button
								type="button"
								className="font-label text-xs uppercase tracking-wider text-[#adabaa] hover:text-[#f2f0ef] transition-colors duration-200"
							>
								File Tree
							</button>
							<button
								type="button"
								className="font-label text-xs uppercase tracking-wider text-[#aaa4ff] border-b-2 border-[#7c4dff] pb-1"
							>
								Codex
							</button>
							<button
								type="button"
								className="font-label text-xs uppercase tracking-wider text-[#adabaa] hover:text-[#f2f0ef] transition-colors duration-200"
							>
								Diff
							</button>
							<button
								type="button"
								className="font-label text-xs uppercase tracking-wider text-[#adabaa] hover:text-[#f2f0ef] transition-colors duration-200"
							>
								Tasks
							</button>
						</nav>
					</div>
					<div className="flex items-center gap-4">
						{materialSymbol(
							"account_circle",
							"text-on-surface-variant hover:bg-[#262626] p-2 rounded transition-all",
						)}
						{materialSymbol(
							"settings",
							"text-on-surface-variant hover:bg-[#262626] p-2 rounded transition-all",
						)}
					</div>
				</header>

				<div className="h-10 bg-[#131313] flex items-center px-6 gap-2">
					<span className="font-label text-xs font-bold text-[#aaa4ff]">
						{selectedProject?.name ?? "No project selected"}
					</span>
					<span className="text-on-surface-variant/40 text-xs">—</span>
					<span className="font-label text-xs text-[#f2f0ef]">
						{selectedProject?.path ?? "/"}
					</span>
					{selectedWorktreePath ? (
						<>
							<span className="text-on-surface-variant/40 text-xs">—</span>
							<span className="font-label text-xs text-[#adabaa]">
								{shortName(selectedWorktreePath)}
							</span>
						</>
					) : null}
				</div>

				<main className="flex flex-1 min-h-0">
					<aside
						className={`shrink-0 border-r border-[#262626] bg-[#131313] transition-all duration-300 ${
							sidebarCollapsed ? "w-14" : "w-80"
						}`}
					>
						<div className="flex items-center justify-between px-3 py-3 border-b border-[#262626]">
							{!sidebarCollapsed ? (
								<div className="text-xs uppercase tracking-widest text-[#d8d8d8]">
									Projects
								</div>
							) : null}
							<button
								type="button"
								className="px-2 py-1 rounded-sm text-[#aaa4ff] hover:bg-[#202020]"
								onClick={() => setSidebarCollapsed((value) => !value)}
							>
								{sidebarCollapsed ? "☰" : "⟨"}
							</button>
						</div>
						<div className="h-full overflow-y-auto py-2">{projectTree}</div>
					</aside>

					<section className="flex-1 bg-[#0e0e0e] flex flex-col min-h-0">
						<div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 hide-scrollbar">
							<div className="max-w-4xl mx-auto mb-12">
								<h1 className="font-headline text-4xl font-extrabold tracking-tight text-[#ffffff] mb-2">
									Codex Intelligence
								</h1>
								<p className="font-body text-[#adabaa] max-w-xl">
									Deep contextual reasoning active. Project indexing complete.
								</p>
							</div>
							<div className="max-w-4xl mx-auto">{renderDesktopMessages}</div>
						</div>
						<form
							className="bg-[#131313] border-t border-[#262626] p-6"
							onSubmit={onSubmit}
						>
							<div className="max-w-4xl mx-auto">
								<div className="flex items-center gap-2 p-2 border-b border-[#484848]/10">
									<div className="flex items-center bg-[#131313] px-3 py-1.5 rounded-sm gap-2 cursor-pointer hover:bg-[#262626] transition-colors">
										{materialSymbol("neurology", "text-[#948def] text-[16px]")}
										<span className="font-label text-[10px] uppercase font-bold text-[#f2f0ef]">
											Model: Mono-X-Large
										</span>
									</div>
									<div className="flex items-center bg-[#191a1a] px-3 py-1.5 rounded-sm gap-2 cursor-pointer hover:bg-[#262626] transition-colors">
										{materialSymbol("checklist", "text-[#ff96bb] text-[16px]")}
										<span className="font-label text-[10px] uppercase font-bold text-[#f2f0ef]">
											Active Tasks (4)
										</span>
									</div>
									<div className="flex-1" />
									<span className="font-label text-[10px] text-[#adabaa] uppercase tracking-widest opacity-50">
										842 Tokens
									</span>
								</div>
								<div className="relative flex items-end p-4 gap-4 border border-[#2b2b2b] bg-[#262626] rounded-sm">
									<textarea
										className="flex-1 bg-transparent border-none focus:ring-0 text-sm placeholder:text-[#adabaa]/50 resize-none font-body"
										placeholder="Ask Codex to generate, refactor, or debug..."
										rows={3}
										value={chatInput}
										onChange={(event) =>
											setChatInput(event.currentTarget.value)
										}
										onKeyDown={onEnter}
									/>
									<button
										type="submit"
										className="w-10 h-10 flex items-center justify-center bg-[#aaa4ff] rounded-sm text-[#281d7c] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
										disabled={isSending}
									>
										<span
											className="material-symbols-outlined"
											style={{ fontVariationSettings: "'wght' 700" }}
										>
											arrow_forward
										</span>
									</button>
								</div>
							</div>
						</form>
					</section>
				</main>
			</div>

			<div className="md:hidden min-h-screen">
				<header className="fixed top-0 w-full z-50 bg-[#0e0e0e] flex items-center justify-between px-4 h-14">
					<div className="flex items-center gap-3">
						<button
							type="button"
							className="material-symbols-outlined text-[#aaa4ff]"
							onClick={() => setMobileProjectListOpen((value) => !value)}
						>
							menu
						</button>
						<h1 className="font-headline tracking-wider uppercase text-sm font-bold text-[#aaa4ff]">
							Monolithic IDE
						</h1>
					</div>
					<div className="flex items-center gap-3">
						{materialSymbol("search", "text-on-surface-variant")}
					</div>
				</header>

				{mobileProjectListOpen ? (
					<aside className="fixed inset-x-0 top-14 z-40 h-[68vh] overflow-y-auto bg-[#191a1a] border-b border-[#3f3f3f] p-3">
						{projectTree}
					</aside>
				) : null}

				<main className="pt-14 pb-52 min-h-screen px-4 flex flex-col gap-6 max-w-2xl mx-auto">
					<div className="mt-6">
						<div className="flex items-center gap-2 mb-1">
							<span className="text-[10px] font-label uppercase tracking-widest text-[#aaa4ff]">
								Active Session
							</span>
							<div className="h-[1px] flex-grow bg-[#262626]" />
						</div>
						<h2 className="text-2xl font-headline font-extrabold tracking-tight">
							{selectedProject?.name ?? "No project selected"}
						</h2>
						<p className="text-xs text-[#adabaa] mt-1">
							{selectedWorktreePath
								? shortName(selectedWorktreePath)
								: "Main branch context"}
						</p>
					</div>
					<div className="flex-1 overflow-y-auto flex flex-col gap-8 hide-scrollbar pb-6">
						{renderMobileMessages}
					</div>
				</main>

				<div className="fixed bottom-16 left-0 right-0 px-4 pb-4 z-40">
					<form
						className="max-w-2xl mx-auto flex flex-col gap-3"
						onSubmit={onSubmit}
					>
						<div className="flex items-center gap-2">
							<button
								type="button"
								className="flex items-center gap-2 bg-[#191a1a] px-3 py-1.5 rounded-full border border-[#484848]/20 hover:bg-[#262626] transition-colors"
							>
								{materialSymbol("auto_awesome", "text-[#aaa4ff] text-sm")}
								<span className="text-[10px] font-label uppercase tracking-widest font-bold">
									GPT-4 Turbo
								</span>
							</button>
							<button
								type="button"
								className="flex items-center gap-2 bg-[#191a1a] px-3 py-1.5 rounded-full border border-[#484848]/20 hover:bg-[#262626] transition-colors"
							>
								{materialSymbol("checklist", "text-on-surface-variant text-sm")}
								<span className="text-[10px] font-label uppercase tracking-widest">
									Tasks
								</span>
							</button>
						</div>
						<div className="relative flex items-end gap-2 bg-[#191a1a] p-2 rounded-xl shadow-2xl border border-[#484848]/10">
							<textarea
								className="flex-grow bg-transparent border-none focus:ring-0 text-sm py-2 px-2 resize-none text-[#ffffff] placeholder:text-[#adabaa]/50"
								placeholder="Ask intelligence..."
								rows={1}
								value={chatInput}
								onChange={(event) => setChatInput(event.currentTarget.value)}
								onKeyDown={onEnter}
							/>
							<button
								className="bg-gradient-to-tr from-[#aaa4ff] to-[#9c95f8] text-[#1b0a71] p-2 rounded-lg shadow-lg active:scale-95 transition-transform flex items-center justify-center"
								type="submit"
								disabled={isSending}
							>
								{materialSymbol("arrow_upward")}
							</button>
						</div>
					</form>
				</div>

				<div className="fixed bottom-0 left-0 w-full z-50">
					<div className="w-full h-1 bg-[#000000]">
						<div className="h-full bg-[#aaa4ff]/40 w-[68%] relative overflow-hidden">
							<div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent" />
						</div>
					</div>
					<nav className="bg-[#0e0e0e] flex justify-around items-center h-16">
						<div className="flex flex-col items-center justify-center text-[#adabaa] pt-2 hover:text-[#f2f0ef] transition-colors">
							{materialSymbol("code", "pt-1")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								File
							</span>
						</div>
						<div className="flex flex-col items-center justify-center text-[#aaa4ff] font-bold border-t-2 border-[#aaa4ff] pt-2">
							{materialSymbol("forum", "text-sm")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								AI Chat
							</span>
						</div>
						<div className="flex flex-col items-center justify-center text-[#adabaa] pt-2 hover:text-[#f2f0ef] transition-colors">
							{materialSymbol("difference")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								Diff
							</span>
						</div>
						<div className="flex flex-col items-center justify-center text-[#adabaa] pt-2 hover:text-[#f2f0ef] transition-colors">
							{materialSymbol("checklist")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								Tasks
							</span>
						</div>
					</nav>
				</div>
			</div>
		</div>
	);
}

function recordedWorktreeSelection(
	current: number | null,
	target: number,
): boolean {
	return current !== target;
}

function topProjectPath(value: string | null): boolean {
	return value !== null && value !== "";
}
