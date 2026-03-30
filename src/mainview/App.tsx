import {
	type FormEvent,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
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
type ProjectActionMenuState = {
	projectId: number;
	x: number;
	y: number;
};

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

function findPrimaryWorktree(
	project: RpcProject,
	worktrees: RpcWorktree[],
): RpcWorktree | null {
	return worktrees.find((worktree) => worktree.path === project.path) ?? null;
}

function primaryWorktreePath(
	project: RpcProject,
	worktrees: RpcWorktree[],
): string {
	return findPrimaryWorktree(project, worktrees)?.path ?? project.path;
}

function orderProjectWorktrees(
	project: RpcProject,
	worktrees: RpcWorktree[],
): RpcWorktree[] {
	const primaryPath = primaryWorktreePath(project, worktrees);
	return [...worktrees].sort((left, right) => {
		if (left.path === primaryPath && right.path !== primaryPath) {
			return -1;
		}
		if (right.path === primaryPath && left.path !== primaryPath) {
			return 1;
		}
		return 0;
	});
}

function worktreeDisplayName(worktree: RpcWorktree | null): string {
	return worktree?.branch ?? "Primary";
}

function materialSymbol(name: string, className = ""): JSX.Element {
	return (
		<span className={`material-symbols-outlined ${className}`.trim()}>
			{name}
		</span>
	);
}

function formatPathForDisplay(
	value: string,
	homeDirectory: string,
	supportsTildePath: boolean,
): string {
	if (!supportsTildePath || !homeDirectory) {
		return value;
	}
	if (value === homeDirectory) {
		return "~";
	}
	const homeDirectoryPrefix = `${homeDirectory}/`;
	if (value.startsWith(homeDirectoryPrefix)) {
		return `~/${value.slice(homeDirectoryPrefix.length)}`;
	}
	return value;
}

function pathSeparator(value: string): string {
	return value.includes("\\") ? "\\" : "/";
}

function ensureTrailingSeparator(value: string): string {
	if (!value || /[\\/]$/.test(value)) {
		return value;
	}
	return `${value}${pathSeparator(value)}`;
}

function formatDirectoryPathForInput(
	value: string,
	homeDirectory: string,
	supportsTildePath: boolean,
): string {
	return ensureTrailingSeparator(
		formatPathForDisplay(value, homeDirectory, supportsTildePath),
	);
}

function clampProjectMenuCoordinate(
	value: number,
	viewportSize: number,
	menuSize: number,
): number {
	return Math.max(12, Math.min(value, viewportSize - menuSize - 12));
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
	const [homeDirectory, setHomeDirectory] = useState("");
	const [supportsTildePath, setSupportsTildePath] = useState(false);
	const [addProjectOpen, setAddProjectOpen] = useState(false);
	const [projectActionMenu, setProjectActionMenu] =
		useState<ProjectActionMenuState | null>(null);
	const [projectActionMenuLoading, setProjectActionMenuLoading] =
		useState(false);
	const [projectActionMenuError, setProjectActionMenuError] = useState("");
	const [newWorktreeName, setNewWorktreeName] = useState("");
	const [addProjectPath, setAddProjectPath] = useState("");
	const [addProjectError, setAddProjectError] = useState("");
	const [directorySuggestions, setDirectorySuggestions] = useState<string[]>(
		[],
	);
	const [directorySuggestionsLoading, setDirectorySuggestionsLoading] =
		useState(false);
	const [isAddingProject, setIsAddingProject] = useState(false);
	const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
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
	const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
	const projectActionMenuRequestId = useRef(0);

	const selectedProject = useMemo(() => {
		if (!selectedProjectId) {
			return null;
		}
		return projects.find((entry) => entry.id === selectedProjectId) ?? null;
	}, [projects, selectedProjectId]);

	const projectActionMenuProject = useMemo(() => {
		if (!projectActionMenu) {
			return null;
		}
		return (
			projects.find((project) => project.id === projectActionMenu.projectId) ??
			null
		);
	}, [projectActionMenu, projects]);

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

	const projectActionMenuWorktrees = useMemo(() => {
		if (!projectActionMenuProject) {
			return [];
		}
		return orderProjectWorktrees(
			projectActionMenuProject,
			getProjectState(projectActionMenuProject.id).worktrees,
		);
	}, [getProjectState, projectActionMenuProject]);

	const selectProject = useCallback(
		(project: RpcProject, worktreePath?: string | null): void => {
			setSelectedProjectId(project.id);
			setSelectedWorktreePath(
				worktreePath ??
					primaryWorktreePath(project, getProjectState(project.id).worktrees),
			);
		},
		[getProjectState],
	);

	const selectedProjectWorktrees = useMemo(() => {
		if (!selectedProject) {
			return [];
		}
		return orderProjectWorktrees(
			selectedProject,
			getProjectState(selectedProject.id).worktrees,
		);
	}, [selectedProject, getProjectState]);

	const activeSelectedWorktreePath = useMemo(() => {
		if (!selectedProject) {
			return null;
		}
		if (
			selectedWorktreePath &&
			(selectedWorktreePath === selectedProject.path ||
				selectedProjectWorktrees.some(
					(worktree) => worktree.path === selectedWorktreePath,
				))
		) {
			return selectedWorktreePath;
		}
		return primaryWorktreePath(selectedProject, selectedProjectWorktrees);
	}, [selectedProject, selectedProjectWorktrees, selectedWorktreePath]);

	const activeSelectedWorktree = useMemo(() => {
		if (!selectedProject || !activeSelectedWorktreePath) {
			return null;
		}
		return (
			selectedProjectWorktrees.find(
				(worktree) => worktree.path === activeSelectedWorktreePath,
			) ?? findPrimaryWorktree(selectedProject, selectedProjectWorktrees)
		);
	}, [activeSelectedWorktreePath, selectedProject, selectedProjectWorktrees]);

	const activeSelectedWorktreeFolder = useMemo(() => {
		if (!activeSelectedWorktreePath) {
			return "No worktree selected";
		}
		return shortName(activeSelectedWorktreePath);
	}, [activeSelectedWorktreePath]);

	const activeSelectedWorktreeName = useMemo(() => {
		if (!selectedProject) {
			return "";
		}
		return worktreeDisplayName(activeSelectedWorktree);
	}, [activeSelectedWorktree, selectedProject]);

	const isActiveWorktree = useCallback(
		(projectId: number, worktreePath: string): boolean =>
			selectedProjectId === projectId &&
			activeSelectedWorktreePath === worktreePath,
		[activeSelectedWorktreePath, selectedProjectId],
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

	const clearProjectState = useCallback((projectId: number) => {
		setProjectStates((prev) => {
			const next = { ...prev } as ProjectStateMap;
			delete next[projectId];
			return next;
		});
		setWorktreeStates((prev) => {
			const next = { ...prev } as WorktreeStateMap;
			for (const key of Object.keys(next)) {
				if (key.startsWith(`${projectId}::`)) {
					delete next[key];
				}
			}
			return next;
		});
	}, []);

	const loadProjectWorktrees = useCallback(
		async (projectId: number): Promise<RpcWorktree[]> => {
			const result = await procedures.listProjectWorktrees({ projectId });
			setProjectState(projectId, {
				worktrees: result.worktrees,
				error: "",
			});
			return result.worktrees;
		},
		[procedures, setProjectState],
	);

	const resetAddProjectPath = useCallback(
		(nextPath?: string) => {
			setAddProjectPath(
				formatDirectoryPathForInput(
					nextPath ?? homeDirectory,
					homeDirectory,
					supportsTildePath,
				),
			);
		},
		[homeDirectory, supportsTildePath],
	);

	const initialize = useCallback(async () => {
		const [loaded, homeDirectoryResult] = await Promise.all([
			procedures.listProjects({ includeClosed: true }),
			procedures.getHomeDirectory(),
		]);
		setProjects(loaded);
		hydrateProjectRows(loaded);
		setHomeDirectory(homeDirectoryResult.homeDirectory);
		setSupportsTildePath(homeDirectoryResult.supportsTildePath);
		setAddProjectPath(
			(current) =>
				current ||
				formatDirectoryPathForInput(
					homeDirectoryResult.homeDirectory,
					homeDirectoryResult.homeDirectory,
					homeDirectoryResult.supportsTildePath,
				),
		);
		setSelectedProjectId((current) => current ?? loaded[0]?.id ?? null);
		setSelectedWorktreePath((current) => current ?? loaded[0]?.path ?? null);
	}, [hydrateProjectRows, procedures]);

	const closeAddProjectForm = useCallback(() => {
		setAddProjectOpen(false);
		setAddProjectError("");
		resetAddProjectPath();
	}, [resetAddProjectPath]);

	const toggleAddProjectForm = useCallback(() => {
		setAddProjectError("");
		setAddProjectOpen((current) => {
			const nextOpen = !current;
			if (nextOpen && !addProjectPath && homeDirectory) {
				setAddProjectPath(
					formatDirectoryPathForInput(
						homeDirectory,
						homeDirectory,
						supportsTildePath,
					),
				);
			}
			return nextOpen;
		});
	}, [addProjectPath, homeDirectory, supportsTildePath]);

	const closeProjectActionMenu = useCallback(() => {
		setProjectActionMenu(null);
		setProjectActionMenuError("");
		setProjectActionMenuLoading(false);
		setNewWorktreeName("");
	}, []);

	const openProjectActionMenu = useCallback(
		async (project: RpcProject, x: number, y: number) => {
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;
			const requestId = ++projectActionMenuRequestId.current;

			setProjectActionMenu({
				projectId: project.id,
				x: clampProjectMenuCoordinate(x, viewportWidth, 336),
				y: clampProjectMenuCoordinate(y, viewportHeight, 420),
			});
			setProjectActionMenuError("");
			setProjectActionMenuLoading(true);
			setNewWorktreeName("");

			try {
				await loadProjectWorktrees(project.id);
				if (projectActionMenuRequestId.current === requestId) {
					setProjectActionMenuLoading(false);
				}
			} catch (error) {
				if (projectActionMenuRequestId.current === requestId) {
					setProjectActionMenuError(
						error instanceof Error ? error.message : String(error),
					);
					setProjectActionMenuLoading(false);
				}
			}
		},
		[loadProjectWorktrees],
	);

	const deleteTrackedProject = useCallback(
		async (projectId: number) => {
			try {
				await procedures.deleteProject({ projectId });
				const loaded = await procedures.listProjects({ includeClosed: true });
				setProjects(loaded);
				hydrateProjectRows(loaded);
				clearProjectState(projectId);
				setSelectedProjectId((current) => {
					if (current && loaded.some((project) => project.id === current)) {
						return current;
					}
					return loaded[0]?.id ?? null;
				});
				if (selectedProjectId === projectId) {
					setSelectedWorktreePath(loaded[0]?.path ?? null);
				}
				setProjectActionMenu((current) =>
					current?.projectId === projectId ? null : current,
				);
				setProjectActionMenuError("");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (projectActionMenu?.projectId === projectId) {
					setProjectActionMenuError(message);
				} else {
					setProjectState(projectId, { error: message });
				}
			}
		},
		[
			clearProjectState,
			hydrateProjectRows,
			procedures,
			projectActionMenu,
			selectedProjectId,
			setProjectState,
		],
	);

	const submitNewWorktree = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!projectActionMenu || isCreatingWorktree) {
				return;
			}

			const name = newWorktreeName.trim();
			if (!name) {
				setProjectActionMenuError("Enter a worktree name.");
				return;
			}

			setIsCreatingWorktree(true);
			setProjectActionMenuError("");
			try {
				const result = await procedures.createWorktree({
					projectId: projectActionMenu.projectId,
					name,
				});
				setProjectState(projectActionMenu.projectId, {
					worktrees: result.worktrees,
					error: "",
				});
				setNewWorktreeName("");
			} catch (error) {
				setProjectActionMenuError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsCreatingWorktree(false);
			}
		},
		[
			isCreatingWorktree,
			newWorktreeName,
			procedures,
			projectActionMenu,
			setProjectState,
		],
	);

	useEffect(() => {
		if (!projectActionMenu) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (
				projectActionMenuRef.current &&
				!projectActionMenuRef.current.contains(event.target as Node)
			) {
				closeProjectActionMenu();
			}
		};

		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				closeProjectActionMenu();
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [closeProjectActionMenu, projectActionMenu]);

	useEffect(() => {
		if (projectActionMenu && !projectActionMenuProject) {
			closeProjectActionMenu();
		}
	}, [closeProjectActionMenu, projectActionMenu, projectActionMenuProject]);

	useEffect(() => {
		if (!addProjectOpen) {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			return;
		}

		const query = addProjectPath.trim();
		if (!query) {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			return;
		}

		let cancelled = false;
		setDirectorySuggestions([]);
		setDirectorySuggestionsLoading(true);
		void (async () => {
			try {
				const result = await procedures.listDirectorySuggestions({ query });
				if (!cancelled) {
					setDirectorySuggestions(result.directories);
				}
			} catch {
				if (!cancelled) {
					setDirectorySuggestions([]);
				}
			} finally {
				if (!cancelled) {
					setDirectorySuggestionsLoading(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [addProjectOpen, addProjectPath, procedures]);

	const selectDirectorySuggestion = useCallback(
		(directory: string) => {
			setAddProjectError("");
			setAddProjectPath(
				formatDirectoryPathForInput(
					directory,
					homeDirectory,
					supportsTildePath,
				),
			);
		},
		[homeDirectory, supportsTildePath],
	);

	const submitAddProject = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (isAddingProject) {
				return;
			}

			const projectPath = addProjectPath.trim();
			if (!projectPath) {
				setAddProjectError("Enter the project folder path.");
				return;
			}

			setIsAddingProject(true);
			setAddProjectError("");
			try {
				const result = await procedures.openProject({ projectPath });
				const loaded = await procedures.listProjects({ includeClosed: true });
				const existingState = getProjectState(result.project.id);
				setProjects(loaded);
				hydrateProjectRows(loaded);
				setProjectState(result.project.id, {
					expanded: true,
					loadingWorktrees: false,
					error: "",
					worktrees: result.worktrees,
					openWorktrees: existingState.openWorktrees,
				});
				selectProject(result.project, result.project.path);
				resetAddProjectPath();
				setAddProjectOpen(false);
				setMobileProjectListOpen(false);
			} catch (error) {
				setAddProjectError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsAddingProject(false);
			}
		},
		[
			addProjectPath,
			getProjectState,
			hydrateProjectRows,
			isAddingProject,
			procedures,
			resetAddProjectPath,
			selectProject,
			setProjectState,
		],
	);

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
				if (selectedProjectId === project.id) {
					setSelectedWorktreePath(project.path);
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
					selectProject(project);
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
			setProjectState,
			procedures,
			selectedProjectId,
			selectProject,
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
						setSelectedWorktreePath(
							projects.find((project) => project.id === projectId)?.path ??
								null,
						);
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
					expanded: false,
					loadingWorktrees: false,
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
			projects,
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
						selectedProject
							? `${selectedProject.name} · ${activeSelectedWorktreeFolder}`
							: "No project selected"
					}.`,
					isSuggestion: true,
				},
			]);
			setIsSending(false);
		}, 500);
	}, [activeSelectedWorktreeFolder, chatInput, isSending, selectedProject]);

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

	const addProjectForm = (
		<form
			className="space-y-2 border-b border-[#262626] bg-[#151515] px-3 py-3"
			onSubmit={submitAddProject}
		>
			<label className="block text-[10px] font-label uppercase tracking-widest text-[#aaa4ff]">
				Project Folder
				<div className="relative mt-2 space-y-2">
					<div className="flex items-start gap-2">
						<input
							className="min-w-0 flex-1 rounded-sm border border-[#3b3b3b] bg-[#101010] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#6f6f6f] focus:border-[#7d73ff]"
							placeholder={supportsTildePath ? "~/project" : "/path/to/project"}
							value={addProjectPath}
							onChange={(event) => {
								setAddProjectError("");
								setAddProjectPath(event.currentTarget.value);
							}}
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
						<button
							type="submit"
							className="rounded-sm bg-[#aaa4ff] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#281d7c] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isAddingProject}
						>
							{isAddingProject ? "Adding" : "Add"}
						</button>
					</div>
					{addProjectPath.trim() ? (
						<div className="overflow-hidden rounded-sm border border-[#2b2753] bg-[#0f1016]/95 shadow-[0_14px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
							<div className="flex items-center justify-between border-b border-[#24263a] px-3 py-2">
								<span className="font-label text-[10px] uppercase tracking-widest text-[#8f89df]">
									Folders
								</span>
								{directorySuggestionsLoading ? (
									<span className="text-[10px] uppercase tracking-widest text-[#6f6f89]">
										Scanning
									</span>
								) : null}
							</div>
							{directorySuggestions.length === 0 &&
							!directorySuggestionsLoading ? (
								<div className="px-3 py-3 text-xs text-[#7d7d8d]">
									No matching folders.
								</div>
							) : null}
							{directorySuggestions.map((directory) => {
								const formattedDirectory = formatDirectoryPathForInput(
									directory,
									homeDirectory,
									supportsTildePath,
								);
								return (
									<button
										type="button"
										key={directory}
										className="flex w-full items-center gap-3 border-t border-[#1b1d2a] px-3 py-2 text-left transition-colors hover:bg-[#191b29]"
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => selectDirectorySuggestion(directory)}
									>
										<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#1a1730] text-[#aaa4ff]">
											{materialSymbol("folder", "text-[18px]")}
										</div>
										<div className="min-w-0 flex-1">
											<div className="truncate text-sm font-medium normal-case text-[#f2f0ef]">
												{shortName(directory)}
											</div>
											<div className="truncate text-[11px] normal-case text-[#8e8aa7]">
												{formattedDirectory}
											</div>
										</div>
									</button>
								);
							})}
						</div>
					) : null}
				</div>
			</label>
			<div className="flex items-center justify-between gap-3">
				<p className="text-xs text-[#8f8d8b]">
					Add a repo by its root folder path.
				</p>
				<button
					type="button"
					className="font-label text-[10px] uppercase tracking-widest text-[#adabaa] transition-colors hover:text-[#f2f0ef]"
					onClick={closeAddProjectForm}
				>
					Cancel
				</button>
			</div>
			{addProjectError ? (
				<div className="text-xs text-[#ff6e84]">{addProjectError}</div>
			) : null}
		</form>
	);

	const projectActionMenuPanel =
		projectActionMenu && projectActionMenuProject ? (
			<div
				className="fixed z-[90] w-80 overflow-hidden rounded-lg border border-[#2f3150] bg-[#11131d]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
				ref={projectActionMenuRef}
				style={{
					left: projectActionMenu.x,
					top: projectActionMenu.y,
				}}
			>
				<div className="border-b border-[#262b40] bg-[#151827] px-3 py-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="font-label text-[10px] uppercase tracking-widest text-[#8f89df]">
								Project Actions
							</div>
							<div className="truncate text-sm font-semibold text-[#f2f0ef]">
								{projectActionMenuProject.name}
							</div>
							<div className="truncate text-[11px] text-[#8e8aa7]">
								{formatPathForDisplay(
									projectActionMenuProject.path,
									homeDirectory,
									supportsTildePath,
								)}
							</div>
						</div>
						<button
							type="button"
							className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2b2f45] bg-[#171a28] text-[#a6abc7] transition-colors hover:bg-[#202537] hover:text-[#f2f0ef]"
							onClick={closeProjectActionMenu}
						>
							×
						</button>
					</div>
				</div>
				{projectActionMenuError ? (
					<div className="border-b border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff7e93]">
						{projectActionMenuError}
					</div>
				) : null}
				<div className="space-y-2 px-3 py-3">
					<div className="flex items-center justify-between">
						<div className="font-label text-[10px] uppercase tracking-widest text-[#8f89df]">
							Active Worktrees
						</div>
						{projectActionMenuLoading ? (
							<div className="text-[10px] uppercase tracking-widest text-[#6f6f89]">
								Loading
							</div>
						) : null}
					</div>
					<div className="max-h-56 space-y-1 overflow-y-auto">
						{!projectActionMenuLoading &&
						projectActionMenuWorktrees.length === 0 ? (
							<div className="rounded-sm border border-[#21253a] bg-[#131624] px-3 py-3 text-xs text-[#8b8ea3]">
								No worktrees found.
							</div>
						) : null}
						{projectActionMenuWorktrees.map((worktree) => {
							const worktreeState = getWorktreeState(
								projectActionMenuProject.id,
								worktree.path,
							);
							const activeWorktree = isActiveWorktree(
								projectActionMenuProject.id,
								worktree.path,
							);
							return (
								<div
									className="rounded-sm border border-[#21253a] bg-[#131624] px-3 py-2"
									key={worktree.path}
								>
									<div
										className="grid min-w-0 items-center gap-x-3 gap-y-0.5"
										style={{
											gridTemplateColumns:
												"minmax(0, 11.5rem) minmax(0, 1fr) auto",
										}}
									>
										<span
											className="min-w-0 truncate font-mono text-[11px] leading-5 text-[#948def]"
											title={worktree.branch ?? "detached"}
										>
											{worktree.branch ?? "detached"}
										</span>
										<span
											className="min-w-0 truncate text-sm leading-5 text-[#f2f0ef]"
											title={shortName(worktree.path)}
										>
											{shortName(worktree.path)}
										</span>
										<span
											className={`h-1.5 w-1.5 shrink-0 rounded-full justify-self-end ${
												activeWorktree ? "bg-[#4fefb2]" : "bg-transparent"
											}`}
										/>
										<div
											className="col-span-2 min-w-0 truncate text-[11px] leading-4 text-[#8e8aa7]"
											title={formatPathForDisplay(
												worktree.path,
												homeDirectory,
												supportsTildePath,
											)}
										>
											{formatPathForDisplay(
												worktree.path,
												homeDirectory,
												supportsTildePath,
											)}
										</div>
									</div>
								</div>
							);
						})}
					</div>
				</div>
				<form
					className="border-t border-[#262b40] bg-[#141724] px-3 py-3"
					onSubmit={submitNewWorktree}
				>
					<label
						className="block text-[10px] font-label uppercase tracking-widest text-[#8f89df]"
						htmlFor="new-worktree-name"
					>
						New Worktree
					</label>
					<div className="mt-2 flex items-center gap-2">
						<input
							id="new-worktree-name"
							className="min-w-0 flex-1 rounded-sm border border-[#353a55] bg-[#10131d] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#6f6f89] focus:border-[#7d73ff]"
							placeholder="feature/new-worktree"
							value={newWorktreeName}
							onChange={(event) => {
								setProjectActionMenuError("");
								setNewWorktreeName(event.currentTarget.value);
							}}
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
						<button
							className="rounded-sm bg-[#f2f0ef] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#181818] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isCreatingWorktree}
							type="submit"
						>
							{isCreatingWorktree ? "Creating" : "Create"}
						</button>
					</div>
					<div className="mt-2 text-xs text-[#7f8397]">
						Creates a new branch and sibling worktree folder.
					</div>
				</form>
				<div className="border-t border-[#262b40] px-3 py-3">
					<button
						className="flex w-full items-center justify-center rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#ff8ca0] transition-colors hover:bg-[#39161f]"
						onClick={() =>
							void deleteTrackedProject(projectActionMenuProject.id)
						}
						type="button"
					>
						Remove Project
					</button>
				</div>
			</div>
		) : null;

	const projectTree = (
		<div className="space-y-2">
			{projects.length === 0 ? (
				<div className="px-3 text-sm text-[#a7a7a7]">
					No projects in database. Use + to add a project folder.
				</div>
			) : (
				projects.map((project) => {
					const state = getProjectState(project.id);
					const isActive = selectedProjectId === project.id;
					return (
						<div
							className="space-y-1"
							key={project.id}
							onContextMenu={(event: ReactMouseEvent<HTMLDivElement>) => {
								event.preventDefault();
								void openProjectActionMenu(
									project,
									event.clientX + 6,
									event.clientY + 6,
								);
							}}
						>
							<div className="flex items-center gap-1">
								<button
									type="button"
									className={`min-w-0 flex-1 rounded-sm px-3 py-2 text-left transition-colors ${
										isActive
											? "bg-[#262626] text-[#aaa4ff]"
											: "text-[#d7d7d7] hover:bg-[#1f2020]"
									}`}
									onClick={() => {
										void refreshProject(project);
									}}
								>
									<div className="flex items-center gap-2">
										<span className="text-sm">
											{state.expanded ? "▾" : "▸"}
										</span>
										<span
											className={`w-2 h-2 rounded-full ${
												project.isOpen ? "bg-[#4fefb2]" : "bg-[#5f5f5f]"
											}`}
										/>
										<div className="font-medium text-sm truncate">
											{project.name}
										</div>
									</div>
								</button>
								{!sidebarCollapsed ? (
									<button
										type="button"
										className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm border border-[#2b2f45] bg-[#171a28] px-1 text-[9px] font-semibold leading-none tracking-[-0.18em] text-[#a6abc7] transition-colors hover:bg-[#202537] hover:text-[#f2f0ef]"
										onClick={(event) => {
											event.stopPropagation();
											const rect = event.currentTarget.getBoundingClientRect();
											void openProjectActionMenu(
												project,
												rect.right + 8,
												rect.bottom + 6,
											);
										}}
										aria-label={`Project actions for ${project.name}`}
									>
										...
									</button>
								) : null}
							</div>

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
									{orderProjectWorktrees(project, state.worktrees).map(
										(worktree) => {
											const wState = getWorktreeState(
												project.id,
												worktree.path,
											);
											const activeWorktree = isActiveWorktree(
												project.id,
												worktree.path,
											);
											return (
												<button
													type="button"
													key={worktree.path}
													className={`w-full text-left px-3 py-2 flex flex-col gap-0.5 transition-colors ${
														activeWorktree
															? "bg-[#25233a] text-[#f2f0ef]"
															: wState.opened
																? "bg-[#1f2020] text-[#f2f0ef]"
																: "text-[#cfd1d4] hover:bg-[#202020]"
													}`}
													onClick={() => {
														selectProject(project, worktree.path);
														void openOrCloseWorktree(project.id, worktree.path);
													}}
												>
													<div
														className="grid min-w-0 items-center gap-x-3 gap-y-0.5"
														style={{
															gridTemplateColumns:
																"minmax(0, 11.5rem) minmax(0, 1fr) auto",
														}}
													>
														<span
															className="min-w-0 truncate font-mono text-xs leading-5 text-[#948def]"
															title={worktree.branch ?? "detached"}
														>
															{worktree.branch ?? "detached"}
														</span>
														<span
															className="min-w-0 truncate text-sm leading-5"
															title={shortName(worktree.path)}
														>
															{shortName(worktree.path)}
														</span>
														<span
															className={`h-1.5 w-1.5 shrink-0 rounded-full justify-self-end ${
																activeWorktree
																	? "bg-[#4fefb2]"
																	: "bg-transparent"
															}`}
														/>
														<div
															className="col-span-2 min-w-0 truncate text-[11px] leading-4 text-[#8e8aa7]"
															title={formatPathForDisplay(
																worktree.path,
																homeDirectory,
																supportsTildePath,
															)}
														>
															{formatPathForDisplay(
																worktree.path,
																homeDirectory,
																supportsTildePath,
															)}
														</div>
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
										},
									)}
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
					<span className="font-label text-xs font-bold text-[#aaa4ff] shrink-0">
						{selectedProject?.name ?? "No project selected"}
					</span>
					{selectedProject ? (
						<>
							<span className="text-[#4f5269] text-xs shrink-0">|</span>
							<span className="font-label text-xs text-[#f2f0ef] truncate">
								{activeSelectedWorktreeFolder}
							</span>
							<span className="font-label text-xs text-[#8f8d8b] truncate">
								{activeSelectedWorktreeName}
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
							<div className="flex items-center gap-2">
								{!sidebarCollapsed ? (
									<>
										<div className="text-xs uppercase tracking-widest text-[#d8d8d8]">
											Projects
										</div>
										<button
											type="button"
											className="flex h-6 w-6 items-center justify-center rounded-sm border border-[#7d73ff]/30 bg-[#1f1d31] text-sm font-semibold leading-none text-[#aaa4ff] transition-colors hover:border-[#aaa4ff]/60 hover:bg-[#2a2743] hover:text-[#d7d3ff]"
											onClick={toggleAddProjectForm}
											aria-label={
												addProjectOpen ? "Close add project" : "Add project"
											}
										>
											+
										</button>
									</>
								) : null}
							</div>
							<button
								type="button"
								className="px-2 py-1 rounded-sm text-[#aaa4ff] hover:bg-[#202020]"
								onClick={() => setSidebarCollapsed((value) => !value)}
							>
								{sidebarCollapsed ? "☰" : "⟨"}
							</button>
						</div>
						{!sidebarCollapsed && addProjectOpen ? addProjectForm : null}
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
						<div className="mb-3 flex items-center justify-between border-b border-[#303030] pb-3">
							<div className="flex items-center gap-2">
								<div className="text-xs uppercase tracking-widest text-[#d8d8d8]">
									Projects
								</div>
								<button
									type="button"
									className="flex h-6 w-6 items-center justify-center rounded-sm border border-[#7d73ff]/30 bg-[#1f1d31] text-sm font-semibold leading-none text-[#aaa4ff] transition-colors hover:border-[#aaa4ff]/60 hover:bg-[#2a2743] hover:text-[#d7d3ff]"
									onClick={toggleAddProjectForm}
									aria-label={
										addProjectOpen ? "Close add project" : "Add project"
									}
								>
									+
								</button>
							</div>
						</div>
						{addProjectOpen ? addProjectForm : null}
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
							{selectedProject
								? `${activeSelectedWorktreeFolder} · ${activeSelectedWorktreeName}`
								: "No worktree selected"}
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
			{projectActionMenuPanel}
		</div>
	);
}
