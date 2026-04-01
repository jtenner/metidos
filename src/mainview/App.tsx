import {
	type ChangeEvent,
	type FormEvent,
	type HTMLAttributes,
	type JSX,
	type KeyboardEvent,
	type FocusEvent as ReactFocusEvent,
	type MouseEvent as ReactMouseEvent,
	type UIEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { BeatLoader } from "react-spinners";
import type {
	ProjectProcedures,
	RpcCodexModelOption,
	RpcCodexReasoningEffort,
	RpcCodexReasoningEffortOption,
	RpcGitHistoryEntry,
	RpcProject,
	RpcProjectTask,
	RpcRequestPriority,
	RpcThread,
	RpcThreadDetail,
	RpcThreadMessage,
	RpcThreadRunStatus,
	RpcWorktree,
	RpcWorktreeChange,
	RpcWorktreeChangeStatus,
	RpcWorktreeGitHistoryChanged,
	RpcWorktreeGitHistoryResult,
	RpcWorktreeSnapshot,
	RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";
import {
	ChatErrorMessage,
	ChatNoticeMessage,
	CommandExecutionMessage,
	ContextUsageMeter,
	FileChangeMessage,
	GitHistoryDiffModal,
	MarkdownMessage,
	ProcessingMessage,
	ReasoningMessage,
	ToolCallMessage,
	isAssistantVisibleMessage,
	isPlainAssistantTextMessage,
} from "./app/message-ui";
import {
	APP_TITLE,
	COMPOSER_MAX_HEIGHT_PX,
	DESKTOP_COMPOSER_MIN_HEIGHT_PX,
	DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS,
	DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES,
	DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS,
	type DirectorySuggestionResultCacheEntry,
	type ErrorPreviewPopoverState,
	GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
	GIT_HISTORY_DOM_WINDOW_SIZE,
	GIT_HISTORY_LOAD_MORE_THRESHOLD_PX,
	GIT_HISTORY_PAGE_SIZE,
	GIT_HISTORY_RENDER_OVERSCAN_ROWS,
	GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
	GIT_HISTORY_ROW_HEIGHT_PX,
	type GitHistoryDiffCacheEntry,
	type GitHistoryModalState,
	MAINVIEW_STATE_STORAGE_VERSION,
	MOBILE_COMPOSER_MIN_HEIGHT_PX,
	type MessageGroup,
	type OpenThreadOptions,
	type PendingSharedRequest,
	type PersistedMainviewState,
	type PersistedTreeViewState,
	type ProjectActionMenuState,
	type ProjectNodeState,
	type ProjectStateMap,
	THREAD_STATUS_POLL_INTERVAL_MS,
	TREE_VIEW_STATE_STORAGE_VERSION,
	type ThreadActionMenuState,
	type ThreadErrorLevel,
	type ThreadSummaryPopoverState,
	type VisibleMessage,
	WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
	WORKTREE_TASKS_CHANGED_EVENT_NAME,
	type WorktreeNodeState,
	type WorktreeStateMap,
	appendGitHistoryPage,
	awaitAbortableResult,
	clampNumber,
	clampProjectMenuCoordinate,
	createAbortError,
	defaultProjectState,
	defaultWorktreeState,
	findPrimaryWorktree,
	formatDirectoryPathForInput,
	formatGitHistoryTimestamp,
	formatPathForDisplay,
	gitHistoryDiffCacheKey,
	isAbortError,
	isCodexReasoningEffort,
	mergeResetGitHistory,
	mergeThreadErrorLevel,
	orderProjectWorktrees,
	pickInitialThread,
	pinnedThreadForWorktree,
	primaryWorktreePath,
	readLruValue,
	readPersistedMainviewState,
	readPersistedTreeViewState,
	removeThreadFromList,
	resizeComposerTextarea,
	serializeOpenWorktrees,
	shortName,
	sortThreads,
	threadErrorLevel,
	threadRunStatus,
	upsertProjectList,
	upsertThreadList,
	withAcknowledgedUnreadThread,
	withAcknowledgedUnreadThreadDetail,
	worktreeDisplayName,
	worktreeKey,
	writeLruValue,
	writePersistedMainviewState,
	writePersistedTreeViewState,
} from "./app/state";
import { CodexModelSelector } from "./controls/codex-model-selector";
import { findCodexModel } from "./controls/codex-utils";
import { brandBoltIcon, materialSymbol } from "./controls/icons";
import { ProjectTaskSelector } from "./controls/project-task-selector";
import { ReasoningEffortSelector } from "./controls/reasoning-effort-selector";
import {
	matchesSearchQuery,
	normalizeSearchQuery,
} from "./controls/search-utils";
import { SidebarSearchControl } from "./controls/sidebar-search-control";
import { SidebarSectionHeader } from "./controls/sidebar-section-header";

type AppProps = {
	procedures: ProjectProcedures;
};

const CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 12;
const WORKTREE_DIFF_POLL_INTERVAL_MS = 2_500;
const WORKTREE_FILE_CONTENT_PAGE_BYTES = 64 * 1024;
const WORKTREE_FILE_CONTENT_LOAD_THRESHOLD_PX = 480;

type PrimaryView = "chat" | "diff";

type DiffFileContentState = {
	chunks: string[];
	error: string;
	isBinary: boolean;
	isLoadingInitial: boolean;
	isLoadingMore: boolean;
	isMissing: boolean;
	loadedBytes: number;
	nextCursor: number | null;
	path: string | null;
	totalBytes: number;
};

type DiffFileTreeNode = {
	change: RpcWorktreeChange | null;
	children: DiffFileTreeNode[];
	key: string;
	label: string;
	path: string | null;
};

function emptyDiffFileContentState(
	path: string | null = null,
): DiffFileContentState {
	return {
		chunks: [],
		error: "",
		isBinary: false,
		isLoadingInitial: false,
		isLoadingMore: false,
		isMissing: false,
		loadedBytes: 0,
		nextCursor: null,
		path,
		totalBytes: 0,
	};
}

function decodeBase64Bytes(value: string): Uint8Array {
	if (!value) {
		return new Uint8Array(0);
	}

	const decoded = atob(value);
	const bytes = new Uint8Array(decoded.length);
	for (let index = 0; index < decoded.length; index += 1) {
		bytes[index] = decoded.charCodeAt(index);
	}
	return bytes;
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dismissibleThreadStatusKey(
	runStatus: RpcThreadRunStatus,
): string | null {
	const hasDismissibleStatus =
		runStatus.hasUnreadError ||
		runStatus.state === "failed" ||
		runStatus.state === "stopped";
	const updatedAt = runStatus.updatedAt?.trim() ?? "";
	if (!hasDismissibleStatus || !updatedAt) {
		return null;
	}

	return `${runStatus.state}:${updatedAt}:${runStatus.error ?? ""}`;
}

function worktreeChangeStatusLabel(status: RpcWorktreeChangeStatus): string {
	switch (status) {
		case "added":
			return "Added";
		case "copied":
			return "Copied";
		case "deleted":
			return "Deleted";
		case "modified":
			return "Modified";
		case "renamed":
			return "Renamed";
		case "unmerged":
			return "Conflict";
		case "untracked":
			return "Untracked";
	}
}

function worktreeChangeStatusClassName(
	status: RpcWorktreeChangeStatus,
): string {
	switch (status) {
		case "added":
		case "copied":
		case "untracked":
			return "border-[#244833] bg-[#12251a] text-[#9fe2b1]";
		case "deleted":
			return "border-[#5c2030] bg-[#2c1117] text-[#ff9db0]";
		case "renamed":
			return "border-[#365062] bg-[#16212a] text-[#b7d0e1]";
		case "unmerged":
			return "border-[#6a4b1f] bg-[#2f2312] text-[#f0d79a]";
		case "modified":
			return "border-[#31404a] bg-[#182025] text-[#cfe0eb]";
	}
}

function buildDiffFileTree(changes: RpcWorktreeChange[]): DiffFileTreeNode[] {
	type MutableNode = {
		change: RpcWorktreeChange | null;
		children: Map<string, MutableNode>;
		key: string;
		label: string;
		path: string | null;
	};

	const root = new Map<string, MutableNode>();

	for (const change of changes) {
		const segments = change.path.split("/").filter(Boolean);
		if (segments.length === 0) {
			continue;
		}

		let level = root;
		let currentPath = "";
		for (let index = 0; index < segments.length; index += 1) {
			const segment = segments[index];
			if (!segment) {
				continue;
			}
			currentPath = currentPath ? `${currentPath}/${segment}` : segment;
			const isLeaf = index === segments.length - 1;
			const existing = level.get(segment);
			if (existing) {
				if (isLeaf) {
					existing.path = change.path;
					existing.change = change;
				}
				level = existing.children;
				continue;
			}

			const node: MutableNode = {
				change: isLeaf ? change : null,
				children: new Map<string, MutableNode>(),
				key: currentPath,
				label: segment,
				path: isLeaf ? change.path : null,
			};
			level.set(segment, node);
			level = node.children;
		}
	}

	const materialize = (nodes: Map<string, MutableNode>): DiffFileTreeNode[] =>
		[...nodes.values()]
			.sort((left, right) => {
				const leftIsDirectory = left.path === null;
				const rightIsDirectory = right.path === null;
				if (leftIsDirectory !== rightIsDirectory) {
					return leftIsDirectory ? -1 : 1;
				}
				return left.label.localeCompare(right.label);
			})
			.map((node) => ({
				change: node.change,
				children: materialize(node.children),
				key: node.key,
				label: node.label,
				path: node.path,
			}));

	return materialize(root);
}

function isScrolledToBottom(container: HTMLDivElement): boolean {
	return (
		container.scrollHeight - container.scrollTop - container.clientHeight <=
		CHAT_AUTO_SCROLL_BOTTOM_THRESHOLD_PX
	);
}

function scrollContainerToBottom(container: HTMLDivElement | null): void {
	if (!container) {
		return;
	}
	container.scrollTop = container.scrollHeight;
}

declare global {
	interface Window {
		__joltAppMountedAt?: number;
	}
}

export default function App({ procedures }: AppProps): JSX.Element {
	const initialMainviewStateRef = useRef<PersistedMainviewState | null>(null);
	if (!initialMainviewStateRef.current) {
		initialMainviewStateRef.current = readPersistedMainviewState();
	}
	const initialMainviewState = initialMainviewStateRef.current;
	const initialTreeViewStateRef = useRef<PersistedTreeViewState | null>(null);
	if (!initialTreeViewStateRef.current) {
		initialTreeViewStateRef.current = readPersistedTreeViewState();
	}
	const initialTreeViewState = initialTreeViewStateRef.current;

	const [projects, setProjects] = useState<RpcProject[]>([]);
	const [projectStates, setProjectStates] = useState<ProjectStateMap>({});
	const [worktreeStates, setWorktreeStates] = useState<WorktreeStateMap>({});
	const [homeDirectory, setHomeDirectory] = useState("");
	const [supportsTildePath, setSupportsTildePath] = useState(false);
	const [addProjectOpen, setAddProjectOpen] = useState(false);
	const [projectActionMenu, setProjectActionMenu] =
		useState<ProjectActionMenuState | null>(null);
	const [threadActionMenu, setThreadActionMenu] =
		useState<ThreadActionMenuState | null>(null);
	const [projectActionMenuLoading, setProjectActionMenuLoading] =
		useState(false);
	const [projectActionMenuError, setProjectActionMenuError] = useState("");
	const [threadActionMenuError, setThreadActionMenuError] = useState("");
	const [newWorktreeName, setNewWorktreeName] = useState("");
	const [threadRenameTitle, setThreadRenameTitle] = useState("");
	const [threadRenameSummary, setThreadRenameSummary] = useState("");
	const [addProjectPath, setAddProjectPath] = useState("");
	const [addProjectError, setAddProjectError] = useState("");
	const [hoveredDirectorySuggestion, setHoveredDirectorySuggestion] = useState<
		string | null
	>(null);
	const [directorySuggestions, setDirectorySuggestions] = useState<string[]>(
		[],
	);
	const [directorySuggestionsLoading, setDirectorySuggestionsLoading] =
		useState(false);
	const [isAddingProject, setIsAddingProject] = useState(false);
	const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
	const [worktreePinBusyPath, setWorktreePinBusyPath] = useState<string | null>(
		null,
	);
	const [threads, setThreads] = useState<RpcThread[]>([]);
	const [projectTasks, setProjectTasks] = useState<RpcProjectTask[]>([]);
	const [gitHistory, setGitHistory] =
		useState<RpcWorktreeGitHistoryResult | null>(null);
	const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
	const [gitHistoryLoadingMore, setGitHistoryLoadingMore] = useState(false);
	const [gitHistoryError, setGitHistoryError] = useState("");
	const [projectsSectionOpen, setProjectsSectionOpen] = useState(
		initialTreeViewState.projectsSectionOpen,
	);
	const [threadsSectionOpen, setThreadsSectionOpen] = useState(
		initialTreeViewState.threadsSectionOpen,
	);
	const [gitSectionOpen, setGitSectionOpen] = useState(
		initialTreeViewState.gitSectionOpen,
	);
	const [openProjectTreePaths, setOpenProjectTreePaths] = useState<Set<string>>(
		() => new Set(initialTreeViewState.openProjectPaths),
	);
	const [gitHistoryModal, setGitHistoryModal] =
		useState<GitHistoryModalState | null>(null);
	const [codexModels, setCodexModels] = useState<RpcCodexModelOption[]>([]);
	const [reasoningEfforts, setReasoningEfforts] = useState<
		RpcCodexReasoningEffortOption[]
	>([]);
	const [defaultCodexModel, setDefaultCodexModel] = useState("");
	const [defaultCodexReasoningEffort, setDefaultCodexReasoningEffort] =
		useState<RpcCodexReasoningEffort>("medium");
	const [pendingThreadModel, setPendingThreadModel] = useState(
		initialMainviewState.pendingThreadModel,
	);
	const [pendingThreadReasoningEffort, setPendingThreadReasoningEffort] =
		useState<RpcCodexReasoningEffort>(
			isCodexReasoningEffort(initialMainviewState.pendingThreadReasoningEffort)
				? initialMainviewState.pendingThreadReasoningEffort
				: defaultCodexReasoningEffort,
		);
	const [selectedThreadId, setSelectedThreadId] = useState<number | null>(
		initialMainviewState.selectedThreadId,
	);
	const [threadMessages, setThreadMessages] = useState<RpcThreadMessage[]>([]);
	const [threadsError, setThreadsError] = useState("");
	const [modelControlError, setModelControlError] = useState("");
	const [taskControlError, setTaskControlError] = useState("");
	const [chatError, setChatError] = useState("");
	const [sidebarSearchQuery, setSidebarSearchQuery] = useState(
		initialMainviewState.sidebarSearchQuery,
	);
	const [isThreadLoading, setIsThreadLoading] = useState(false);
	const [isCreatingThread, setIsCreatingThread] = useState(false);
	const [isLoadingProjectTasks, setIsLoadingProjectTasks] = useState(false);
	const [isRunningProjectTask, setIsRunningProjectTask] = useState(false);
	const [isUpdatingThreadModel, setIsUpdatingThreadModel] = useState(false);
	const [isUpdatingThreadReasoningEffort, setIsUpdatingThreadReasoningEffort] =
		useState(false);
	const [threadActionBusy, setThreadActionBusy] = useState<
		"rename" | "pin" | "delete" | null
	>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(
		initialMainviewState.sidebarCollapsed,
	);
	const [mobileProjectListOpen, setMobileProjectListOpen] = useState(false);
	const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
		initialMainviewState.selectedProjectId,
	);
	const [selectedWorktreePath, setSelectedWorktreePath] = useState<
		string | null
	>(initialMainviewState.selectedWorktreePath);
	const [chatInput, setChatInput] = useState(initialMainviewState.chatInput);
	const [isSending, setIsSending] = useState(false);
	const [isStoppingThread, setIsStoppingThread] = useState(false);
	const [reasoningEffortControlError, setReasoningEffortControlError] =
		useState("");
	const [errorPreviewPopover, setErrorPreviewPopover] =
		useState<ErrorPreviewPopoverState | null>(null);
	const [threadSummaryPopover, setThreadSummaryPopover] =
		useState<ThreadSummaryPopoverState | null>(null);
	const [dismissedThreadStatusKeys, setDismissedThreadStatusKeys] = useState<
		Record<number, string>
	>({});
	const [sessionStateReady, setSessionStateReady] = useState(false);
	const [isDocumentVisible, setIsDocumentVisible] = useState(
		() => document.visibilityState === "visible",
	);
	const [primaryView, setPrimaryView] = useState<PrimaryView>("chat");
	const [worktreeDiffError, setWorktreeDiffError] = useState("");
	const [isRefreshingWorktreeSnapshot, setIsRefreshingWorktreeSnapshot] =
		useState(false);
	const [selectedDiffFilePath, setSelectedDiffFilePath] = useState<
		string | null
	>(null);
	const [diffFileContentState, setDiffFileContentState] =
		useState<DiffFileContentState>(emptyDiffFileContentState());
	const [gitHistoryScrollTop, setGitHistoryScrollTop] = useState(0);
	const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
	const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
	const desktopComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const mobileComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const desktopChatScrollRef = useRef<HTMLDivElement | null>(null);
	const mobileChatScrollRef = useRef<HTMLDivElement | null>(null);
	const desktopDiffContentScrollRef = useRef<HTMLDivElement | null>(null);
	const mobileDiffContentScrollRef = useRef<HTMLDivElement | null>(null);
	const gitHistoryListRef = useRef<HTMLDivElement | null>(null);
	const desktopChatPinnedToBottomRef = useRef(true);
	const mobileChatPinnedToBottomRef = useRef(true);
	const chatScrollThreadIdRef = useRef<number | null>(
		initialMainviewState.selectedThreadId,
	);
	const projectActionMenuRequestId = useRef(0);
	const projectTasksRequestIdRef = useRef(0);
	const projectTasksAbortControllerRef = useRef<AbortController | null>(null);
	const gitHistoryRequestIdRef = useRef(0);
	const gitHistoryAbortControllerRef = useRef<AbortController | null>(null);
	const gitHistoryDiffRequestIdRef = useRef(0);
	const gitHistoryDiffAbortControllerRef = useRef<AbortController | null>(null);
	const gitHistoryDiffPreloadAbortControllerRef = useRef(
		new Map<string, AbortController>(),
	);
	const gitHistoryLoadMoreAbortControllerRef = useRef<AbortController | null>(
		null,
	);
	const threadOpenRequestIdRef = useRef(0);
	const threadOpenAbortControllerRef = useRef<AbortController | null>(null);
	const gitHistoryLoadingMoreRef = useRef(false);
	const projectWorktreeRequestCacheRef = useRef(
		new Map<number, Promise<RpcWorktree[]>>(),
	);
	const gitHistoryDiffCacheRef = useRef(
		new Map<string, GitHistoryDiffCacheEntry>(),
	);
	const gitHistoryDiffRequestCacheRef = useRef(
		new Map<string, PendingSharedRequest<GitHistoryDiffCacheEntry>>(),
	);
	const gitHistoryCacheRef = useRef(
		new Map<string, RpcWorktreeGitHistoryResult>(),
	);
	const directorySuggestionPrefetchTimerRef = useRef<number | null>(null);
	const directorySuggestionResultCacheRef = useRef(
		new Map<string, DirectorySuggestionResultCacheEntry>(),
	);
	const directorySuggestionRequestCacheRef = useRef(
		new Map<string, PendingSharedRequest<string[]>>(),
	);
	const directorySuggestionRequestIdRef = useRef(0);
	const directorySuggestionAbortControllerRef = useRef<AbortController | null>(
		null,
	);
	const diffSnapshotRequestIdRef = useRef(0);
	const diffSnapshotAbortControllerRef = useRef<AbortController | null>(null);
	const diffFileContentRequestIdRef = useRef(0);
	const diffFileContentAbortControllerRef = useRef<AbortController | null>(
		null,
	);
	const diffFileContentDecoderRef = useRef<TextDecoder | null>(null);
	const prefetchedDirectorySuggestionQueriesRef = useRef(new Set<string>());
	const homeDirectoryPrefetchQueryRef = useRef<string | null>(null);
	const selectedThreadIdRef = useRef<number | null>(null);
	const previousSelectedThreadIdRef = useRef<number | null>(
		initialMainviewState.selectedThreadId,
	);
	const selectedProjectIdRef = useRef<number | null>(
		initialMainviewState.selectedProjectId,
	);
	const selectedWorktreePathRef = useRef<string | null>(
		initialMainviewState.selectedWorktreePath,
	);
	const threadCreationInFlightCountRef = useRef(0);
	const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");
	const optimisticallyAcknowledgedThreadIdsRef = useRef(new Set<number>());
	const threadErrorSeenRequestCacheRef = useRef(
		new Map<number, Promise<RpcThreadDetail>>(),
	);
	const worktreeToggleRequestIdRef = useRef(new Map<string, number>());
	const threadStatusPollInFlightRef = useRef(false);
	const initializedRef = useRef(false);

	const selectedProject = useMemo(() => {
		if (!selectedProjectId) {
			return null;
		}
		return projects.find((entry) => entry.id === selectedProjectId) ?? null;
	}, [projects, selectedProjectId]);

	const selectedThread = useMemo(() => {
		if (!selectedThreadId) {
			return null;
		}
		return threads.find((entry) => entry.id === selectedThreadId) ?? null;
	}, [selectedThreadId, threads]);

	const selectedThreadRunStatus = useMemo(
		() => threadRunStatus(selectedThread),
		[selectedThread],
	);

	const hasWorkingThreads = useMemo(
		() => threads.some((thread) => thread.runStatus.state === "working"),
		[threads],
	);

	const activeCodexModel = useMemo(() => {
		if (selectedThread?.model) {
			return selectedThread.model;
		}
		return pendingThreadModel || defaultCodexModel;
	}, [defaultCodexModel, pendingThreadModel, selectedThread]);

	const activeCodexModelOption = useMemo(
		() => findCodexModel(codexModels, activeCodexModel),
		[activeCodexModel, codexModels],
	);

	const activeReasoningEffort = useMemo(() => {
		if (selectedThread?.reasoningEffort) {
			return selectedThread.reasoningEffort;
		}
		return pendingThreadReasoningEffort || defaultCodexReasoningEffort;
	}, [
		defaultCodexReasoningEffort,
		pendingThreadReasoningEffort,
		selectedThread,
	]);

	const activeContextWindowTokens =
		activeCodexModelOption?.contextWindowTokens ?? 400_000;
	const activeContextInputTokens = selectedThread?.usage?.inputTokens ?? 0;
	const activeCompactionTriggerTokens =
		selectedThread?.compaction.estimatedTriggerTokens ??
		Math.round(activeContextWindowTokens * 0.8);
	const activeCompactionTriggerSource =
		selectedThread?.compaction.estimatedTriggerSource ?? "heuristic";
	const activeMaxObservedInputTokens =
		selectedThread?.compaction.maxObservedInputTokens ?? null;
	const activeCompactionInferenceCount =
		selectedThread?.compaction.inferredCount ?? 0;
	const activeLastCompactionBeforeInputTokens =
		selectedThread?.compaction.lastInferredBeforeInputTokens ?? null;
	const activeLastCompactionAfterInputTokens =
		selectedThread?.compaction.lastInferredAfterInputTokens ?? null;

	const isThreadStatusDismissed = useCallback(
		(thread: RpcThread | null): boolean => {
			if (!thread) {
				return false;
			}

			const statusKey = dismissibleThreadStatusKey(thread.runStatus);
			return (
				statusKey !== null && dismissedThreadStatusKeys[thread.id] === statusKey
			);
		},
		[dismissedThreadStatusKeys],
	);

	const projectThreadErrorLevels = useMemo(() => {
		const next = new Map<number, ThreadErrorLevel>();
		for (const thread of threads) {
			const level = isThreadStatusDismissed(thread)
				? "none"
				: threadErrorLevel(thread);
			if (level === "none") {
				continue;
			}
			next.set(
				thread.projectId,
				mergeThreadErrorLevel(next.get(thread.projectId) ?? "none", level),
			);
		}
		return next;
	}, [isThreadStatusDismissed, threads]);

	const worktreeThreadErrorLevels = useMemo(() => {
		const next = new Map<string, ThreadErrorLevel>();
		for (const thread of threads) {
			const level = isThreadStatusDismissed(thread)
				? "none"
				: threadErrorLevel(thread);
			if (level === "none") {
				continue;
			}
			const key = worktreeKey(thread.projectId, thread.worktreePath);
			next.set(key, mergeThreadErrorLevel(next.get(key) ?? "none", level));
		}
		return next;
	}, [isThreadStatusDismissed, threads]);

	useEffect(() => {
		setDismissedThreadStatusKeys((prev) => {
			const nextEntries = Object.entries(prev).filter(
				([threadId, statusKey]) => {
					const thread =
						threads.find((entry) => entry.id === Number(threadId)) ?? null;
					return thread
						? dismissibleThreadStatusKey(thread.runStatus) === statusKey
						: false;
				},
			);
			if (nextEntries.length === Object.keys(prev).length) {
				return prev;
			}

			return Object.fromEntries(nextEntries) as Record<number, string>;
		});
	}, [threads]);

	const dismissThreadStatus = useCallback((thread: RpcThread): void => {
		const statusKey = dismissibleThreadStatusKey(thread.runStatus);
		if (!statusKey) {
			return;
		}

		setDismissedThreadStatusKeys((prev) =>
			prev[thread.id] === statusKey
				? prev
				: {
						...prev,
						[thread.id]: statusKey,
					},
		);
	}, []);

	const selectedThreadIsWorking = selectedThreadRunStatus.state === "working";
	const modelSelectorDisabled =
		codexModels.length === 0 ||
		isCreatingThread ||
		isThreadLoading ||
		isSending ||
		isUpdatingThreadModel ||
		selectedThreadIsWorking;
	const reasoningEffortSelectorDisabled =
		reasoningEfforts.length === 0 ||
		isCreatingThread ||
		isThreadLoading ||
		isSending ||
		isUpdatingThreadReasoningEffort ||
		selectedThreadIsWorking;

	const selectedThreadRunError =
		selectedThreadRunStatus.state === "failed"
			? (selectedThreadRunStatus.error ?? "")
			: "";
	const selectedThreadRunNotice =
		selectedThreadRunStatus.state === "stopped"
			? (selectedThreadRunStatus.error ?? "")
			: "";
	const composerActionDisabled = selectedThreadIsWorking
		? !selectedThread || isThreadLoading || isStoppingThread
		: !selectedThread || isSending || isThreadLoading;
	const composerActionToneClassName = selectedThreadIsWorking
		? "bg-[#4b2028] text-[#ffd4da]"
		: "bg-[#bdd5e6] text-[#2e526b]";
	const composerActionLabel = selectedThreadIsWorking
		? "Stop current run"
		: "Send message";

	const activeChatError = chatError || selectedThreadRunError;
	const activeChatNotice = selectedThreadRunNotice;

	useEffect(() => {
		void chatInput;
		resizeComposerTextarea(
			desktopComposerRef.current,
			DESKTOP_COMPOSER_MIN_HEIGHT_PX,
		);
		resizeComposerTextarea(
			mobileComposerRef.current,
			MOBILE_COMPOSER_MIN_HEIGHT_PX,
		);
	}, [chatInput]);

	const projectActionMenuProject = useMemo(() => {
		if (!projectActionMenu) {
			return null;
		}
		return (
			projects.find((project) => project.id === projectActionMenu.projectId) ??
			null
		);
	}, [projectActionMenu, projects]);

	const threadActionMenuThread = useMemo(() => {
		if (!threadActionMenu) {
			return null;
		}
		return (
			threads.find((thread) => thread.id === threadActionMenu.threadId) ?? null
		);
	}, [threadActionMenu, threads]);

	const getProjectState = useCallback(
		(projectId: number): ProjectNodeState =>
			projectStates[projectId] ?? defaultProjectState(),
		[projectStates],
	);

	const isProjectTreeOpen = useCallback(
		(projectPath: string): boolean => openProjectTreePaths.has(projectPath),
		[openProjectTreePaths],
	);

	const setProjectTreeOpen = useCallback(
		(projectPath: string, open: boolean): void => {
			setOpenProjectTreePaths((prev) => {
				const next = new Set(prev);
				if (open) {
					next.add(projectPath);
				} else {
					next.delete(projectPath);
				}
				return next;
			});
		},
		[],
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
			const nextWorktreePath =
				worktreePath ??
				primaryWorktreePath(project, getProjectState(project.id).worktrees);
			selectedProjectIdRef.current = project.id;
			selectedWorktreePathRef.current = nextWorktreePath;
			setSelectedProjectId(project.id);
			setSelectedWorktreePath(nextWorktreePath);
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
		if (!selectedProject || selectedProject.isOpen !== 1) {
			return null;
		}
		if (selectedWorktreePath) {
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

	const activeSelectedWorktreeOpened = useMemo(() => {
		if (!selectedProject || !activeSelectedWorktreePath) {
			return false;
		}
		return getWorktreeState(selectedProject.id, activeSelectedWorktreePath)
			.opened;
	}, [activeSelectedWorktreePath, getWorktreeState, selectedProject]);

	const activeSelectedWorktreeState = useMemo(() => {
		if (!selectedProject || !activeSelectedWorktreePath) {
			return null;
		}
		return getWorktreeState(selectedProject.id, activeSelectedWorktreePath);
	}, [activeSelectedWorktreePath, getWorktreeState, selectedProject]);

	const activeWorktreeSnapshot = activeSelectedWorktreeState?.snapshot ?? null;
	const activeWorktreeChanges = activeWorktreeSnapshot?.changes ?? [];
	const diffFileTree = useMemo(
		() => buildDiffFileTree(activeWorktreeChanges),
		[activeWorktreeChanges],
	);
	const selectedDiffFileChange = useMemo(
		() =>
			selectedDiffFilePath
				? (activeWorktreeChanges.find(
						(change) => change.path === selectedDiffFilePath,
					) ?? null)
				: null,
		[activeWorktreeChanges, selectedDiffFilePath],
	);

	const activePollingProjectId =
		isDocumentVisible &&
		selectedProject &&
		selectedProject.isOpen === 1 &&
		activeSelectedWorktreePath
			? selectedProject.id
			: null;
	const activePollingWorktreePath =
		activePollingProjectId !== null ? activeSelectedWorktreePath : null;

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
		if (!activeSelectedWorktree && selectedThread) {
			return selectedThread.title;
		}
		return worktreeDisplayName(activeSelectedWorktree);
	}, [activeSelectedWorktree, selectedProject, selectedThread]);

	const localUserLabel = useMemo(() => {
		const normalizedHomeDirectory = homeDirectory.replace(/[\\/]+$/, "");
		if (!normalizedHomeDirectory) {
			return "User";
		}
		const label = shortName(normalizedHomeDirectory);
		if (!label || label === "/" || /^[A-Za-z]:$/.test(label)) {
			return "User";
		}
		return label;
	}, [homeDirectory]);

	const activeScreenTitle = selectedThread?.title ?? "No thread selected";
	const activeScreenSubtitlePrimary = selectedProject
		? activeSelectedWorktreeFolder
		: "No project selected";
	const activeScreenSubtitleSecondary = activeSelectedWorktreePath
		? formatPathForDisplay(
				activeSelectedWorktreePath,
				homeDirectory,
				supportsTildePath,
			)
		: "No worktree selected";

	const taskSelectorDisabled =
		!selectedProject ||
		!activeSelectedWorktreePath ||
		!activeSelectedWorktreeOpened ||
		isLoadingProjectTasks ||
		isRunningProjectTask ||
		isSending ||
		selectedThreadIsWorking ||
		isThreadLoading;

	const abortGitHistoryDiffRequest = useCallback((reason: string) => {
		const controller = gitHistoryDiffAbortControllerRef.current;
		if (!controller) {
			return;
		}

		gitHistoryDiffAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const abortAllGitHistoryDiffPreloads = useCallback((reason: string) => {
		for (const controller of gitHistoryDiffPreloadAbortControllerRef.current.values()) {
			controller.abort(createAbortError(null, reason));
		}
		gitHistoryDiffPreloadAbortControllerRef.current.clear();
	}, []);

	const closeGitHistoryModal = useCallback(() => {
		gitHistoryDiffRequestIdRef.current += 1;
		abortGitHistoryDiffRequest("Commit diff request was cleared.");
		setGitHistoryModal(null);
	}, [abortGitHistoryDiffRequest]);

	const loadGitHistoryDiff = useCallback(
		async (
			projectId: number,
			worktreePath: string,
			entry: RpcGitHistoryEntry,
			options?: {
				priority?: RpcRequestPriority;
				signal?: AbortSignal;
			},
		): Promise<GitHistoryDiffCacheEntry> => {
			const cacheKey = gitHistoryDiffCacheKey(
				projectId,
				worktreePath,
				entry.hash,
			);
			const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
			if (cached) {
				return Promise.resolve(cached);
			}

			const pending = gitHistoryDiffRequestCacheRef.current.get(cacheKey);
			if (pending) {
				pending.waiterCount += 1;
				try {
					return await awaitAbortableResult(
						pending.promise,
						options?.signal,
						"Commit diff read was aborted.",
					);
				} finally {
					pending.waiterCount = Math.max(0, pending.waiterCount - 1);
					if (
						pending.waiterCount === 0 &&
						gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pending
					) {
						pending.controller.abort(
							createAbortError(null, "Commit diff read was aborted."),
						);
					}
				}
			}

			const controller = new AbortController();
			const pendingRequest: PendingSharedRequest<GitHistoryDiffCacheEntry> = {
				controller,
				promise: Promise.resolve(null as never),
				waiterCount: 1,
			};
			const request = procedures
				.getWorktreeGitCommitDiff(
					{
						projectId,
						worktreePath,
						commitHash: entry.hash,
					},
					{
						priority: options?.priority ?? "foreground",
						signal: controller.signal,
					},
				)
				.then((result) => {
					const nextValue = {
						commit: result.commit,
						diffText: result.diffText,
					};
					writeLruValue(
						gitHistoryDiffCacheRef.current,
						cacheKey,
						nextValue,
						GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
					);
					return nextValue;
				})
				.finally(() => {
					if (
						gitHistoryDiffRequestCacheRef.current.get(cacheKey) ===
						pendingRequest
					) {
						gitHistoryDiffRequestCacheRef.current.delete(cacheKey);
					}
				});
			pendingRequest.promise = request;
			gitHistoryDiffRequestCacheRef.current.set(cacheKey, pendingRequest);

			try {
				return await awaitAbortableResult(
					request,
					options?.signal,
					"Commit diff read was aborted.",
				);
			} finally {
				pendingRequest.waiterCount = Math.max(
					0,
					pendingRequest.waiterCount - 1,
				);
				if (
					pendingRequest.waiterCount === 0 &&
					gitHistoryDiffRequestCacheRef.current.get(cacheKey) === pendingRequest
				) {
					controller.abort(
						createAbortError(null, "Commit diff read was aborted."),
					);
				}
			}
		},
		[procedures],
	);

	const preloadGitHistoryDiff = useCallback(
		(entry: RpcGitHistoryEntry) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}

			const cacheKey = gitHistoryDiffCacheKey(
				selectedProject.id,
				activeSelectedWorktreePath,
				entry.hash,
			);
			if (gitHistoryDiffPreloadAbortControllerRef.current.has(cacheKey)) {
				return;
			}

			const controller = new AbortController();
			gitHistoryDiffPreloadAbortControllerRef.current.set(cacheKey, controller);
			void loadGitHistoryDiff(
				selectedProject.id,
				activeSelectedWorktreePath,
				entry,
				{
					priority: "default",
					signal: controller.signal,
				},
			)
				.catch((error) => {
					if (isAbortError(error)) {
						return;
					}
					// Hover preloads should never surface errors ahead of explicit open.
				})
				.finally(() => {
					if (
						gitHistoryDiffPreloadAbortControllerRef.current.get(cacheKey) ===
						controller
					) {
						gitHistoryDiffPreloadAbortControllerRef.current.delete(cacheKey);
					}
				});
		},
		[activeSelectedWorktreePath, loadGitHistoryDiff, selectedProject],
	);

	const cancelPreloadGitHistoryDiff = useCallback(
		(entry: RpcGitHistoryEntry) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}

			const cacheKey = gitHistoryDiffCacheKey(
				selectedProject.id,
				activeSelectedWorktreePath,
				entry.hash,
			);
			const controller =
				gitHistoryDiffPreloadAbortControllerRef.current.get(cacheKey);
			if (!controller) {
				return;
			}

			gitHistoryDiffPreloadAbortControllerRef.current.delete(cacheKey);
			controller.abort(
				createAbortError(null, "Commit diff preload was aborted."),
			);
		},
		[activeSelectedWorktreePath, selectedProject],
	);

	const openGitHistoryDiff = useCallback(
		async (entry: RpcGitHistoryEntry) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}

			const projectId = selectedProject.id;
			const worktreePath = activeSelectedWorktreePath;
			const cacheKey = gitHistoryDiffCacheKey(
				projectId,
				worktreePath,
				entry.hash,
			);
			const cached = readLruValue(gitHistoryDiffCacheRef.current, cacheKey);
			const requestId = gitHistoryDiffRequestIdRef.current + 1;
			gitHistoryDiffRequestIdRef.current = requestId;
			abortGitHistoryDiffRequest("Commit diff request was superseded.");

			setGitHistoryModal({
				projectId,
				worktreePath,
				entry: cached?.commit ?? entry,
				diffText: cached?.diffText ?? "",
				loading: !cached,
				error: "",
			});

			if (cached) {
				return;
			}

			const controller = new AbortController();
			gitHistoryDiffAbortControllerRef.current = controller;
			try {
				const result = await loadGitHistoryDiff(
					projectId,
					worktreePath,
					entry,
					{
						priority: "foreground",
						signal: controller.signal,
					},
				);
				if (gitHistoryDiffRequestIdRef.current !== requestId) {
					return;
				}

				setGitHistoryModal((current) =>
					current &&
					current.projectId === projectId &&
					current.worktreePath === worktreePath &&
					current.entry.hash === entry.hash
						? {
								...current,
								entry: result.commit,
								diffText: result.diffText,
								loading: false,
								error: "",
							}
						: current,
				);
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (gitHistoryDiffRequestIdRef.current !== requestId) {
					return;
				}
				setGitHistoryModal((current) =>
					current &&
					current.projectId === projectId &&
					current.worktreePath === worktreePath &&
					current.entry.hash === entry.hash
						? {
								...current,
								loading: false,
								error: error instanceof Error ? error.message : String(error),
							}
						: current,
				);
			} finally {
				if (gitHistoryDiffAbortControllerRef.current === controller) {
					gitHistoryDiffAbortControllerRef.current = null;
				}
			}
		},
		[
			abortGitHistoryDiffRequest,
			activeSelectedWorktreePath,
			loadGitHistoryDiff,
			selectedProject,
		],
	);

	const normalizedSidebarSearchQuery = useMemo(
		() => normalizeSearchQuery(sidebarSearchQuery),
		[sidebarSearchQuery],
	);

	const visibleThreads = useMemo(() => {
		if (!selectedProjectId || !activeSelectedWorktreePath) {
			return [];
		}
		return threads.filter(
			(thread) =>
				thread.projectId === selectedProjectId &&
				thread.worktreePath === activeSelectedWorktreePath,
		);
	}, [activeSelectedWorktreePath, selectedProjectId, threads]);

	const filteredProjects = useMemo(() => {
		if (!normalizedSidebarSearchQuery) {
			return projects;
		}

		return projects.filter((project) => {
			const projectState = getProjectState(project.id);
			const matchingWorktree = projectState.worktrees.some((worktree) =>
				matchesSearchQuery(
					normalizedSidebarSearchQuery,
					project.name,
					project.path,
					formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
					worktree.branch,
					worktree.path,
					shortName(worktree.path),
					formatPathForDisplay(worktree.path, homeDirectory, supportsTildePath),
				),
			);

			const matchingThread = threads.some(
				(thread) =>
					thread.projectId === project.id &&
					matchesSearchQuery(
						normalizedSidebarSearchQuery,
						thread.title,
						thread.summary,
						thread.worktreePath,
						shortName(thread.worktreePath),
						formatPathForDisplay(
							thread.worktreePath,
							homeDirectory,
							supportsTildePath,
						),
					),
			);

			return (
				matchesSearchQuery(
					normalizedSidebarSearchQuery,
					project.name,
					project.path,
					formatPathForDisplay(project.path, homeDirectory, supportsTildePath),
				) ||
				matchingWorktree ||
				matchingThread
			);
		});
	}, [
		getProjectState,
		homeDirectory,
		normalizedSidebarSearchQuery,
		projects,
		supportsTildePath,
		threads,
	]);

	const filteredVisibleThreads = useMemo(() => {
		if (!normalizedSidebarSearchQuery) {
			return visibleThreads;
		}

		return visibleThreads.filter((thread) =>
			matchesSearchQuery(
				normalizedSidebarSearchQuery,
				thread.title,
				thread.summary,
				thread.worktreePath,
				shortName(thread.worktreePath),
				formatPathForDisplay(
					thread.worktreePath,
					homeDirectory,
					supportsTildePath,
				),
			),
		);
	}, [
		homeDirectory,
		normalizedSidebarSearchQuery,
		supportsTildePath,
		visibleThreads,
	]);

	const filteredGitHistoryEntries = useMemo(() => {
		const entries = gitHistory?.entries ?? [];
		if (!normalizedSidebarSearchQuery) {
			return entries;
		}

		return entries.filter((entry) =>
			matchesSearchQuery(
				normalizedSidebarSearchQuery,
				entry.hash,
				entry.shortHash,
				entry.subject,
				entry.authorName,
				entry.committedAt,
				gitHistory?.branch,
				activeSelectedWorktree?.branch,
			),
		);
	}, [activeSelectedWorktree, gitHistory, normalizedSidebarSearchQuery]);

	const visibleGitHistoryEntries = useMemo(() => {
		const totalEntries = filteredGitHistoryEntries.length;
		if (totalEntries === 0) {
			return {
				entries: [] as RpcGitHistoryEntry[],
				topSpacerHeight: 0,
				bottomSpacerHeight: 0,
			};
		}

		const windowSize = Math.min(GIT_HISTORY_DOM_WINDOW_SIZE, totalEntries);
		const maxStartIndex = Math.max(0, totalEntries - windowSize);
		const startIndex = clampNumber(
			Math.floor(gitHistoryScrollTop / GIT_HISTORY_ROW_HEIGHT_PX) -
				GIT_HISTORY_RENDER_OVERSCAN_ROWS,
			0,
			maxStartIndex,
		);
		const endIndex = Math.min(totalEntries, startIndex + windowSize);

		return {
			entries: filteredGitHistoryEntries.slice(startIndex, endIndex),
			topSpacerHeight: startIndex * GIT_HISTORY_ROW_HEIGHT_PX,
			bottomSpacerHeight: (totalEntries - endIndex) * GIT_HISTORY_ROW_HEIGHT_PX,
		};
	}, [filteredGitHistoryEntries, gitHistoryScrollTop]);

	const isActiveWorktree = useCallback(
		(projectId: number, worktreePath: string): boolean =>
			selectedProjectId === projectId &&
			activeSelectedWorktreePath === worktreePath,
		[activeSelectedWorktreePath, selectedProjectId],
	);

	const projectThreadErrorLevel = useCallback(
		(projectId: number): ThreadErrorLevel =>
			projectThreadErrorLevels.get(projectId) ?? "none",
		[projectThreadErrorLevels],
	);

	const worktreeThreadErrorLevel = useCallback(
		(projectId: number, worktreePath: string): ThreadErrorLevel =>
			worktreeThreadErrorLevels.get(worktreeKey(projectId, worktreePath)) ??
			"none",
		[worktreeThreadErrorLevels],
	);

	const showErrorPreview = useCallback(
		(
			event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
			anchorId: string,
			text: string,
		): void => {
			const previewText = text.trim();
			if (!previewText) {
				setErrorPreviewPopover(null);
				return;
			}
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			if (viewportWidth < 768) {
				setErrorPreviewPopover(null);
				return;
			}
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;
			const rect = event.currentTarget.getBoundingClientRect();
			const clampedTop = clampProjectMenuCoordinate(
				rect.top + rect.height / 2 - 98,
				viewportHeight,
				196,
			);
			setErrorPreviewPopover({
				anchorId,
				text: previewText,
				x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 368),
				y: clampedTop + 98,
			});
		},
		[],
	);

	const hideErrorPreview = useCallback((): void => {
		setErrorPreviewPopover(null);
	}, []);

	const showThreadSummaryPreview = useCallback(
		(
			event: ReactMouseEvent<HTMLElement> | ReactFocusEvent<HTMLElement>,
			anchorId: string,
			title: string,
			summary: string,
		): void => {
			const previewSummary = summary.trim();
			if (!previewSummary) {
				setThreadSummaryPopover(null);
				return;
			}
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			if (viewportWidth < 768) {
				setThreadSummaryPopover(null);
				return;
			}
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;
			const rect = event.currentTarget.getBoundingClientRect();
			setThreadSummaryPopover({
				anchorId,
				title,
				summary: previewSummary,
				x: clampProjectMenuCoordinate(rect.right + 14, viewportWidth, 360),
				y: clampProjectMenuCoordinate(rect.top, viewportHeight, 240),
			});
		},
		[],
	);

	const hideThreadSummaryPreview = useCallback((): void => {
		setThreadSummaryPopover(null);
	}, []);

	const errorPreviewHandlers = useCallback(
		(
			anchorId: string,
			text: string | null | undefined,
		): Pick<
			HTMLAttributes<HTMLElement>,
			"onMouseEnter" | "onMouseLeave" | "onFocus" | "onBlur"
		> => {
			const previewText = text?.trim();
			if (!previewText) {
				return {};
			}
			return {
				onMouseEnter: (event) => {
					showErrorPreview(
						event as ReactMouseEvent<HTMLElement>,
						anchorId,
						previewText,
					);
				},
				onFocus: (event) => {
					showErrorPreview(
						event as ReactFocusEvent<HTMLElement>,
						anchorId,
						previewText,
					);
				},
				onMouseLeave: () => {
					hideErrorPreview();
				},
				onBlur: () => {
					hideErrorPreview();
				},
			};
		},
		[hideErrorPreview, showErrorPreview],
	);

	const threadSummaryPreviewHandlers = useCallback(
		(
			anchorId: string,
			title: string,
			summary: string | null | undefined,
		): Pick<
			HTMLAttributes<HTMLElement>,
			"onMouseEnter" | "onMouseMove" | "onMouseLeave" | "onFocus" | "onBlur"
		> => {
			const previewSummary = summary?.trim();
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			if (!previewSummary || viewportWidth < 768) {
				return {};
			}
			return {
				onMouseEnter: (event) => {
					showThreadSummaryPreview(
						event as ReactMouseEvent<HTMLElement>,
						anchorId,
						title,
						previewSummary,
					);
				},
				onMouseMove: (event) => {
					showThreadSummaryPreview(
						event as ReactMouseEvent<HTMLElement>,
						anchorId,
						title,
						previewSummary,
					);
				},
				onFocus: (event) => {
					showThreadSummaryPreview(
						event as ReactFocusEvent<HTMLElement>,
						anchorId,
						title,
						previewSummary,
					);
				},
				onMouseLeave: () => {
					hideThreadSummaryPreview();
				},
				onBlur: () => {
					hideThreadSummaryPreview();
				},
			};
		},
		[hideThreadSummaryPreview, showThreadSummaryPreview],
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

	const updateProjectState = useCallback(
		(
			projectId: number,
			updater: (current: ProjectNodeState) => ProjectNodeState,
		): void => {
			setProjectStates((prev) => {
				const current = prev[projectId] ?? defaultProjectState();
				const nextProjectState = updater(current);
				if (nextProjectState === current) {
					return prev;
				}
				return {
					...prev,
					[projectId]: nextProjectState,
				} satisfies ProjectStateMap;
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

	const syncThreadContext = useCallback((thread: RpcThread) => {
		selectedProjectIdRef.current = thread.projectId;
		selectedWorktreePathRef.current = thread.worktreePath;
		setSelectedProjectId(thread.projectId);
		setSelectedWorktreePath(thread.worktreePath);
	}, []);

	const beginWorktreeToggleRequest = useCallback(
		(projectId: number, worktreePath: string) => {
			const key = worktreeKey(projectId, worktreePath);
			const nextRequestId =
				(worktreeToggleRequestIdRef.current.get(key) ?? 0) + 1;
			worktreeToggleRequestIdRef.current.set(key, nextRequestId);
			return {
				key,
				requestId: nextRequestId,
			};
		},
		[],
	);

	const isCurrentWorktreeToggleRequest = useCallback(
		(key: string, requestId: number): boolean =>
			worktreeToggleRequestIdRef.current.get(key) === requestId,
		[],
	);

	const finishWorktreeToggleRequest = useCallback(
		(key: string, requestId: number): void => {
			if (worktreeToggleRequestIdRef.current.get(key) === requestId) {
				worktreeToggleRequestIdRef.current.delete(key);
			}
		},
		[],
	);

	const requestProjectWorktrees = useCallback(
		async (projectId: number): Promise<RpcWorktree[]> => {
			const existing = projectWorktreeRequestCacheRef.current.get(projectId);
			if (existing) {
				return existing;
			}

			const request = procedures
				.listProjectWorktrees({ projectId })
				.then((result) => {
					setProjectState(projectId, {
						worktrees: result.worktrees,
						loadingWorktrees: false,
						error: "",
					});
					return result.worktrees;
				})
				.finally(() => {
					projectWorktreeRequestCacheRef.current.delete(projectId);
				});
			projectWorktreeRequestCacheRef.current.set(projectId, request);
			return request;
		},
		[procedures, setProjectState],
	);

	const loadProjectWorktrees = useCallback(
		async (
			projectId: number,
			options?: {
				backgroundRefresh?: boolean;
				preferCached?: boolean;
			},
		): Promise<RpcWorktree[]> => {
			const current = getProjectState(projectId);
			if ((options?.preferCached ?? true) && current.worktrees.length > 0) {
				setProjectState(projectId, {
					loadingWorktrees: false,
					error: "",
				});
				if (options?.backgroundRefresh) {
					void requestProjectWorktrees(projectId).catch(() => {
						// Keep rendering the cached worktree list if the background refresh fails.
					});
				}
				return current.worktrees;
			}

			setProjectState(projectId, {
				loadingWorktrees: true,
				error: "",
			});
			return requestProjectWorktrees(projectId);
		},
		[getProjectState, requestProjectWorktrees, setProjectState],
	);

	const createThreadForWorktree = useCallback(
		async (
			projectId: number,
			worktreePath: string,
			options?: {
				requireNoSelectedThread?: boolean;
			},
		): Promise<RpcThreadDetail | null> => {
			threadCreationInFlightCountRef.current += 1;
			setIsCreatingThread(true);
			setThreadsError("");
			setModelControlError("");
			setReasoningEffortControlError("");
			setChatError("");
			try {
				const detail = await procedures.createThread({
					projectId,
					worktreePath,
					model: activeCodexModel || defaultCodexModel || null,
					reasoningEffort:
						activeReasoningEffort || defaultCodexReasoningEffort || null,
				});
				const isActiveSelection =
					selectedProjectIdRef.current === projectId &&
					selectedWorktreePathRef.current === worktreePath;
				const canApplySelection =
					!options?.requireNoSelectedThread ||
					(selectedThreadIdRef.current === null &&
						threadOpenAbortControllerRef.current === null);
				if (!isActiveSelection || !canApplySelection) {
					void procedures
						.discardEmptyThread({
							threadId: detail.thread.id,
						})
						.catch(() => {
							// Best effort; stale auto-created threads should not break the UI.
						});
					return null;
				}

				setThreads((prev) => upsertThreadList(prev, detail.thread));
				setSelectedThreadId(detail.thread.id);
				selectedThreadIdRef.current = detail.thread.id;
				selectedThreadRunStateRef.current = detail.thread.runStatus.state;
				setThreadMessages(detail.messages);
				syncThreadContext(detail.thread);
				setMobileProjectListOpen(false);
				try {
					await loadProjectWorktrees(detail.thread.projectId);
				} catch {
					// Best effort; thread creation should still succeed even if the worktree refresh fails.
				}
				return detail;
			} catch (error) {
				if (
					selectedProjectIdRef.current === projectId &&
					selectedWorktreePathRef.current === worktreePath
				) {
					setThreadsError(
						error instanceof Error ? error.message : String(error),
					);
				}
				return null;
			} finally {
				threadCreationInFlightCountRef.current = Math.max(
					0,
					threadCreationInFlightCountRef.current - 1,
				);
				setIsCreatingThread(threadCreationInFlightCountRef.current > 0);
			}
		},
		[
			activeCodexModel,
			activeReasoningEffort,
			defaultCodexModel,
			defaultCodexReasoningEffort,
			loadProjectWorktrees,
			procedures,
			syncThreadContext,
		],
	);

	const abortProjectTasksRequest = useCallback((reason: string) => {
		const controller = projectTasksAbortControllerRef.current;
		if (!controller) {
			return;
		}

		projectTasksAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const abortGitHistoryRequests = useCallback((reason: string) => {
		const historyController = gitHistoryAbortControllerRef.current;
		if (historyController) {
			gitHistoryAbortControllerRef.current = null;
			historyController.abort(createAbortError(null, reason));
		}

		const loadMoreController = gitHistoryLoadMoreAbortControllerRef.current;
		if (loadMoreController) {
			gitHistoryLoadMoreAbortControllerRef.current = null;
			loadMoreController.abort(createAbortError(null, reason));
		}
	}, []);

	const abortThreadOpenRequest = useCallback((reason: string) => {
		const controller = threadOpenAbortControllerRef.current;
		if (!controller) {
			return;
		}

		threadOpenAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const abortDiffSnapshotRequest = useCallback((reason: string) => {
		const controller = diffSnapshotAbortControllerRef.current;
		if (!controller) {
			return;
		}

		diffSnapshotAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const abortDiffFileContentRequest = useCallback((reason: string) => {
		const controller = diffFileContentAbortControllerRef.current;
		if (!controller) {
			return;
		}

		diffFileContentAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const refreshActiveWorktreeSnapshot = useCallback(
		async (options?: { background?: boolean }) => {
			if (
				!selectedProject ||
				!activeSelectedWorktreePath ||
				!activeSelectedWorktreeOpened
			) {
				return;
			}

			const requestId = ++diffSnapshotRequestIdRef.current;
			abortDiffSnapshotRequest(
				"Worktree diff snapshot request was superseded.",
			);
			const controller = new AbortController();
			diffSnapshotAbortControllerRef.current = controller;
			setIsRefreshingWorktreeSnapshot(true);
			if (!options?.background) {
				setWorktreeDiffError("");
			}

			try {
				const snapshot = await procedures.getWorktreeSnapshot(
					{
						projectId: selectedProject.id,
						worktreePath: activeSelectedWorktreePath,
					},
					{
						priority: options?.background ? "background" : "foreground",
						signal: controller.signal,
					},
				);
				if (diffSnapshotRequestIdRef.current !== requestId) {
					return;
				}

				setWorktreeState(selectedProject.id, activeSelectedWorktreePath, {
					error: "",
					loading: false,
					opened: true,
					snapshot,
				});
				setWorktreeDiffError("");
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (diffSnapshotRequestIdRef.current !== requestId) {
					return;
				}
				setWorktreeDiffError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				if (diffSnapshotAbortControllerRef.current === controller) {
					diffSnapshotAbortControllerRef.current = null;
				}
				if (diffSnapshotRequestIdRef.current === requestId) {
					setIsRefreshingWorktreeSnapshot(false);
				}
			}
		},
		[
			abortDiffSnapshotRequest,
			activeSelectedWorktreeOpened,
			activeSelectedWorktreePath,
			procedures,
			selectedProject,
			setWorktreeState,
		],
	);

	const loadDiffFileContentPage = useCallback(
		async (
			path: string,
			options?: {
				cursor?: number;
				reset?: boolean;
			},
		): Promise<void> => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}

			const requestId = ++diffFileContentRequestIdRef.current;
			abortDiffFileContentRequest(
				"Worktree file content request was superseded.",
			);
			const controller = new AbortController();
			diffFileContentAbortControllerRef.current = controller;
			const reset = options?.reset ?? false;
			const cursor = reset ? 0 : Math.max(0, options?.cursor ?? 0);

			if (reset) {
				diffFileContentDecoderRef.current = new TextDecoder();
				setDiffFileContentState({
					...emptyDiffFileContentState(path),
					isLoadingInitial: true,
				});
			} else {
				setDiffFileContentState((current) =>
					current.path === path
						? {
								...current,
								error: "",
								isLoadingMore: true,
							}
						: {
								...emptyDiffFileContentState(path),
								isLoadingInitial: true,
							},
				);
			}

			try {
				const page = await procedures.readWorktreeFileContentPage(
					{
						cursor,
						limitBytes: WORKTREE_FILE_CONTENT_PAGE_BYTES,
						path,
						projectId: selectedProject.id,
						worktreePath: activeSelectedWorktreePath,
					},
					{
						priority: "foreground",
						signal: controller.signal,
					},
				);
				if (diffFileContentRequestIdRef.current !== requestId) {
					return;
				}

				let decodedChunk = "";
				let loadedBytes = page.nextCursor ?? page.totalBytes;
				if (!page.isBinary && !page.isMissing) {
					const decoder =
						reset || !diffFileContentDecoderRef.current
							? new TextDecoder()
							: diffFileContentDecoderRef.current;
					diffFileContentDecoderRef.current = decoder;
					const bytes = decodeBase64Bytes(page.chunkBase64);
					decodedChunk = decoder.decode(bytes, {
						stream: page.nextCursor !== null,
					});
					if (page.nextCursor === null) {
						decodedChunk += decoder.decode();
					}
					loadedBytes = page.cursor + bytes.length;
				}

				setDiffFileContentState((current) => {
					const base =
						reset || current.path !== path
							? emptyDiffFileContentState(path)
							: current;
					return {
						chunks: decodedChunk ? [...base.chunks, decodedChunk] : base.chunks,
						error: "",
						isBinary: page.isBinary,
						isLoadingInitial: false,
						isLoadingMore: false,
						isMissing: page.isMissing,
						loadedBytes,
						nextCursor: page.nextCursor,
						path,
						totalBytes: page.totalBytes,
					};
				});
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (diffFileContentRequestIdRef.current !== requestId) {
					return;
				}
				setDiffFileContentState((current) => ({
					...(current.path === path
						? current
						: emptyDiffFileContentState(path)),
					error: error instanceof Error ? error.message : String(error),
					isLoadingInitial: false,
					isLoadingMore: false,
					path,
				}));
			} finally {
				if (diffFileContentAbortControllerRef.current === controller) {
					diffFileContentAbortControllerRef.current = null;
				}
			}
		},
		[
			abortDiffFileContentRequest,
			activeSelectedWorktreePath,
			procedures,
			selectedProject,
		],
	);

	const loadSelectedDiffFileContent = useCallback(async (): Promise<void> => {
		if (!selectedDiffFilePath) {
			diffFileContentDecoderRef.current = null;
			setDiffFileContentState(emptyDiffFileContentState());
			return;
		}

		await loadDiffFileContentPage(selectedDiffFilePath, {
			reset: true,
		});
	}, [loadDiffFileContentPage, selectedDiffFilePath]);

	const loadMoreDiffFileContent = useCallback(async (): Promise<void> => {
		if (
			!selectedDiffFilePath ||
			diffFileContentState.path !== selectedDiffFilePath ||
			diffFileContentState.nextCursor === null ||
			diffFileContentState.isLoadingInitial ||
			diffFileContentState.isLoadingMore
		) {
			return;
		}

		await loadDiffFileContentPage(selectedDiffFilePath, {
			cursor: diffFileContentState.nextCursor,
		});
	}, [diffFileContentState, loadDiffFileContentPage, selectedDiffFilePath]);

	const clearThreadSelection = useCallback(() => {
		threadOpenRequestIdRef.current += 1;
		abortThreadOpenRequest("Thread selection was cleared.");
		setSelectedThreadId(null);
		setThreadMessages([]);
		setChatError("");
		setModelControlError("");
		setIsThreadLoading(false);
		selectedThreadIdRef.current = null;
		selectedThreadRunStateRef.current = "idle";
	}, [abortThreadOpenRequest]);

	const discardThreadIfEmpty = useCallback(
		async (threadId: number): Promise<void> => {
			try {
				const result = await procedures.discardEmptyThread({ threadId });
				if (!result.discarded) {
					return;
				}
				setThreads((prev) => removeThreadFromList(prev, result.threadId));
			} catch (error) {
				console.error(`Failed to discard empty thread ${threadId}`, error);
			}
		},
		[procedures],
	);

	const loadProjectTasks = useCallback(
		async (projectId: number, worktreePath: string): Promise<void> => {
			const requestId = ++projectTasksRequestIdRef.current;
			abortProjectTasksRequest("Project task request was superseded.");
			const controller = new AbortController();
			projectTasksAbortControllerRef.current = controller;
			setIsLoadingProjectTasks(true);
			setTaskControlError("");

			try {
				const tasks = await procedures.listProjectTasks(
					{
						projectId,
						worktreePath,
					},
					{
						priority: "foreground",
						signal: controller.signal,
					},
				);
				if (projectTasksRequestIdRef.current !== requestId) {
					return;
				}
				setProjectTasks(tasks);
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (projectTasksRequestIdRef.current !== requestId) {
					return;
				}
				setProjectTasks([]);
				setTaskControlError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				if (projectTasksAbortControllerRef.current === controller) {
					projectTasksAbortControllerRef.current = null;
				}
				if (projectTasksRequestIdRef.current === requestId) {
					setIsLoadingProjectTasks(false);
				}
			}
		},
		[abortProjectTasksRequest, procedures],
	);

	const resetGitHistoryScrollPosition = useCallback(() => {
		setGitHistoryScrollTop(0);
		if (gitHistoryListRef.current) {
			gitHistoryListRef.current.scrollTop = 0;
		}
	}, []);

	const cacheGitHistoryResult = useCallback(
		(history: RpcWorktreeGitHistoryResult) => {
			writeLruValue(
				gitHistoryCacheRef.current,
				worktreeKey(history.projectId, history.worktreePath),
				history,
				GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES,
			);
		},
		[],
	);

	const loadGitHistory = useCallback(
		async (
			projectId: number,
			worktreePath: string,
			options?: {
				silent?: boolean;
				preferCached?: boolean;
			},
		): Promise<void> => {
			const requestId = ++gitHistoryRequestIdRef.current;
			abortGitHistoryRequests("Git history request was superseded.");
			const controller = new AbortController();
			gitHistoryAbortControllerRef.current = controller;
			const cacheKey = worktreeKey(projectId, worktreePath);
			const cachedHistory = readLruValue(gitHistoryCacheRef.current, cacheKey);
			const serveCachedHistory = Boolean(
				options?.preferCached && cachedHistory,
			);
			const silentRefresh = options?.silent || serveCachedHistory;
			if (serveCachedHistory && cachedHistory) {
				setGitHistory(cachedHistory);
				setGitHistoryLoading(false);
				setGitHistoryLoadingMore(false);
				gitHistoryLoadingMoreRef.current = false;
				setGitHistoryError("");
			}
			if (!silentRefresh) {
				setGitHistoryLoading(true);
				setGitHistoryError("");
			}

			try {
				const result = await procedures.listWorktreeGitHistory(
					{
						projectId,
						worktreePath,
						offset: 0,
						limit: GIT_HISTORY_PAGE_SIZE,
					},
					{
						priority: silentRefresh ? "default" : "foreground",
						signal: controller.signal,
					},
				);
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}

				const nextHistory = mergeResetGitHistory(cachedHistory, result);
				setGitHistory(nextHistory);
				cacheGitHistoryResult(nextHistory);
				setGitHistoryError("");
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}
				if (!silentRefresh && !cachedHistory) {
					setGitHistory(null);
					setGitHistoryError(
						error instanceof Error ? error.message : String(error),
					);
				}
			} finally {
				if (gitHistoryAbortControllerRef.current === controller) {
					gitHistoryAbortControllerRef.current = null;
				}
				if (gitHistoryRequestIdRef.current === requestId) {
					setGitHistoryLoading(false);
					setGitHistoryLoadingMore(false);
					gitHistoryLoadingMoreRef.current = false;
				}
			}
		},
		[abortGitHistoryRequests, cacheGitHistoryResult, procedures],
	);

	const loadMoreGitHistory = useCallback(async (): Promise<void> => {
		if (
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!gitHistory ||
			gitHistory.nextOffset === null ||
			gitHistoryLoading ||
			gitHistoryLoadingMore ||
			gitHistoryLoadingMoreRef.current
		) {
			return;
		}

		const requestId = gitHistoryRequestIdRef.current;
		const nextOffset = gitHistory.nextOffset;
		const expectedHeadHash = gitHistory.headHash;
		const expectedBranch = gitHistory.branch;
		const controller = new AbortController();
		if (gitHistoryLoadMoreAbortControllerRef.current) {
			gitHistoryLoadMoreAbortControllerRef.current.abort(
				createAbortError(
					null,
					"Git history pagination request was superseded.",
				),
			);
		}
		gitHistoryLoadMoreAbortControllerRef.current = controller;

		gitHistoryLoadingMoreRef.current = true;
		setGitHistoryLoadingMore(true);

		try {
			const result = await procedures.listWorktreeGitHistory(
				{
					projectId: selectedProject.id,
					worktreePath: activeSelectedWorktreePath,
					offset: nextOffset,
					limit: GIT_HISTORY_PAGE_SIZE,
				},
				{
					priority: "foreground",
					signal: controller.signal,
				},
			);
			if (gitHistoryRequestIdRef.current !== requestId) {
				return;
			}

			if (
				result.headHash !== expectedHeadHash ||
				result.branch !== expectedBranch
			) {
				void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
					silent: true,
				});
				return;
			}

			const nextHistory = appendGitHistoryPage(gitHistory, result);
			setGitHistory((current) =>
				current &&
				current.projectId === nextHistory.projectId &&
				current.worktreePath === nextHistory.worktreePath
					? nextHistory
					: current,
			);
			cacheGitHistoryResult(nextHistory);
			setGitHistoryError("");
		} catch (error) {
			if (isAbortError(error)) {
				return;
			}
			if (gitHistoryRequestIdRef.current !== requestId) {
				return;
			}
			setGitHistoryError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			if (gitHistoryLoadMoreAbortControllerRef.current === controller) {
				gitHistoryLoadMoreAbortControllerRef.current = null;
			}
			if (gitHistoryRequestIdRef.current === requestId) {
				setGitHistoryLoadingMore(false);
				gitHistoryLoadingMoreRef.current = false;
			}
		}
	}, [
		activeSelectedWorktreePath,
		cacheGitHistoryResult,
		gitHistory,
		gitHistoryLoading,
		gitHistoryLoadingMore,
		loadGitHistory,
		procedures,
		selectedProject,
	]);

	const handleGitHistoryScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			const container = event.currentTarget;
			setGitHistoryScrollTop(container.scrollTop);

			if (
				container.scrollHeight - container.scrollTop - container.clientHeight <=
				GIT_HISTORY_LOAD_MORE_THRESHOLD_PX
			) {
				void loadMoreGitHistory();
			}
		},
		[loadMoreGitHistory],
	);

	const applyOptimisticThreadErrorSeen = useCallback((thread: RpcThread) => {
		if (!optimisticallyAcknowledgedThreadIdsRef.current.has(thread.id)) {
			return thread;
		}

		return withAcknowledgedUnreadThread(thread);
	}, []);

	const applyOptimisticThreadErrorSeenToDetail = useCallback(
		(detail: RpcThreadDetail) => {
			if (
				!optimisticallyAcknowledgedThreadIdsRef.current.has(detail.thread.id)
			) {
				return detail;
			}

			return withAcknowledgedUnreadThreadDetail(detail);
		},
		[],
	);

	const applyOptimisticThreadErrorSeenToList = useCallback(
		(items: RpcThread[]) => {
			if (optimisticallyAcknowledgedThreadIdsRef.current.size === 0) {
				return items;
			}

			let changed = false;
			const nextItems = items.map((thread) => {
				const nextThread = applyOptimisticThreadErrorSeen(thread);
				if (nextThread !== thread) {
					changed = true;
				}
				return nextThread;
			});

			return changed ? nextItems : items;
		},
		[applyOptimisticThreadErrorSeen],
	);

	const requestThreadErrorSeen = useCallback(
		(threadId: number): Promise<RpcThreadDetail> => {
			const existing = threadErrorSeenRequestCacheRef.current.get(threadId);
			if (existing) {
				return existing;
			}

			const request = procedures
				.markThreadErrorSeen({
					threadId,
				})
				.finally(() => {
					if (
						threadErrorSeenRequestCacheRef.current.get(threadId) === request
					) {
						threadErrorSeenRequestCacheRef.current.delete(threadId);
					}
				});
			threadErrorSeenRequestCacheRef.current.set(threadId, request);
			return request;
		},
		[procedures],
	);

	const acknowledgeThreadErrorSeenInBackground = useCallback(
		(threadId: number) => {
			optimisticallyAcknowledgedThreadIdsRef.current.add(threadId);
			setThreads((prev) => applyOptimisticThreadErrorSeenToList(prev));
			void requestThreadErrorSeen(threadId)
				.then((detail) => {
					optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);

					const settledDetail = applyOptimisticThreadErrorSeenToDetail(detail);
					setThreads((prev) =>
						prev.some((entry) => entry.id === settledDetail.thread.id)
							? upsertThreadList(prev, settledDetail.thread)
							: prev,
					);
					if (selectedThreadIdRef.current === threadId) {
						selectedThreadRunStateRef.current =
							settledDetail.thread.runStatus.state;
						setThreadMessages(settledDetail.messages);
					}
				})
				.catch((error) => {
					optimisticallyAcknowledgedThreadIdsRef.current.delete(threadId);
					console.error(
						`Failed to acknowledge unread thread error for ${threadId}`,
						error,
					);
				});
		},
		[
			applyOptimisticThreadErrorSeenToDetail,
			applyOptimisticThreadErrorSeenToList,
			requestThreadErrorSeen,
		],
	);

	const prepareOpenedThreadDetail = useCallback(
		(detail: RpcThreadDetail): RpcThreadDetail => {
			const optimisticDetail = applyOptimisticThreadErrorSeenToDetail(detail);
			if (!optimisticDetail.thread.runStatus.hasUnreadError) {
				return optimisticDetail;
			}

			acknowledgeThreadErrorSeenInBackground(detail.thread.id);
			return withAcknowledgedUnreadThreadDetail(detail);
		},
		[
			acknowledgeThreadErrorSeenInBackground,
			applyOptimisticThreadErrorSeenToDetail,
		],
	);

	const refreshThreadStatuses = useCallback(async () => {
		const activeSelectedThreadId = selectedThreadIdRef.current;
		const loadedThreads = applyOptimisticThreadErrorSeenToList(
			sortThreads(await procedures.listThreads()),
		);
		const selectedSummary =
			activeSelectedThreadId === null
				? null
				: (loadedThreads.find(
						(thread) => thread.id === activeSelectedThreadId,
					) ?? null);

		if (!selectedSummary) {
			selectedThreadRunStateRef.current = "idle";
			setThreads(loadedThreads);
			return;
		}

		const shouldRefreshSelectedDetail =
			selectedSummary.runStatus.state === "working" ||
			selectedThreadRunStateRef.current === "working" ||
			(selectedSummary.runStatus.state === "failed" &&
				selectedThreadRunStateRef.current !== "failed") ||
			(selectedSummary.runStatus.state === "stopped" &&
				selectedThreadRunStateRef.current !== "stopped");

		if (!shouldRefreshSelectedDetail) {
			selectedThreadRunStateRef.current = selectedSummary.runStatus.state;
			setThreads(loadedThreads);
			return;
		}

		const detail = prepareOpenedThreadDetail(
			await procedures.getThread({
				threadId: selectedSummary.id,
			}),
		);
		if (selectedThreadIdRef.current !== selectedSummary.id) {
			setThreads(loadedThreads);
			return;
		}
		selectedThreadRunStateRef.current = detail.thread.runStatus.state;
		setThreads(upsertThreadList(loadedThreads, detail.thread));
		setThreadMessages(detail.messages);
	}, [
		applyOptimisticThreadErrorSeenToList,
		prepareOpenedThreadDetail,
		procedures,
	]);

	const applyOpenedThreadDetail = useCallback(
		(detail: RpcThreadDetail) => {
			setThreads((prev) => upsertThreadList(prev, detail.thread));
			setSelectedThreadId(detail.thread.id);
			selectedThreadIdRef.current = detail.thread.id;
			selectedThreadRunStateRef.current = detail.thread.runStatus.state;
			setThreadMessages(detail.messages);
			syncThreadContext(detail.thread);
			void loadProjectWorktrees(detail.thread.projectId).catch(() => {
				// Best effort; thread history should still open even if worktree metadata refresh fails.
			});
			setMobileProjectListOpen(false);
		},
		[loadProjectWorktrees, syncThreadContext],
	);

	const loadThreadDetailForOpen = useCallback(
		async (
			threadId: number,
			signal: AbortSignal,
			options?: OpenThreadOptions,
		): Promise<RpcThreadDetail> => {
			const prefetchedDetail = options?.detailPromise
				? await awaitAbortableResult(
						options.detailPromise.catch(() => null),
						signal,
						"Thread open request was aborted.",
					)
				: null;
			if (prefetchedDetail) {
				return prefetchedDetail;
			}

			return procedures.getThread(
				{ threadId },
				{
					priority: "foreground",
					signal,
				},
			);
		},
		[procedures],
	);

	const openThread = useCallback(
		async (threadId: number, options?: OpenThreadOptions) => {
			const requestId = ++threadOpenRequestIdRef.current;
			abortThreadOpenRequest("Thread open request was superseded.");
			const controller = new AbortController();
			threadOpenAbortControllerRef.current = controller;
			setIsThreadLoading(true);
			setThreadsError("");
			setChatError("");
			setModelControlError("");
			try {
				const detail = prepareOpenedThreadDetail(
					await loadThreadDetailForOpen(threadId, controller.signal, options),
				);
				if (threadOpenRequestIdRef.current !== requestId) {
					return;
				}
				applyOpenedThreadDetail(detail);
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (threadOpenRequestIdRef.current !== requestId) {
					return;
				}
				setThreadsError(error instanceof Error ? error.message : String(error));
			} finally {
				if (threadOpenAbortControllerRef.current === controller) {
					threadOpenAbortControllerRef.current = null;
				}
				if (threadOpenRequestIdRef.current === requestId) {
					setIsThreadLoading(false);
				}
			}
		},
		[
			abortThreadOpenRequest,
			applyOpenedThreadDetail,
			loadThreadDetailForOpen,
			prepareOpenedThreadDetail,
		],
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

	const clearDirectorySuggestionPrefetchTimer = useCallback(() => {
		if (directorySuggestionPrefetchTimerRef.current !== null) {
			window.clearTimeout(directorySuggestionPrefetchTimerRef.current);
			directorySuggestionPrefetchTimerRef.current = null;
		}
	}, []);

	const readCachedDirectorySuggestions = useCallback((query: string) => {
		const normalizedQuery = query.trim();
		if (!normalizedQuery) {
			return null;
		}

		const cached = readLruValue(
			directorySuggestionResultCacheRef.current,
			normalizedQuery,
		);
		if (!cached) {
			return null;
		}

		return {
			directories: cached.directories,
			isStale:
				cached.loadedAt + DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS < Date.now(),
		};
	}, []);

	const cacheDirectorySuggestions = useCallback(
		(query: string, directories: string[]) => {
			const normalizedQuery = query.trim();
			if (!normalizedQuery) {
				return;
			}

			writeLruValue(
				directorySuggestionResultCacheRef.current,
				normalizedQuery,
				{
					directories,
					loadedAt: Date.now(),
				},
				DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES,
			);
			prefetchedDirectorySuggestionQueriesRef.current.add(normalizedQuery);
		},
		[],
	);

	const abortDirectorySuggestionRequest = useCallback((reason: string) => {
		const controller = directorySuggestionAbortControllerRef.current;
		if (!controller) {
			return;
		}

		directorySuggestionAbortControllerRef.current = null;
		controller.abort(createAbortError(null, reason));
	}, []);

	const fetchDirectorySuggestions = useCallback(
		async (
			query: string,
			options?: {
				forceRefresh?: boolean | undefined;
				priority?: RpcRequestPriority;
				signal?: AbortSignal;
			},
		): Promise<string[]> => {
			const normalizedQuery = query.trim();
			if (!normalizedQuery) {
				return [];
			}

			const cached = readCachedDirectorySuggestions(normalizedQuery);
			if (cached && !cached.isStale && !options?.forceRefresh) {
				return cached.directories;
			}

			const inFlight =
				directorySuggestionRequestCacheRef.current.get(normalizedQuery);
			if (inFlight) {
				inFlight.waiterCount += 1;
				try {
					return await awaitAbortableResult(
						inFlight.promise,
						options?.signal,
						"Directory suggestion request was aborted.",
					);
				} finally {
					inFlight.waiterCount = Math.max(0, inFlight.waiterCount - 1);
					if (
						inFlight.waiterCount === 0 &&
						directorySuggestionRequestCacheRef.current.get(normalizedQuery) ===
							inFlight
					) {
						inFlight.controller.abort(
							createAbortError(
								null,
								"Directory suggestion request was aborted.",
							),
						);
					}
				}
			}

			const controller = new AbortController();
			const pendingRequest: PendingSharedRequest<string[]> = {
				controller,
				promise: Promise.resolve([]),
				waiterCount: 1,
			};
			const request = procedures
				.listDirectorySuggestions(
					{ query: normalizedQuery },
					{
						priority: options?.priority ?? "foreground",
						signal: controller.signal,
					},
				)
				.then((result) => {
					cacheDirectorySuggestions(normalizedQuery, result.directories);
					return result.directories;
				})
				.finally(() => {
					directorySuggestionRequestCacheRef.current.delete(normalizedQuery);
				});
			pendingRequest.promise = request;
			directorySuggestionRequestCacheRef.current.set(
				normalizedQuery,
				pendingRequest,
			);

			try {
				return await awaitAbortableResult(
					request,
					options?.signal,
					"Directory suggestion request was aborted.",
				);
			} finally {
				pendingRequest.waiterCount = Math.max(
					0,
					pendingRequest.waiterCount - 1,
				);
				if (
					pendingRequest.waiterCount === 0 &&
					directorySuggestionRequestCacheRef.current.get(normalizedQuery) ===
						pendingRequest
				) {
					controller.abort(
						createAbortError(null, "Directory suggestion request was aborted."),
					);
				}
			}
		},
		[cacheDirectorySuggestions, procedures, readCachedDirectorySuggestions],
	);

	const prefetchDirectorySuggestions = useCallback(
		async (query: string) => {
			const normalizedQuery = query.trim();
			if (!normalizedQuery) {
				return;
			}
			if (
				prefetchedDirectorySuggestionQueriesRef.current.has(normalizedQuery)
			) {
				return;
			}

			prefetchedDirectorySuggestionQueriesRef.current.add(normalizedQuery);
			try {
				await fetchDirectorySuggestions(normalizedQuery, {
					priority: "background",
				});
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				prefetchedDirectorySuggestionQueriesRef.current.delete(normalizedQuery);
			}
		},
		[fetchDirectorySuggestions],
	);

	const scheduleDirectorySuggestionPrefetch = useCallback(
		(directory: string) => {
			const prefetchQuery = formatDirectoryPathForInput(
				directory,
				homeDirectory,
				supportsTildePath,
			);
			if (!prefetchQuery.trim()) {
				return;
			}
			if (
				prefetchedDirectorySuggestionQueriesRef.current.has(
					prefetchQuery.trim(),
				)
			) {
				return;
			}

			clearDirectorySuggestionPrefetchTimer();
			directorySuggestionPrefetchTimerRef.current = window.setTimeout(() => {
				directorySuggestionPrefetchTimerRef.current = null;
				void prefetchDirectorySuggestions(prefetchQuery);
			}, DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS);
		},
		[
			clearDirectorySuggestionPrefetchTimer,
			homeDirectory,
			prefetchDirectorySuggestions,
			supportsTildePath,
		],
	);

	const initialize = useCallback(async () => {
		const persistedState = initialMainviewState;

		try {
			const [loaded, homeDirectoryResult, loadedThreads, modelCatalog] =
				await Promise.all([
					procedures.listProjects({ includeClosed: true }),
					procedures.getHomeDirectory(),
					procedures.listThreads(),
					procedures.getCodexModelCatalog(),
				]);
			const sortedThreads = sortThreads(loadedThreads);
			const initialThread = pickInitialThread(sortedThreads, persistedState);
			const openProjects = loaded.filter((project) => project.isOpen === 1);
			const restoredOpenProjectIds = new Set(
				openProjects.map((project) => project.id),
			);
			for (const entry of persistedState.openWorktrees) {
				restoredOpenProjectIds.add(entry.projectId);
			}
			if (persistedState.selectedProjectId !== null) {
				restoredOpenProjectIds.add(persistedState.selectedProjectId);
			}
			if (initialThread) {
				restoredOpenProjectIds.add(initialThread.projectId);
			}
			const optimisticProjects = loaded.map((project) =>
				restoredOpenProjectIds.has(project.id)
					? {
							...project,
							isOpen: 1 as const,
						}
					: project,
			);
			const initialThreadProject =
				initialThread === null
					? undefined
					: optimisticProjects.find(
							(project) => project.id === initialThread.projectId,
						);
			const initialProject =
				initialThreadProject ??
				optimisticProjects.find(
					(project) => project.id === persistedState.selectedProjectId,
				) ??
				optimisticProjects[0] ??
				null;
			const initialWorktreePath =
				initialThread?.worktreePath ??
				(initialProject === null
					? null
					: initialProject.id === persistedState.selectedProjectId &&
							persistedState.selectedWorktreePath
						? persistedState.selectedWorktreePath
						: initialProject.path);

			setProjects(optimisticProjects);
			setThreads(sortedThreads);
			setCodexModels(modelCatalog.models);
			setDefaultCodexModel(modelCatalog.defaultModel);
			setReasoningEfforts(modelCatalog.reasoningEfforts);
			setDefaultCodexReasoningEffort(modelCatalog.defaultReasoningEffort);
			setPendingThreadModel((current) => current || modelCatalog.defaultModel);
			setPendingThreadReasoningEffort(
				(current) => current || modelCatalog.defaultReasoningEffort,
			);
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
			selectedProjectIdRef.current = initialProject?.id ?? null;
			selectedWorktreePathRef.current = initialWorktreePath;
			setSelectedProjectId(initialProject?.id ?? null);
			setSelectedWorktreePath(initialWorktreePath);

			const startupDirectoryPrefetchQuery =
				homeDirectoryResult.supportsTildePath
					? "~/"
					: formatDirectoryPathForInput(
							homeDirectoryResult.homeDirectory,
							homeDirectoryResult.homeDirectory,
							homeDirectoryResult.supportsTildePath,
						);
			homeDirectoryPrefetchQueryRef.current = startupDirectoryPrefetchQuery;
			void prefetchDirectorySuggestions(startupDirectoryPrefetchQuery);

			await Promise.resolve();

			const initialThreadDetailPromise = initialThread
				? procedures.getThread(
						{
							threadId: initialThread.id,
						},
						{
							priority: "foreground",
						},
					)
				: null;
			const initialThreadOpenPromise = initialThread
				? openThread(initialThread.id, {
						detailPromise: initialThreadDetailPromise,
					})
				: null;

			const initiallyOpenProjectTreePaths = new Set(
				initialTreeViewState.openProjectPaths,
			);
			const restoredProjects = loaded.filter((project) =>
				restoredOpenProjectIds.has(project.id),
			);

			for (const project of restoredProjects) {
				setProjectState(project.id, {
					loadingWorktrees:
						initiallyOpenProjectTreePaths.has(project.path) &&
						getProjectState(project.id).worktrees.length === 0,
					error: "",
				});
			}

			const restoredProjectWorktreesPromise = Promise.all(
				restoredProjects.map(async (project) => {
					try {
						const result = await procedures.openProject({
							projectPath: project.path,
							name: project.name,
						});
						setProjects((prev) => upsertProjectList(prev, result.project));
						setProjectState(result.project.id, {
							worktrees: result.worktrees,
							loadingWorktrees: false,
							error: "",
						});
					} catch (error) {
						setProjectState(project.id, {
							loadingWorktrees: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}),
			);

			const restoredOpenWorktreesPromise = Promise.all(
				persistedState.openWorktrees
					.filter(({ projectId }) => restoredOpenProjectIds.has(projectId))
					.map(async ({ projectId, worktreePath }) => {
						try {
							const result = await procedures.openWorktree({
								projectId,
								worktreePath,
							});
							return {
								ok: true as const,
								history: result.history,
								projectId,
								snapshot: result.worktree,
								worktreePath,
							};
						} catch (error) {
							return {
								ok: false as const,
								projectId,
								error: error instanceof Error ? error.message : String(error),
								worktreePath,
							};
						}
					}),
			);

			await restoredProjectWorktreesPromise;
			const restoredOpenWorktrees = await restoredOpenWorktreesPromise;

			for (const result of restoredOpenWorktrees) {
				if (result.ok) {
					cacheGitHistoryResult(result.history);
					setWorktreeState(result.projectId, result.worktreePath, {
						loading: false,
						opened: true,
						snapshot: result.snapshot,
						error: "",
					});
					continue;
				}

				setWorktreeState(result.projectId, result.worktreePath, {
					loading: false,
					opened: false,
					snapshot: undefined,
					error: result.error,
				});
			}

			if (restoredOpenWorktrees.some((result) => result.ok)) {
				setProjectStates((prev) => {
					const next = { ...prev } as ProjectStateMap;
					for (const result of restoredOpenWorktrees) {
						if (!result.ok) {
							continue;
						}
						const current = next[result.projectId] ?? defaultProjectState();
						next[result.projectId] = {
							...current,
							openWorktrees: new Set([
								...current.openWorktrees,
								result.worktreePath,
							]),
						};
					}
					return next;
				});
			}

			if (initialThread) {
				await initialThreadOpenPromise;
				return;
			}
		} catch (error) {
			setThreadsError(error instanceof Error ? error.message : String(error));
		} finally {
			setSessionStateReady(true);
		}
	}, [
		cacheGitHistoryResult,
		getProjectState,
		hydrateProjectRows,
		initialMainviewState,
		initialTreeViewState,
		openThread,
		prefetchDirectorySuggestions,
		procedures,
		setProjectState,
		setWorktreeState,
	]);

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

	const closeThreadActionMenu = useCallback(() => {
		setThreadActionMenu(null);
		setThreadActionMenuError("");
		setThreadRenameTitle("");
		setThreadRenameSummary("");
		setThreadActionBusy(null);
	}, []);

	const openProjectActionMenu = useCallback(
		async (project: RpcProject, x: number, y: number) => {
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;
			const requestId = ++projectActionMenuRequestId.current;

			closeThreadActionMenu();
			setProjectActionMenu({
				projectId: project.id,
				x: clampProjectMenuCoordinate(x, viewportWidth, 336),
				y: clampProjectMenuCoordinate(y, viewportHeight, 420),
			});
			setProjectActionMenuError("");
			setProjectActionMenuLoading(
				getProjectState(project.id).worktrees.length === 0,
			);
			setNewWorktreeName("");

			try {
				await loadProjectWorktrees(project.id, {
					backgroundRefresh: true,
				});
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
		[closeThreadActionMenu, getProjectState, loadProjectWorktrees],
	);

	const openThreadActionMenu = useCallback(
		(thread: RpcThread, x: number, y: number) => {
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;

			closeProjectActionMenu();
			setThreadActionMenu({
				threadId: thread.id,
				x: clampProjectMenuCoordinate(x, viewportWidth, 336),
				y: clampProjectMenuCoordinate(y, viewportHeight, 396),
			});
			setThreadActionMenuError("");
			setThreadRenameTitle(thread.title);
			setThreadRenameSummary(thread.summary ?? "");
			setThreadActionBusy(null);
		},
		[closeProjectActionMenu],
	);

	const deleteTrackedProject = useCallback(
		async (projectId: number) => {
			const removedProjectPath =
				projects.find((project) => project.id === projectId)?.path ?? null;
			try {
				await procedures.deleteProject({ projectId });
				const [loaded, loadedThreads] = await Promise.all([
					procedures.listProjects({ includeClosed: true }),
					procedures.listThreads(),
				]);
				setProjects(loaded);
				setThreads(sortThreads(loadedThreads));
				hydrateProjectRows(loaded);
				clearProjectState(projectId);
				if (removedProjectPath) {
					setProjectTreeOpen(removedProjectPath, false);
				}
				const nextSelectedProjectId =
					selectedProjectId &&
					loaded.some((project) => project.id === selectedProjectId)
						? selectedProjectId
						: (loaded[0]?.id ?? null);
				selectedProjectIdRef.current = nextSelectedProjectId;
				setSelectedProjectId(nextSelectedProjectId);
				if (selectedProjectId === projectId) {
					selectedWorktreePathRef.current = loaded[0]?.path ?? null;
					setSelectedWorktreePath(loaded[0]?.path ?? null);
				}
				if (selectedThreadId) {
					if (loadedThreads.some((thread) => thread.id === selectedThreadId)) {
						void openThread(selectedThreadId);
					} else if (loadedThreads[0]) {
						void openThread(loadedThreads[0].id);
					} else {
						clearThreadSelection();
					}
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
			clearThreadSelection,
			hydrateProjectRows,
			openThread,
			projects,
			procedures,
			projectActionMenu,
			selectedProjectId,
			selectedThreadId,
			setProjectState,
			setProjectTreeOpen,
		],
	);

	const toggleWorktreePinned = useCallback(
		async (projectId: number, worktreePath: string, pinned: boolean) => {
			if (worktreePinBusyPath || isCreatingWorktree) {
				return;
			}

			setWorktreePinBusyPath(worktreePath);
			setProjectActionMenuError("");
			setProjectState(projectId, { error: "" });
			try {
				const result = await procedures.setWorktreePinned({
					projectId,
					worktreePath,
					pinned: !pinned,
				});
				setProjectState(projectId, {
					worktrees: result.worktrees,
					loadingWorktrees: false,
					error: "",
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setProjectState(projectId, { error: message });
				if (projectActionMenu?.projectId === projectId) {
					setProjectActionMenuError(message);
				}
			} finally {
				setWorktreePinBusyPath(null);
			}
		},
		[
			isCreatingWorktree,
			procedures,
			projectActionMenu,
			setProjectState,
			worktreePinBusyPath,
		],
	);

	const submitThreadRename = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!threadActionMenuThread || threadActionBusy) {
				return;
			}

			const title = threadRenameTitle.trim();
			if (!title) {
				setThreadActionMenuError("Enter a thread title.");
				return;
			}

			setThreadActionBusy("rename");
			setThreadActionMenuError("");
			try {
				const updatedThread = await procedures.renameThread({
					threadId: threadActionMenuThread.id,
					title,
					summary: threadRenameSummary,
				});
				setThreads((prev) => upsertThreadList(prev, updatedThread));
				setThreadRenameTitle(updatedThread.title);
				setThreadRenameSummary(updatedThread.summary ?? "");
			} catch (error) {
				setThreadActionMenuError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setThreadActionBusy(null);
			}
		},
		[
			procedures,
			threadActionBusy,
			threadActionMenuThread,
			threadRenameSummary,
			threadRenameTitle,
		],
	);

	const toggleThreadPinned = useCallback(async () => {
		if (!threadActionMenuThread || threadActionBusy) {
			return;
		}

		setThreadActionBusy("pin");
		setThreadActionMenuError("");
		try {
			const updatedThread = await procedures.setThreadPinned({
				threadId: threadActionMenuThread.id,
				pinned: !threadActionMenuThread.pinnedAt,
			});
			setThreads((prev) => upsertThreadList(prev, updatedThread));
		} catch (error) {
			setThreadActionMenuError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setThreadActionBusy(null);
		}
	}, [procedures, threadActionBusy, threadActionMenuThread]);

	const deleteSelectedThread = useCallback(async () => {
		if (!threadActionMenuThread || threadActionBusy) {
			return;
		}

		setThreadActionBusy("delete");
		setThreadActionMenuError("");
		try {
			await procedures.deleteThread({
				threadId: threadActionMenuThread.id,
			});
			setThreads((prev) =>
				removeThreadFromList(prev, threadActionMenuThread.id),
			);
			if (selectedThreadId === threadActionMenuThread.id) {
				clearThreadSelection();
			}
			closeThreadActionMenu();
		} catch (error) {
			setThreadActionMenuError(
				error instanceof Error ? error.message : String(error),
			);
			setThreadActionBusy(null);
		}
	}, [
		clearThreadSelection,
		closeThreadActionMenu,
		procedures,
		selectedThreadId,
		threadActionBusy,
		threadActionMenuThread,
	]);

	const submitNewWorktree = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (!projectActionMenu || isCreatingWorktree || worktreePinBusyPath) {
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
			worktreePinBusyPath,
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
		if (!threadActionMenu) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (
				threadActionMenuRef.current &&
				!threadActionMenuRef.current.contains(event.target as Node)
			) {
				closeThreadActionMenu();
			}
		};

		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				closeThreadActionMenu();
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [closeThreadActionMenu, threadActionMenu]);

	useEffect(() => {
		if (threadActionMenu && !threadActionMenuThread) {
			closeThreadActionMenu();
		}
	}, [closeThreadActionMenu, threadActionMenu, threadActionMenuThread]);

	useEffect(() => {
		const dismissErrorPreview = () => {
			hideErrorPreview();
			hideThreadSummaryPreview();
		};

		window.addEventListener("resize", dismissErrorPreview);
		window.addEventListener("scroll", dismissErrorPreview, true);
		document.addEventListener("mousedown", dismissErrorPreview);
		return () => {
			window.removeEventListener("resize", dismissErrorPreview);
			window.removeEventListener("scroll", dismissErrorPreview, true);
			document.removeEventListener("mousedown", dismissErrorPreview);
		};
	}, [hideErrorPreview, hideThreadSummaryPreview]);

	useEffect(() => {
		const previousThreadId = previousSelectedThreadIdRef.current;
		selectedThreadIdRef.current = selectedThreadId;
		if (previousThreadId !== null && previousThreadId !== selectedThreadId) {
			void discardThreadIfEmpty(previousThreadId);
		}
		previousSelectedThreadIdRef.current = selectedThreadId;
	}, [discardThreadIfEmpty, selectedThreadId]);

	useEffect(() => {
		selectedProjectIdRef.current = selectedProjectId;
	}, [selectedProjectId]);

	useEffect(() => {
		selectedWorktreePathRef.current = selectedWorktreePath;
	}, [selectedWorktreePath]);

	useEffect(() => {
		const handleVisibilityChange = () => {
			setIsDocumentVisible(document.visibilityState === "visible");
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
		};
	}, []);

	useEffect(() => {
		void procedures
			.setActiveWorktree({
				projectId: activePollingProjectId,
				worktreePath: activePollingWorktreePath,
			})
			.catch(() => {
				// Best effort; active worktree polling will resync on the next selection or visibility change.
			});
	}, [activePollingProjectId, activePollingWorktreePath, procedures]);

	useEffect(() => {
		return () => {
			diffSnapshotRequestIdRef.current += 1;
			diffFileContentRequestIdRef.current += 1;
			abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
			abortDiffFileContentRequest("Worktree file content request was cleared.");
		};
	}, [abortDiffFileContentRequest, abortDiffSnapshotRequest]);

	useEffect(() => {
		if (
			selectedProject &&
			activeSelectedWorktreePath &&
			activeSelectedWorktreeOpened
		) {
			return;
		}

		diffSnapshotRequestIdRef.current += 1;
		diffFileContentRequestIdRef.current += 1;
		diffFileContentDecoderRef.current = null;
		abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
		abortDiffFileContentRequest("Worktree file content request was cleared.");
		setIsRefreshingWorktreeSnapshot(false);
		setWorktreeDiffError("");
		setSelectedDiffFilePath(null);
		setDiffFileContentState(emptyDiffFileContentState());
	}, [
		abortDiffFileContentRequest,
		abortDiffSnapshotRequest,
		activeSelectedWorktreeOpened,
		activeSelectedWorktreePath,
		selectedProject,
	]);

	useEffect(() => {
		if (
			primaryView !== "diff" ||
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened ||
			!isDocumentVisible
		) {
			return;
		}

		void refreshActiveWorktreeSnapshot();
		const timer = window.setInterval(() => {
			void refreshActiveWorktreeSnapshot({
				background: true,
			});
		}, WORKTREE_DIFF_POLL_INTERVAL_MS);

		return () => {
			window.clearInterval(timer);
			diffSnapshotRequestIdRef.current += 1;
			abortDiffSnapshotRequest("Worktree diff snapshot request was cleared.");
			setIsRefreshingWorktreeSnapshot(false);
		};
	}, [
		abortDiffSnapshotRequest,
		activeSelectedWorktreeOpened,
		activeSelectedWorktreePath,
		isDocumentVisible,
		primaryView,
		refreshActiveWorktreeSnapshot,
		selectedProject,
	]);

	useEffect(() => {
		if (activeWorktreeChanges.length === 0) {
			setSelectedDiffFilePath(null);
			return;
		}

		setSelectedDiffFilePath((current) => {
			if (
				current &&
				activeWorktreeChanges.some((change) => change.path === current)
			) {
				return current;
			}
			return activeWorktreeChanges[0]?.path ?? null;
		});
	}, [activeWorktreeChanges]);

	useEffect(() => {
		if (
			primaryView !== "diff" ||
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened ||
			!selectedDiffFilePath
		) {
			diffFileContentRequestIdRef.current += 1;
			diffFileContentDecoderRef.current = null;
			abortDiffFileContentRequest("Worktree file content request was cleared.");
			setDiffFileContentState(emptyDiffFileContentState(selectedDiffFilePath));
			return;
		}

		void loadSelectedDiffFileContent();
		return () => {
			diffFileContentRequestIdRef.current += 1;
			diffFileContentDecoderRef.current = null;
			abortDiffFileContentRequest("Worktree file content request was cleared.");
		};
	}, [
		abortDiffFileContentRequest,
		activeSelectedWorktreeOpened,
		activeSelectedWorktreePath,
		loadSelectedDiffFileContent,
		primaryView,
		selectedDiffFilePath,
		selectedProject,
	]);

	useEffect(() => {
		if (
			primaryView !== "diff" ||
			diffFileContentState.isLoadingInitial ||
			diffFileContentState.isLoadingMore ||
			diffFileContentState.nextCursor === null
		) {
			return;
		}

		const containers = [
			desktopDiffContentScrollRef.current,
			mobileDiffContentScrollRef.current,
		].filter((container): container is HTMLDivElement => container !== null);
		if (
			containers.some(
				(container) =>
					container.clientHeight > 0 &&
					container.scrollHeight <=
						container.clientHeight + WORKTREE_FILE_CONTENT_LOAD_THRESHOLD_PX,
			)
		) {
			void loadMoreDiffFileContent();
		}
	}, [
		diffFileContentState.isLoadingInitial,
		diffFileContentState.isLoadingMore,
		diffFileContentState.nextCursor,
		loadMoreDiffFileContent,
		primaryView,
	]);

	useEffect(() => {
		if (!sessionStateReady) {
			return;
		}

		writePersistedMainviewState({
			version: MAINVIEW_STATE_STORAGE_VERSION,
			selectedProjectId,
			selectedWorktreePath,
			selectedThreadId,
			pendingThreadModel,
			pendingThreadReasoningEffort,
			chatInput,
			sidebarCollapsed,
			sidebarSearchQuery,
			openWorktrees: serializeOpenWorktrees(projectStates),
		});
	}, [
		chatInput,
		pendingThreadModel,
		pendingThreadReasoningEffort,
		projectStates,
		selectedProjectId,
		selectedThreadId,
		selectedWorktreePath,
		sessionStateReady,
		sidebarCollapsed,
		sidebarSearchQuery,
	]);

	useEffect(() => {
		if (!sessionStateReady) {
			return;
		}

		writePersistedTreeViewState({
			version: TREE_VIEW_STATE_STORAGE_VERSION,
			projectsSectionOpen,
			threadsSectionOpen,
			gitSectionOpen,
			openProjectPaths: [...openProjectTreePaths].filter((projectPath) =>
				projects.some((project) => project.path === projectPath),
			),
		});
	}, [
		gitSectionOpen,
		openProjectTreePaths,
		projects,
		projectsSectionOpen,
		sessionStateReady,
		threadsSectionOpen,
	]);

	useEffect(() => {
		if (selectedThread?.model) {
			setPendingThreadModel(selectedThread.model);
			setModelControlError("");
			return;
		}
		if (defaultCodexModel) {
			setPendingThreadModel(defaultCodexModel);
		}
	}, [defaultCodexModel, selectedThread]);

	useEffect(() => {
		if (selectedThread?.reasoningEffort) {
			setPendingThreadReasoningEffort(selectedThread.reasoningEffort);
			setReasoningEffortControlError("");
			return;
		}
		if (defaultCodexReasoningEffort) {
			setPendingThreadReasoningEffort(defaultCodexReasoningEffort);
		}
	}, [defaultCodexReasoningEffort, selectedThread]);

	useEffect(() => {
		if (
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened
		) {
			projectTasksRequestIdRef.current += 1;
			abortProjectTasksRequest("Project task request was cleared.");
			setProjectTasks([]);
			setIsLoadingProjectTasks(false);
			setTaskControlError("");
			return;
		}
		void loadProjectTasks(selectedProject.id, activeSelectedWorktreePath);
	}, [
		activeSelectedWorktreePath,
		activeSelectedWorktreeOpened,
		abortProjectTasksRequest,
		loadProjectTasks,
		selectedProject,
	]);

	useEffect(() => {
		if (!selectedProject || !activeSelectedWorktreePath) {
			gitHistoryRequestIdRef.current += 1;
			abortGitHistoryRequests("Git history request was cleared.");
			setGitHistory(null);
			setGitHistoryLoading(false);
			setGitHistoryLoadingMore(false);
			gitHistoryLoadingMoreRef.current = false;
			setGitHistoryError("");
			resetGitHistoryScrollPosition();
			return;
		}
		resetGitHistoryScrollPosition();
		void loadGitHistory(selectedProject.id, activeSelectedWorktreePath, {
			preferCached: true,
		});
	}, [
		activeSelectedWorktreePath,
		abortGitHistoryRequests,
		loadGitHistory,
		resetGitHistoryScrollPosition,
		selectedProject,
	]);

	useEffect(() => {
		resetGitHistoryScrollPosition();
	}, [resetGitHistoryScrollPosition]);

	useEffect(() => {
		const handleWorktreeTasksChanged = (
			event: CustomEvent<RpcWorktreeTasksChanged>,
		) => {
			if (
				!selectedProject ||
				!activeSelectedWorktreePath ||
				!activeSelectedWorktreeOpened
			) {
				return;
			}
			if (
				event.detail.projectId !== selectedProject.id ||
				event.detail.worktreePath !== activeSelectedWorktreePath
			) {
				return;
			}
			void loadProjectTasks(event.detail.projectId, event.detail.worktreePath);
		};

		window.addEventListener(
			WORKTREE_TASKS_CHANGED_EVENT_NAME,
			handleWorktreeTasksChanged,
		);
		return () => {
			window.removeEventListener(
				WORKTREE_TASKS_CHANGED_EVENT_NAME,
				handleWorktreeTasksChanged,
			);
		};
	}, [
		activeSelectedWorktreePath,
		activeSelectedWorktreeOpened,
		loadProjectTasks,
		selectedProject,
	]);

	useEffect(() => {
		const handleWorktreeGitHistoryChanged = (
			event: CustomEvent<RpcWorktreeGitHistoryChanged>,
		) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}
			if (
				event.detail.projectId !== selectedProject.id ||
				event.detail.worktreePath !== activeSelectedWorktreePath
			) {
				return;
			}
			void loadGitHistory(event.detail.projectId, event.detail.worktreePath, {
				silent: true,
			});
		};

		window.addEventListener(
			WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
			handleWorktreeGitHistoryChanged,
		);
		return () => {
			window.removeEventListener(
				WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME,
				handleWorktreeGitHistoryChanged,
			);
		};
	}, [activeSelectedWorktreePath, loadGitHistory, selectedProject]);

	useEffect(() => {
		if (
			!normalizedSidebarSearchQuery ||
			!gitHistory ||
			gitHistory.nextOffset === null ||
			gitHistoryLoading ||
			gitHistoryLoadingMore
		) {
			return;
		}
		if (filteredGitHistoryEntries.length >= GIT_HISTORY_PAGE_SIZE) {
			return;
		}
		void loadMoreGitHistory();
	}, [
		filteredGitHistoryEntries.length,
		gitHistory,
		gitHistoryLoading,
		gitHistoryLoadingMore,
		loadMoreGitHistory,
		normalizedSidebarSearchQuery,
	]);

	useEffect(() => {
		if (!gitHistoryModal) {
			return;
		}
		if (
			!selectedProject ||
			!activeSelectedWorktreePath ||
			gitHistoryModal.projectId !== selectedProject.id ||
			gitHistoryModal.worktreePath !== activeSelectedWorktreePath
		) {
			closeGitHistoryModal();
		}
	}, [
		activeSelectedWorktreePath,
		closeGitHistoryModal,
		gitHistoryModal,
		selectedProject,
	]);

	useEffect(() => {
		const preloadScope = `${selectedProject?.id ?? "none"}::${
			activeSelectedWorktreePath ?? "none"
		}`;
		return () => {
			abortAllGitHistoryDiffPreloads(
				`Commit diff preload was cleared for ${preloadScope}.`,
			);
		};
	}, [
		abortAllGitHistoryDiffPreloads,
		activeSelectedWorktreePath,
		selectedProject?.id,
	]);

	useEffect(
		() => () => {
			gitHistoryDiffRequestIdRef.current += 1;
			abortGitHistoryDiffRequest("Commit diff request was cleared.");
		},
		[abortGitHistoryDiffRequest],
	);

	useEffect(() => {
		if (!gitHistoryModal) {
			return;
		}

		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				closeGitHistoryModal();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [closeGitHistoryModal, gitHistoryModal]);

	useEffect(() => {
		if (
			!selectedProjectId ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened
		) {
			return;
		}
		if (
			selectedThread &&
			selectedThread.projectId === selectedProjectId &&
			selectedThread.worktreePath === activeSelectedWorktreePath
		) {
			return;
		}
		const pinnedThread = pinnedThreadForWorktree(
			threads,
			selectedProjectId,
			activeSelectedWorktreePath,
		);
		if (!pinnedThread) {
			if (selectedThreadId !== null) {
				clearThreadSelection();
			}
			return;
		}
		if (selectedThreadId === pinnedThread.id) {
			return;
		}
		void openThread(pinnedThread.id);
	}, [
		activeSelectedWorktreePath,
		activeSelectedWorktreeOpened,
		clearThreadSelection,
		openThread,
		selectedProjectId,
		selectedThread,
		selectedThreadId,
		threads,
	]);

	useEffect(() => {
		if (!selectedThreadId || selectedThread) {
			return;
		}
		if (threads[0]) {
			void openThread(threads[0].id);
			return;
		}
		clearThreadSelection();
	}, [
		clearThreadSelection,
		openThread,
		selectedThread,
		selectedThreadId,
		threads,
	]);

	useEffect(() => {
		if (!hasWorkingThreads) {
			if (threads.length === 0) {
				selectedThreadRunStateRef.current = "idle";
			}
			return;
		}

		let cancelled = false;
		const poll = async () => {
			if (threadStatusPollInFlightRef.current) {
				return;
			}

			threadStatusPollInFlightRef.current = true;
			try {
				await refreshThreadStatuses();
			} catch (error) {
				if (!cancelled) {
					console.error("Failed to poll thread statuses", error);
				}
			} finally {
				threadStatusPollInFlightRef.current = false;
			}
		};

		void poll();
		const timer = window.setInterval(() => {
			void poll();
		}, THREAD_STATUS_POLL_INTERVAL_MS);

		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [hasWorkingThreads, refreshThreadStatuses, threads.length]);

	useEffect(() => {
		if (!homeDirectory) {
			return;
		}

		const prefetchQuery = supportsTildePath
			? "~/"
			: formatDirectoryPathForInput(
					homeDirectory,
					homeDirectory,
					supportsTildePath,
				);
		if (homeDirectoryPrefetchQueryRef.current === prefetchQuery) {
			return;
		}

		homeDirectoryPrefetchQueryRef.current = prefetchQuery;
		void prefetchDirectorySuggestions(prefetchQuery);
	}, [homeDirectory, prefetchDirectorySuggestions, supportsTildePath]);

	useEffect(() => {
		return () => {
			clearDirectorySuggestionPrefetchTimer();
		};
	}, [clearDirectorySuggestionPrefetchTimer]);

	useEffect(() => {
		return () => {
			abortProjectTasksRequest("Project task request was canceled.");
			abortGitHistoryRequests("Git history request was canceled.");
			abortDirectorySuggestionRequest(
				"Directory suggestion request was canceled.",
			);
		};
	}, [
		abortDirectorySuggestionRequest,
		abortGitHistoryRequests,
		abortProjectTasksRequest,
	]);

	useEffect(() => {
		if (!addProjectOpen) {
			directorySuggestionRequestIdRef.current += 1;
			abortDirectorySuggestionRequest(
				"Directory suggestion request was cleared.",
			);
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			setHoveredDirectorySuggestion(null);
			clearDirectorySuggestionPrefetchTimer();
			return;
		}

		const query = addProjectPath.trim();
		if (!query) {
			directorySuggestionRequestIdRef.current += 1;
			abortDirectorySuggestionRequest(
				"Directory suggestion request was cleared.",
			);
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			clearDirectorySuggestionPrefetchTimer();
			return;
		}

		const requestId = ++directorySuggestionRequestIdRef.current;
		abortDirectorySuggestionRequest(
			"Directory suggestion request was superseded.",
		);
		const controller = new AbortController();
		directorySuggestionAbortControllerRef.current = controller;
		const cached = readCachedDirectorySuggestions(query);
		if (cached) {
			setDirectorySuggestions(cached.directories);
			setDirectorySuggestionsLoading(cached.isStale);
		} else {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(true);
		}
		void (async () => {
			try {
				const directories = await fetchDirectorySuggestions(query, {
					...(cached ? { forceRefresh: cached.isStale } : {}),
					priority: "foreground",
					signal: controller.signal,
				});
				if (directorySuggestionRequestIdRef.current === requestId) {
					setDirectorySuggestions(directories);
				}
			} catch (error) {
				if (isAbortError(error)) {
					return;
				}
				if (directorySuggestionRequestIdRef.current === requestId) {
					setDirectorySuggestions([]);
				}
			} finally {
				if (directorySuggestionAbortControllerRef.current === controller) {
					directorySuggestionAbortControllerRef.current = null;
				}
				if (directorySuggestionRequestIdRef.current === requestId) {
					setDirectorySuggestionsLoading(false);
				}
			}
		})();

		return () => {
			directorySuggestionRequestIdRef.current += 1;
			if (directorySuggestionAbortControllerRef.current === controller) {
				directorySuggestionAbortControllerRef.current = null;
			}
			controller.abort(
				createAbortError(null, "Directory suggestion request was superseded."),
			);
		};
	}, [
		addProjectOpen,
		addProjectPath,
		abortDirectorySuggestionRequest,
		clearDirectorySuggestionPrefetchTimer,
		fetchDirectorySuggestions,
		readCachedDirectorySuggestions,
	]);

	const updateActiveCodexModel = useCallback(
		async (model: string) => {
			setModelControlError("");
			if (!model) {
				return;
			}

			if (!selectedThread) {
				setPendingThreadModel(model);
				return;
			}

			if (selectedThread.model === model || isUpdatingThreadModel) {
				return;
			}

			setIsUpdatingThreadModel(true);
			try {
				const updatedThread = await procedures.updateThreadModel({
					threadId: selectedThread.id,
					model,
				});
				setThreads((prev) => upsertThreadList(prev, updatedThread));
				setPendingThreadModel(updatedThread.model);
			} catch (error) {
				setModelControlError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsUpdatingThreadModel(false);
			}
		},
		[isUpdatingThreadModel, procedures, selectedThread],
	);

	const updateActiveReasoningEffort = useCallback(
		async (reasoningEffort: RpcCodexReasoningEffort) => {
			setReasoningEffortControlError("");
			if (!reasoningEffort) {
				return;
			}

			if (!selectedThread) {
				setPendingThreadReasoningEffort(reasoningEffort);
				return;
			}

			if (
				selectedThread.reasoningEffort === reasoningEffort ||
				isUpdatingThreadReasoningEffort
			) {
				return;
			}

			setIsUpdatingThreadReasoningEffort(true);
			try {
				const updatedThread = await procedures.updateThreadReasoningEffort({
					threadId: selectedThread.id,
					reasoningEffort,
				});
				setThreads((prev) => upsertThreadList(prev, updatedThread));
				setPendingThreadReasoningEffort(updatedThread.reasoningEffort);
			} catch (error) {
				setReasoningEffortControlError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsUpdatingThreadReasoningEffort(false);
			}
		},
		[isUpdatingThreadReasoningEffort, procedures, selectedThread],
	);

	const runSelectedTask = useCallback(
		async (task: RpcProjectTask) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				setTaskControlError("Select a project worktree before running a task.");
				return;
			}

			setIsRunningProjectTask(true);
			setTaskControlError("");
			setThreadsError("");
			setChatError("");
			setReasoningEffortControlError("");
			try {
				const detail = await procedures.runProjectTask({
					projectId: selectedProject.id,
					worktreePath: activeSelectedWorktreePath,
					task,
					threadId: selectedThread?.id ?? null,
					model: selectedThread
						? null
						: activeCodexModel || defaultCodexModel || null,
					reasoningEffort: selectedThread
						? null
						: activeReasoningEffort || defaultCodexReasoningEffort || null,
				});
				setThreads((prev) => upsertThreadList(prev, detail.thread));
				setSelectedThreadId(detail.thread.id);
				selectedThreadRunStateRef.current = detail.thread.runStatus.state;
				setThreadMessages(detail.messages);
				syncThreadContext(detail.thread);
				setMobileProjectListOpen(false);
				try {
					await loadProjectWorktrees(detail.thread.projectId);
				} catch {
					// Best effort; task execution should still succeed without a worktree refresh.
				}
			} catch (error) {
				setTaskControlError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setIsRunningProjectTask(false);
			}
		},
		[
			activeCodexModel,
			activeReasoningEffort,
			activeSelectedWorktreePath,
			defaultCodexModel,
			defaultCodexReasoningEffort,
			loadProjectWorktrees,
			procedures,
			selectedProject,
			selectedThread,
			syncThreadContext,
		],
	);

	const createThreadFromSelection = useCallback(async () => {
		if (isCreatingThread) {
			return;
		}
		if (!selectedProject || !activeSelectedWorktreePath) {
			setThreadsError("Select a project worktree before creating a thread.");
			return;
		}

		await createThreadForWorktree(
			selectedProject.id,
			activeSelectedWorktreePath,
		);
	}, [
		activeSelectedWorktreePath,
		createThreadForWorktree,
		isCreatingThread,
		selectedProject,
	]);

	const openProjectFromInput = useCallback(
		async (projectPathInput: string) => {
			if (isAddingProject) {
				return;
			}

			const projectPath = projectPathInput.trim();
			if (!projectPath) {
				setAddProjectError("Enter the project folder path.");
				return;
			}

			setIsAddingProject(true);
			setAddProjectError("");
			try {
				const result = await procedures.openProject({ projectPath });
				const existingState = getProjectState(result.project.id);
				setProjects((prev) => upsertProjectList(prev, result.project));
				hydrateProjectRows([result.project]);
				setProjectState(result.project.id, {
					loadingWorktrees: false,
					error: "",
					worktrees: result.worktrees,
					openWorktrees: existingState.openWorktrees,
				});
				setProjectTreeOpen(result.project.path, true);
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
			getProjectState,
			hydrateProjectRows,
			isAddingProject,
			procedures,
			resetAddProjectPath,
			selectProject,
			setProjectState,
			setProjectTreeOpen,
		],
	);

	const selectDirectorySuggestion = useCallback(
		(directory: string) => {
			const formattedDirectory = formatDirectoryPathForInput(
				directory,
				homeDirectory,
				supportsTildePath,
			);
			setAddProjectError("");
			setHoveredDirectorySuggestion(null);
			setAddProjectPath(formattedDirectory);
		},
		[homeDirectory, supportsTildePath],
	);

	const submitAddProject = useCallback(
		async (event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			await openProjectFromInput(addProjectPath);
		},
		[addProjectPath, openProjectFromInput],
	);

	const refreshProject = useCallback(
		async (project: RpcProject) => {
			const current = getProjectState(project.id);
			const expanded = !isProjectTreeOpen(project.path);
			const hasCachedWorktrees = current.worktrees.length > 0;
			setProjectTreeOpen(project.path, expanded);
			setProjectState(project.id, {
				loadingWorktrees: expanded && !hasCachedWorktrees,
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
					openWorktrees: new Set(),
					loadingWorktrees: false,
				});
				try {
					await procedures.closeProject({ projectId: project.id });
					setProjects((prev) =>
						upsertProjectList(prev, {
							...project,
							isOpen: 0,
						}),
					);
				} catch {
					// best effort
				}
				if (selectedProjectId === project.id) {
					selectedWorktreePathRef.current = project.path;
					setSelectedWorktreePath(project.path);
				}
				return;
			}

			if (hasCachedWorktrees) {
				if (!selectedProjectId) {
					selectProject(project);
				}
				void procedures
					.openProject({
						projectPath: project.path,
						name: project.name,
					})
					.then((result) => {
						setProjects((prev) => upsertProjectList(prev, result.project));
						setProjectState(project.id, {
							worktrees: result.worktrees,
							loadingWorktrees: false,
							error: "",
						});
					})
					.catch((error) => {
						setProjectState(project.id, {
							loadingWorktrees: false,
							error: error instanceof Error ? error.message : String(error),
						});
					});
				return;
			}

			try {
				const result = await procedures.openProject({
					projectPath: project.path,
					name: project.name,
				});
				setProjects((prev) => upsertProjectList(prev, result.project));
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
					loadingWorktrees: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		},
		[
			getProjectState,
			isProjectTreeOpen,
			setProjectState,
			setProjectTreeOpen,
			procedures,
			selectedProjectId,
			selectProject,
		],
	);

	const openOrCloseWorktree = useCallback(
		async (projectId: number, worktreePath: string) => {
			const target = getWorktreeState(projectId, worktreePath);
			if (target.loading) {
				return;
			}

			const { key, requestId } = beginWorktreeToggleRequest(
				projectId,
				worktreePath,
			);
			setWorktreeState(projectId, worktreePath, {
				loading: true,
				error: "",
			});

			if (target.opened) {
				try {
					await procedures.closeWorktree({ projectId, worktreePath });
					if (!isCurrentWorktreeToggleRequest(key, requestId)) {
						return;
					}
					setWorktreeState(projectId, worktreePath, {
						opened: false,
						snapshot: undefined,
						loading: false,
					});
					updateProjectState(projectId, (current) => ({
						...current,
						openWorktrees: new Set(
							[...current.openWorktrees].filter(
								(item) => item !== worktreePath,
							),
						),
					}));
					const fallbackWorktreePath =
						projects.find((project) => project.id === projectId)?.path ?? null;
					if (selectedWorktreePathRef.current === worktreePath) {
						selectedWorktreePathRef.current = fallbackWorktreePath;
					}
					setSelectedWorktreePath((current) => {
						if (current !== worktreePath) {
							return current;
						}
						return fallbackWorktreePath;
					});
				} catch (error) {
					if (!isCurrentWorktreeToggleRequest(key, requestId)) {
						return;
					}
					setWorktreeState(projectId, worktreePath, {
						loading: false,
						error:
							error instanceof Error
								? error.message
								: "Unable to stop worktree polling.",
					});
				} finally {
					finishWorktreeToggleRequest(key, requestId);
				}
				return;
			}

			try {
				const result = await procedures.openWorktree({
					projectId,
					worktreePath,
				});
				if (!isCurrentWorktreeToggleRequest(key, requestId)) {
					return;
				}
				cacheGitHistoryResult(result.history);
				setWorktreeState(projectId, worktreePath, {
					loading: false,
					opened: true,
					snapshot: result.worktree,
					error: "",
				});
				updateProjectState(projectId, (current) => ({
					...current,
					loadingWorktrees: false,
					openWorktrees: new Set([...current.openWorktrees, worktreePath]),
				}));
				const pinnedThread = pinnedThreadForWorktree(
					threads,
					projectId,
					worktreePath,
				);
				if (pinnedThread) {
					void openThread(pinnedThread.id);
					return;
				}
				await createThreadForWorktree(projectId, worktreePath, {
					requireNoSelectedThread: true,
				});
			} catch (error) {
				if (!isCurrentWorktreeToggleRequest(key, requestId)) {
					return;
				}
				setWorktreeState(projectId, worktreePath, {
					loading: false,
					error: error instanceof Error ? error.message : String(error),
				});
			} finally {
				finishWorktreeToggleRequest(key, requestId);
			}
		},
		[
			beginWorktreeToggleRequest,
			createThreadForWorktree,
			getWorktreeState,
			projects,
			cacheGitHistoryResult,
			finishWorktreeToggleRequest,
			isCurrentWorktreeToggleRequest,
			openThread,
			procedures,
			setWorktreeState,
			threads,
			updateProjectState,
		],
	);

	const postMessage = useCallback(() => {
		const text = chatInput.trim();
		if (!text || isSending || selectedThreadIsWorking) {
			return;
		}
		if (!selectedThreadId) {
			setChatError("Create or select a thread before sending a message.");
			return;
		}

		const pendingInput = text;
		setIsSending(true);
		setChatError("");
		setChatInput("");
		void (async () => {
			try {
				const detail = await procedures.sendThreadMessage({
					threadId: selectedThreadId,
					input: pendingInput,
				});
				setThreads((prev) => upsertThreadList(prev, detail.thread));
				selectedThreadRunStateRef.current = detail.thread.runStatus.state;
				setThreadMessages(detail.messages);
			} catch (error) {
				setChatError(error instanceof Error ? error.message : String(error));
				setChatInput((current) => current || pendingInput);
			} finally {
				setIsSending(false);
			}
		})();
	}, [
		chatInput,
		isSending,
		procedures,
		selectedThreadId,
		selectedThreadIsWorking,
	]);

	const stopSelectedThreadTurn = useCallback(() => {
		if (!selectedThreadId || !selectedThreadIsWorking || isStoppingThread) {
			return;
		}

		setIsStoppingThread(true);
		setChatError("");
		void (async () => {
			try {
				const detail = await procedures.stopThreadTurn({
					threadId: selectedThreadId,
				});
				setThreads((prev) => upsertThreadList(prev, detail.thread));
				if (selectedThreadIdRef.current === detail.thread.id) {
					selectedThreadRunStateRef.current = detail.thread.runStatus.state;
					setThreadMessages(detail.messages);
				}
			} catch (error) {
				setChatError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsStoppingThread(false);
			}
		})();
	}, [isStoppingThread, procedures, selectedThreadId, selectedThreadIsWorking]);

	const onSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			if (selectedThreadIsWorking) {
				stopSelectedThreadTurn();
				return;
			}
			postMessage();
		},
		[postMessage, selectedThreadIsWorking, stopSelectedThreadTurn],
	);

	const onChatInputChange = useCallback(
		(event: ChangeEvent<HTMLTextAreaElement>) => {
			setChatInput(event.currentTarget.value);
			resizeComposerTextarea(
				event.currentTarget,
				event.currentTarget === desktopComposerRef.current
					? DESKTOP_COMPOSER_MIN_HEIGHT_PX
					: MOBILE_COMPOSER_MIN_HEIGHT_PX,
			);
		},
		[],
	);

	const onEnter = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key !== "Enter" || event.nativeEvent.isComposing) {
				return;
			}
			if (event.metaKey || event.ctrlKey) {
				event.preventDefault();
				if (!event.shiftKey && !event.altKey) {
					postMessage();
				}
			}
		},
		[postMessage],
	);

	const visibleMessages = useMemo<VisibleMessage[]>(() => {
		let messages: VisibleMessage[];
		const hasInProgressAssistantChat = threadMessages.some(
			(message) =>
				message.kind === "chat" &&
				message.role === "assistant" &&
				message.state === "in_progress",
		);
		if (isThreadLoading) {
			messages = [
				{
					kind: "chat",
					speaker: "assistant",
					tone: "normal",
					text: "Loading thread history...",
				},
			];
		} else if (!selectedThread) {
			messages = [
				{
					kind: "chat",
					speaker: "assistant",
					tone: "normal",
					text: selectedProject
						? `Create a thread from the Threads section to start a ${APP_TITLE} conversation for the selected worktree.`
						: "Add a project, choose a worktree, and create a thread to begin.",
				},
			];
		} else if (threadMessages.length === 0) {
			messages = [
				{
					kind: "chat",
					speaker: "assistant",
					tone: "normal",
					text: `Thread ready in ${selectedProject?.name ?? "this project"} · ${activeSelectedWorktreeFolder}. Ask ${APP_TITLE} to inspect, refactor, or debug this worktree.`,
				},
			];
		} else {
			messages = threadMessages.map((message) => {
				if (message.kind === "reasoning") {
					return {
						kind: "reasoning",
						text: message.text,
						state: message.state,
					};
				}
				if (message.kind === "command") {
					return {
						kind: "command",
						command: message.command,
						output: message.output,
						state: message.state,
						exitCode: message.exitCode,
					};
				}
				if (message.kind === "file_change") {
					return {
						kind: "file_change",
						path: message.path,
						diffText: message.diffText,
						changeKind: message.changeKind,
						state: message.state,
					};
				}
				if (message.kind === "tool_call") {
					return {
						kind: "tool_call",
						server: message.server,
						tool: message.tool,
						argumentsText: message.argumentsText,
						output: message.output,
						state: message.state,
					};
				}
				return {
					kind: "chat",
					speaker: message.role,
					tone: "normal",
					text: message.text,
				};
			});
		}
		if (
			selectedThread?.runStatus.state === "working" &&
			!hasInProgressAssistantChat
		) {
			messages.push({
				kind: "chat",
				speaker: "assistant",
				tone: "working",
				text: "Processing",
			});
		}
		if (activeChatError) {
			messages.push({
				kind: "chat",
				speaker: "assistant",
				tone: "error",
				text: activeChatError,
			});
		}
		if (activeChatNotice) {
			messages.push({
				kind: "chat",
				speaker: "assistant",
				tone: "notice",
				text: activeChatNotice,
			});
		}
		return messages;
	}, [
		activeSelectedWorktreeFolder,
		activeChatError,
		activeChatNotice,
		isThreadLoading,
		selectedProject,
		selectedThread,
		threadMessages,
	]);

	const renderAssistantMessageContent = useCallback(
		(message: VisibleMessage): JSX.Element => {
			if (message.kind === "chat") {
				if (message.tone === "working") {
					return <ProcessingMessage />;
				}
				if (message.tone === "error") {
					return <ChatErrorMessage text={message.text} />;
				}
				if (message.tone === "notice") {
					return <ChatNoticeMessage text={message.text} />;
				}
				return <MarkdownMessage text={message.text} />;
			}
			if (message.kind === "reasoning") {
				return <ReasoningMessage state={message.state} text={message.text} />;
			}
			if (message.kind === "command") {
				return (
					<CommandExecutionMessage
						command={message.command}
						exitCode={message.exitCode}
						output={message.output}
						state={message.state}
					/>
				);
			}
			if (message.kind === "tool_call") {
				return (
					<ToolCallMessage
						argumentsText={message.argumentsText}
						output={message.output}
						server={message.server}
						state={message.state}
						tool={message.tool}
					/>
				);
			}
			return (
				<FileChangeMessage
					changeKind={message.changeKind}
					diffText={message.diffText}
					path={message.path}
					state={message.state}
					worktreePath={activeSelectedWorktreePath ?? undefined}
				/>
			);
		},
		[activeSelectedWorktreePath],
	);

	const groupedVisibleMessages = useMemo<MessageGroup[]>(() => {
		const groups: MessageGroup[] = [];
		visibleMessages.forEach((message, index) => {
			if (isAssistantVisibleMessage(message)) {
				const lastGroup = groups.at(-1);
				const nextMessage = { index, message };
				if (lastGroup?.kind === "assistant") {
					lastGroup.messages.push(nextMessage);
					return;
				}
				groups.push({
					kind: "assistant",
					key: `assistant-${index}`,
					messages: [nextMessage],
				});
				return;
			}

			groups.push({
				kind: "user",
				key: `user-${index}`,
				text: message.kind === "chat" ? message.text : "",
			});
		});
		return groups;
	}, [visibleMessages]);

	const handleDesktopChatScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			desktopChatPinnedToBottomRef.current = isScrolledToBottom(
				event.currentTarget,
			);
		},
		[],
	);

	const handleMobileChatScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			mobileChatPinnedToBottomRef.current = isScrolledToBottom(
				event.currentTarget,
			);
		},
		[],
	);

	const handleDesktopDiffContentScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			const container = event.currentTarget;
			if (
				container.scrollTop + container.clientHeight >=
				container.scrollHeight - WORKTREE_FILE_CONTENT_LOAD_THRESHOLD_PX
			) {
				void loadMoreDiffFileContent();
			}
		},
		[loadMoreDiffFileContent],
	);

	const handleMobileDiffContentScroll = useCallback(
		(event: UIEvent<HTMLDivElement>) => {
			const container = event.currentTarget;
			if (
				container.scrollTop + container.clientHeight >=
				container.scrollHeight - WORKTREE_FILE_CONTENT_LOAD_THRESHOLD_PX
			) {
				void loadMoreDiffFileContent();
			}
		},
		[loadMoreDiffFileContent],
	);

	const renderChangeStatusBadge = (
		label: string,
		status: RpcWorktreeChangeStatus | null,
	): JSX.Element | null => {
		if (!status) {
			return null;
		}

		return (
			<span
				className={`rounded-full border px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] ${worktreeChangeStatusClassName(
					status,
				)}`}
			>
				{label} {worktreeChangeStatusLabel(status)}
			</span>
		);
	};

	const renderDiffFileTreeNodes = (
		nodes: DiffFileTreeNode[],
		depth = 0,
	): JSX.Element[] =>
		nodes.map((node) => {
			if (node.path === null) {
				return (
					<div key={node.key}>
						<div
							className="flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[#6f7b83]"
							style={{
								paddingLeft: `${12 + depth * 14}px`,
							}}
						>
							{materialSymbol("folder", "text-sm")}
							<span>{node.label}</span>
						</div>
						<div>{renderDiffFileTreeNodes(node.children, depth + 1)}</div>
					</div>
				);
			}

			return (
				<button
					type="button"
					key={node.key}
					className={`flex w-full items-center justify-between gap-3 border-l px-3 py-2 text-left transition-colors ${
						selectedDiffFilePath === node.path
							? "border-[#7eadce] bg-[#182026]"
							: "border-transparent hover:bg-[#171d21]"
					}`}
					style={{
						paddingLeft: `${12 + depth * 14}px`,
					}}
					onClick={() => {
						setSelectedDiffFilePath(node.path);
					}}
				>
					<div className="min-w-0">
						<div className="truncate font-mono text-[13px] text-[#f2f0ef]">
							{node.label}
						</div>
						<div className="truncate text-[11px] text-[#8f9aa2]">
							{node.path}
						</div>
					</div>
					<div className="flex shrink-0 flex-col items-end gap-1">
						{renderChangeStatusBadge(
							"Index",
							node.change?.stagedStatus ?? null,
						)}
						{renderChangeStatusBadge(
							"Worktree",
							node.change?.unstagedStatus ?? null,
						)}
					</div>
				</button>
			);
		});

	useLayoutEffect(() => {
		void visibleMessages;
		const threadChanged = chatScrollThreadIdRef.current !== selectedThreadId;
		if (threadChanged) {
			desktopChatPinnedToBottomRef.current = true;
			mobileChatPinnedToBottomRef.current = true;
		}
		if (desktopChatPinnedToBottomRef.current) {
			scrollContainerToBottom(desktopChatScrollRef.current);
		}
		if (mobileChatPinnedToBottomRef.current) {
			scrollContainerToBottom(mobileChatScrollRef.current);
		}
		chatScrollThreadIdRef.current = selectedThreadId;
	}, [selectedThreadId, visibleMessages]);

	const renderDesktopMessages = groupedVisibleMessages.map((group) => {
		if (group.kind === "assistant") {
			return (
				<div
					className="group flex w-full min-w-0 items-start gap-6"
					key={group.key}
				>
					<div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-[#adcbe0]">
						{brandBoltIcon("text-sm text-[#224259]")}
					</div>
					<div className="min-w-0 flex-1 space-y-4">
						<div className="font-label text-[10px] font-bold uppercase tracking-widest text-[#bdd5e6]">
							{APP_TITLE}
						</div>
						<div className="space-y-3">
							{group.messages.map(({ message, index }) => (
								<div
									className={`min-w-0 ${
										isPlainAssistantTextMessage(message) ? "py-3" : ""
									}`}
									key={`${message.kind}-${index}`}
								>
									<div className="min-w-0 max-w-full text-sm leading-relaxed text-[#ffffff]">
										{renderAssistantMessageContent(message)}
									</div>
								</div>
							))}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div className="flex w-full min-w-0 justify-end gap-6" key={group.key}>
				<div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
					<div className="font-body text-[13px] font-semibold tracking-[0.01em] text-[#b7b3b1]">
						{localUserLabel}
					</div>
					<div className="ml-auto max-w-full overflow-hidden rounded-sm bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
						<MarkdownMessage text={group.text} />
					</div>
				</div>
				<div className="w-8 h-8 rounded-sm bg-[#262626] flex items-center justify-center shrink-0">
					{materialSymbol("person")}
				</div>
			</div>
		);
	});

	const renderMobileMessages = groupedVisibleMessages.map((group) => {
		if (group.kind === "assistant") {
			return (
				<div
					className="flex flex-col items-start gap-3 max-w-full"
					key={group.key}
				>
					<div className="flex items-center gap-2 text-[#bdd5e6] px-1">
						{brandBoltIcon("text-sm")}
						<span className="text-[10px] font-label font-bold uppercase tracking-wider">
							{APP_TITLE}
						</span>
					</div>
					<div className="flex w-full flex-col gap-3">
						{group.messages.map(({ message, index }) => (
							<div
								className={`w-full ${
									isPlainAssistantTextMessage(message) ? "py-3" : ""
								}`}
								key={`${message.kind}-${index}`}
							>
								<div className="glass-panel flex w-full flex-col gap-4 rounded-lg border border-[#bdd5e6]/10 p-5">
									<div className="text-sm leading-relaxed text-[#ffffff]">
										{renderAssistantMessageContent(message)}
									</div>
								</div>
							</div>
						))}
					</div>
				</div>
			);
		}

		return (
			<div
				className="flex flex-col items-end gap-2 max-w-[90%] self-end"
				key={group.key}
			>
				<div className="flex items-center gap-2 px-1 text-[#b7b3b1]">
					<span className="font-body text-[13px] font-semibold tracking-[0.01em]">
						{localUserLabel}
					</span>
					{materialSymbol("account_circle", "text-sm text-[#9f9b99]")}
				</div>
				<div className="bg-[#1f2020] p-4 rounded-lg rounded-tr-none text-sm leading-relaxed text-[#ffffff] shadow-sm">
					<MarkdownMessage text={group.text} />
				</div>
			</div>
		);
	});

	const renderDiffWorkspace = (options: { mobile: boolean }): JSX.Element => {
		const selectorContent =
			!selectedProject || !activeSelectedWorktreePath ? (
				<div className="rounded-sm border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
					Select a project worktree first.
				</div>
			) : !activeSelectedWorktreeOpened ? (
				<div className="rounded-sm border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
					Open this worktree from the Projects panel to inspect its live diff.
				</div>
			) : isRefreshingWorktreeSnapshot && !activeWorktreeSnapshot ? (
				<div className="rounded-sm border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
					Loading worktree diff...
				</div>
			) : worktreeDiffError && !activeWorktreeSnapshot ? (
				<div className="rounded-sm border border-[#5c2030] bg-[#2c1117] px-4 py-4 text-sm text-[#ff9db0]">
					{worktreeDiffError}
				</div>
			) : activeWorktreeChanges.length === 0 ? (
				<div className="rounded-sm border border-[#244833] bg-[#12251a] px-4 py-4 text-sm text-[#9fe2b1]">
					Worktree clean. No staged or unstaged changes.
				</div>
			) : (
				<div
					className={`overflow-hidden rounded-sm border border-[#252f36] bg-[#0f1417] ${
						options.mobile ? "" : "h-full"
					}`}
				>
					<div
						className={`overflow-y-auto py-2 hide-scrollbar ${
							options.mobile ? "max-h-[22rem]" : "h-full"
						}`}
					>
						{renderDiffFileTreeNodes(diffFileTree)}
					</div>
				</div>
			);

		const contentBody = !selectedDiffFileChange ? (
			<div className="rounded-sm border border-[#252f36] bg-[#12181c] px-4 py-4 text-sm text-[#8f9aa2]">
				Select a changed file to inspect its current contents.
			</div>
		) : diffFileContentState.error ? (
			<div className="rounded-sm border border-[#5c2030] bg-[#2c1117] px-4 py-4 text-sm text-[#ff9db0]">
				{diffFileContentState.error}
			</div>
		) : diffFileContentState.isLoadingInitial ? (
			<div className="rounded-sm border border-[#283239] bg-[#151b20] px-4 py-4 text-sm text-[#d4e4ef]">
				Streaming file contents...
			</div>
		) : diffFileContentState.isMissing ? (
			<div className="rounded-sm border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
				This file no longer exists in the working tree. The diff entry is still
				listed because the change is active.
			</div>
		) : diffFileContentState.isBinary ? (
			<div className="rounded-sm border border-[#31404a] bg-[#12181c] px-4 py-4 text-sm text-[#cfe0eb]">
				Binary file preview unavailable.
			</div>
		) : (
			<div
				className={`overflow-hidden rounded-sm border border-[#252f36] bg-[#0c1114] ${
					options.mobile ? "" : "h-full"
				}`}
			>
				<div
					ref={
						options.mobile
							? mobileDiffContentScrollRef
							: desktopDiffContentScrollRef
					}
					className={`app-scrollbar overflow-auto ${
						options.mobile ? "max-h-[48vh]" : "h-full"
					}`}
					onScroll={
						options.mobile
							? handleMobileDiffContentScroll
							: handleDesktopDiffContentScroll
					}
				>
					{diffFileContentState.chunks.length > 0 ? (
						<pre className="min-w-full px-4 py-4 font-mono text-[12px] leading-6 text-[#d4dde4] whitespace-pre-wrap break-words">
							{diffFileContentState.chunks.map((chunk, index) => (
								<span className="contents" key={`${index}-${chunk.length}`}>
									{chunk}
								</span>
							))}
						</pre>
					) : (
						<div className="px-4 py-4 text-sm text-[#8f9aa2]">Empty file.</div>
					)}
					{diffFileContentState.isLoadingMore ? (
						<div className="border-t border-[#252f36] px-4 py-3 text-xs text-[#8f9aa2]">
							Loading more...
						</div>
					) : diffFileContentState.nextCursor !== null ? (
						<div className="border-t border-[#252f36] px-4 py-3 text-xs text-[#6f7b83]">
							Scroll to load more
						</div>
					) : null}
				</div>
			</div>
		);

		return (
			<div
				className={
					options.mobile
						? "flex min-h-0 flex-1 flex-col gap-4"
						: "flex min-h-0 flex-1 overflow-hidden"
				}
			>
				<div
					className={
						options.mobile
							? "shrink-0"
							: "flex h-full w-[21rem] shrink-0 flex-col border-r border-[#262626] bg-[#121518]"
					}
				>
					<div
						className={
							options.mobile ? "" : "border-b border-[#262626] px-4 py-4"
						}
					>
						<div className="flex items-start justify-between gap-3">
							<div>
								<div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
									Worktree Diff
								</div>
								<div className="mt-2 text-sm font-semibold text-[#f2f0ef]">
									{activeSelectedWorktreeFolder}
								</div>
								<div className="mt-1 text-xs text-[#8f9aa2]">
									{selectedProject
										? formatPathForDisplay(
												activeSelectedWorktreePath ?? "",
												homeDirectory,
												supportsTildePath,
											)
										: "No worktree selected"}
								</div>
							</div>
							<button
								type="button"
								className="rounded-sm border border-[#31404a] bg-[#182025] px-3 py-2 text-[11px] uppercase tracking-[0.16em] text-[#cfe0eb] transition-colors hover:bg-[#1e2a31] disabled:cursor-not-allowed disabled:opacity-60"
								onClick={() => {
									void refreshActiveWorktreeSnapshot();
									void loadSelectedDiffFileContent();
								}}
								disabled={
									!selectedProject ||
									!activeSelectedWorktreePath ||
									!activeSelectedWorktreeOpened ||
									isRefreshingWorktreeSnapshot
								}
							>
								{isRefreshingWorktreeSnapshot ? "Syncing" : "Refresh"}
							</button>
						</div>
						{worktreeDiffError && activeWorktreeSnapshot ? (
							<div className="mt-3 rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-2 text-xs text-[#ff9db0]">
								{worktreeDiffError}
							</div>
						) : null}
					</div>
					<div
						className={
							options.mobile ? "" : "min-h-0 flex-1 overflow-hidden px-3 py-3"
						}
					>
						{selectorContent}
					</div>
				</div>
				<div
					className={
						options.mobile
							? "flex min-h-0 flex-1 flex-col gap-4"
							: "flex min-w-0 flex-1 flex-col overflow-hidden"
					}
				>
					<div
						className={
							options.mobile
								? "rounded-sm border border-[#252f36] bg-[#12181c] px-4 py-4"
								: "border-b border-[#262626] bg-[#101417] px-6 py-5"
						}
					>
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<div className="font-label text-[10px] uppercase tracking-[0.18em] text-[#8fb5cd]">
									Selected File
								</div>
								<div className="mt-2 truncate font-mono text-sm text-[#f2f0ef]">
									{selectedDiffFileChange?.path ?? "No file selected"}
								</div>
								{selectedDiffFileChange?.previousPath ? (
									<div className="mt-1 truncate text-xs text-[#8f9aa2]">
										Previously {selectedDiffFileChange.previousPath}
									</div>
								) : null}
							</div>
							<div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
								{renderChangeStatusBadge(
									"Index",
									selectedDiffFileChange?.stagedStatus ?? null,
								)}
								{renderChangeStatusBadge(
									"Worktree",
									selectedDiffFileChange?.unstagedStatus ?? null,
								)}
								{selectedDiffFileChange ? (
									<span className="rounded-full border border-[#31404a] bg-[#182025] px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-[#8f9aa2]">
										{formatFileSize(diffFileContentState.totalBytes)}
									</span>
								) : null}
							</div>
						</div>
						{selectedDiffFileChange &&
						!diffFileContentState.isBinary &&
						!diffFileContentState.isMissing ? (
							<div className="mt-3 text-xs text-[#6f7b83]">
								Loaded {formatFileSize(diffFileContentState.loadedBytes)} of{" "}
								{formatFileSize(diffFileContentState.totalBytes)}
							</div>
						) : null}
					</div>
					<div
						className={options.mobile ? "min-h-0" : "min-h-0 flex-1 px-6 py-6"}
					>
						{contentBody}
					</div>
				</div>
			</div>
		);
	};

	const hoveredDirectorySuggestionPath = hoveredDirectorySuggestion
		? formatDirectoryPathForInput(
				hoveredDirectorySuggestion,
				homeDirectory,
				supportsTildePath,
			)
		: "";
	const displayedAddProjectPath =
		hoveredDirectorySuggestionPath || addProjectPath;
	const addProjectInputIsPreviewing = hoveredDirectorySuggestionPath.length > 0;

	const addProjectForm = (
		<form
			className="space-y-2 border-b border-[#262626] bg-[#151515] px-3 py-3"
			onSubmit={submitAddProject}
		>
			<label className="block text-[10px] font-label uppercase tracking-widest text-[#bdd5e6]">
				Project Folder
				<div className="relative mt-2 space-y-2">
					<div className="flex items-start gap-2">
						<input
							className={`min-w-0 flex-1 rounded-sm border px-3 py-2 text-sm outline-none transition-all placeholder:text-[#6f6f6f] focus:border-[#99bed9] ${
								addProjectInputIsPreviewing
									? "border-[#9fc1da] bg-[#1a2025] text-[#ffffff] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
									: "border-[#3b3b3b] bg-[#101010] text-[#f2f0ef]"
							}`}
							placeholder={supportsTildePath ? "~/project" : "/path/to/project"}
							value={displayedAddProjectPath}
							onChange={(event) => {
								setAddProjectError("");
								setHoveredDirectorySuggestion(null);
								setAddProjectPath(event.currentTarget.value);
							}}
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
						<button
							type="submit"
							className="rounded-sm bg-[#bdd5e6] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#2e526b] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={isAddingProject}
						>
							{isAddingProject ? "Adding" : "Add"}
						</button>
					</div>
					{addProjectPath.trim() ? (
						<div className="overflow-hidden rounded-sm border border-[#2f3f4b] bg-[#101315]/95 shadow-[0_14px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl">
							<div className="flex items-center justify-between border-b border-[#283036] px-3 py-2">
								<span className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
									Folders
								</span>
								{directorySuggestionsLoading ? (
									<span className="text-[10px] uppercase tracking-widest text-[#727e86]">
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
							{directorySuggestions.length > 0 ? (
								<div className="app-scrollbar max-h-[30rem] overflow-y-auto overscroll-contain">
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
												className={`flex w-full items-center gap-3 border-t border-[#1e2327] px-3 py-2 text-left transition-colors ${
													hoveredDirectorySuggestion === directory
														? "bg-[#1f282f]"
														: "hover:bg-[#1c2226]"
												}`}
												disabled={isAddingProject}
												onMouseDown={(event) => event.preventDefault()}
												onMouseEnter={() => {
													setHoveredDirectorySuggestion(directory);
													scheduleDirectorySuggestionPrefetch(directory);
												}}
												onMouseLeave={() => {
													setHoveredDirectorySuggestion((current) =>
														current === directory ? null : current,
													);
													clearDirectorySuggestionPrefetchTimer();
												}}
												onFocus={() => {
													setHoveredDirectorySuggestion(directory);
													scheduleDirectorySuggestionPrefetch(directory);
												}}
												onBlur={() => {
													setHoveredDirectorySuggestion((current) =>
														current === directory ? null : current,
													);
													clearDirectorySuggestionPrefetchTimer();
												}}
												onClick={() => selectDirectorySuggestion(directory)}
											>
												<div
													className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-[#bdd5e6] ${
														hoveredDirectorySuggestion === directory
															? "bg-[#26353f]"
															: "bg-[#1b252c]"
													}`}
												>
													{materialSymbol("folder", "text-[18px]")}
												</div>
												<div className="min-w-0 flex-1">
													<div className="truncate text-sm font-medium normal-case text-[#f2f0ef]">
														{shortName(directory)}
													</div>
													<div className="truncate text-[11px] normal-case text-[#8f9aa2]">
														{formattedDirectory}
													</div>
												</div>
											</button>
										);
									})}
								</div>
							) : null}
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
				className="fixed z-[90] w-80 overflow-hidden rounded-lg border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
				ref={projectActionMenuRef}
				style={{
					left: projectActionMenu.x,
					top: projectActionMenu.y,
				}}
			>
				<div className="border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
								Project Actions
							</div>
							<div className="truncate text-sm font-semibold text-[#f2f0ef]">
								{projectActionMenuProject.name}
							</div>
							<div className="truncate text-[11px] text-[#8f9aa2]">
								{formatPathForDisplay(
									projectActionMenuProject.path,
									homeDirectory,
									supportsTildePath,
								)}
							</div>
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#5c2030] bg-[#2c1117] text-[#ff8ca0] transition-colors hover:bg-[#39161f] hover:text-[#ffd1d8]"
								onClick={() =>
									void deleteTrackedProject(projectActionMenuProject.id)
								}
								aria-label={`Remove ${projectActionMenuProject.name}`}
								title="Remove Project"
							>
								{materialSymbol("delete", "text-[18px]")}
							</button>
							<button
								type="button"
								className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
								onClick={closeProjectActionMenu}
								aria-label="Close project actions"
							>
								×
							</button>
						</div>
					</div>
				</div>
				{projectActionMenuError ? (
					<div className="border-b border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff7e93]">
						{projectActionMenuError}
					</div>
				) : null}
				<div className="space-y-2 px-3 py-3">
					<div className="flex items-center justify-between">
						<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
							Active Worktrees
						</div>
						{projectActionMenuLoading ? (
							<div className="text-[10px] uppercase tracking-widest text-[#727e86]">
								Loading
							</div>
						) : null}
					</div>
					<div className="max-h-56 space-y-1 overflow-y-auto">
						{!projectActionMenuLoading &&
						projectActionMenuWorktrees.length === 0 ? (
							<div className="rounded-sm border border-[#252f36] bg-[#161c21] px-3 py-3 text-xs text-[#8f989f]">
								No worktrees found.
							</div>
						) : null}
						{projectActionMenuWorktrees.map((worktree) => {
							const worktreeErrorLevel = worktreeThreadErrorLevel(
								projectActionMenuProject.id,
								worktree.path,
							);
							return (
								<div
									className="rounded-sm border border-[#252f36] bg-[#161c21] px-3 py-2"
									key={worktree.path}
								>
									<div
										className="grid min-w-0 items-center gap-x-2 gap-y-0.5"
										style={{
											gridTemplateColumns:
												"minmax(0, 8.75rem) minmax(0, 1.35fr) auto",
										}}
									>
										<span
											className="min-w-0 truncate font-mono text-[11px] leading-5 text-[#a1c3db]"
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
												worktreeErrorLevel === "unread"
													? "bg-[#ff304f]"
													: worktreeErrorLevel === "failed"
														? "bg-[#8f4956]"
														: worktreeErrorLevel === "stopped"
															? "bg-[#b98a3a]"
															: "bg-transparent"
											}`}
										/>
										<div
											className="col-span-2 min-w-0 truncate text-[11px] leading-4 text-[#8f9aa2]"
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
					className="border-t border-[#2b343b] bg-[#171d21] px-3 py-3"
					onSubmit={submitNewWorktree}
				>
					<label
						className="block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
						htmlFor="new-worktree-name"
					>
						New Worktree
					</label>
					<div className="mt-2 flex items-center gap-2">
						<input
							id="new-worktree-name"
							className="min-w-0 flex-1 rounded-sm border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
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
							disabled={isCreatingWorktree || worktreePinBusyPath !== null}
							type="submit"
						>
							{isCreatingWorktree ? "Creating" : "Create"}
						</button>
					</div>
					<div className="mt-2 text-xs text-[#828d94]">
						Creates a new branch and sibling worktree folder.
					</div>
				</form>
			</div>
		) : null;

	const threadActionMenuPanel =
		threadActionMenu && threadActionMenuThread ? (
			<div
				className="fixed z-[95] w-80 overflow-hidden rounded-lg border border-[#35414a] bg-[#13181b]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
				ref={threadActionMenuRef}
				style={{
					left: threadActionMenu.x,
					top: threadActionMenu.y,
				}}
			>
				<div className="border-b border-[#2b343b] bg-[#181f24] px-3 py-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="font-label text-[10px] uppercase tracking-widest text-[#98b9d0]">
								Thread Actions
							</div>
							<div className="truncate text-sm font-semibold text-[#f2f0ef]">
								{threadActionMenuThread.title}
							</div>
							<div className="truncate text-[11px] text-[#8f9aa2]">
								{formatPathForDisplay(
									threadActionMenuThread.worktreePath,
									homeDirectory,
									supportsTildePath,
								)}
							</div>
						</div>
						<button
							type="button"
							className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#303940] bg-[#1a2025] text-[#acb8c1] transition-colors hover:bg-[#242d33] hover:text-[#f2f0ef]"
							onClick={closeThreadActionMenu}
						>
							×
						</button>
					</div>
				</div>
				{threadActionMenuError ? (
					<div className="border-b border-[#3a2230] bg-[#27151d] px-3 py-2 text-xs text-[#ff7e93]">
						{threadActionMenuError}
					</div>
				) : null}
				<form
					className="border-b border-[#2b343b] bg-[#171d21] px-3 py-3"
					onSubmit={submitThreadRename}
				>
					<label
						className="block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
						htmlFor="thread-rename-title"
					>
						Rename Thread
					</label>
					<div className="mt-2 flex items-center gap-2">
						<input
							id="thread-rename-title"
							className="min-w-0 flex-1 rounded-sm border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
							value={threadRenameTitle}
							onChange={(event) => {
								setThreadActionMenuError("");
								setThreadRenameTitle(event.currentTarget.value);
							}}
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
						/>
					</div>
					<label
						className="mt-3 block text-[10px] font-label uppercase tracking-widest text-[#98b9d0]"
						htmlFor="thread-rename-summary"
					>
						Thread Summary
					</label>
					<textarea
						id="thread-rename-summary"
						className="mt-2 min-h-[5.5rem] w-full rounded-sm border border-[#3b474f] bg-[#12171b] px-3 py-2 text-sm leading-6 text-[#f2f0ef] outline-none transition-colors placeholder:text-[#727e86] focus:border-[#99bed9]"
						placeholder="Optional desktop hover summary."
						value={threadRenameSummary}
						onChange={(event) => {
							setThreadActionMenuError("");
							setThreadRenameSummary(event.currentTarget.value);
						}}
						autoCapitalize="sentences"
						autoCorrect="on"
						spellCheck={true}
					/>
					<div className="mt-2 flex items-center justify-between gap-3">
						<div className="text-[11px] text-[#828d94]">
							Shown as a desktop hover popover. Leave blank to clear it.
						</div>
						<button
							type="submit"
							className="rounded-sm bg-[#f2f0ef] px-3 py-2 font-label text-[10px] font-bold uppercase tracking-wider text-[#181818] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
							disabled={threadActionBusy !== null}
						>
							{threadActionBusy === "rename" ? "Saving" : "Save"}
						</button>
					</div>
				</form>
				<div className="flex justify-end gap-2 border-t border-[#2b343b] px-3 py-3">
					<button
						type="button"
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#31404a] bg-[#182025] text-[#dfebf3] transition-colors hover:bg-[#1f282f] disabled:cursor-not-allowed disabled:opacity-60"
						onClick={() => {
							void toggleThreadPinned();
						}}
						disabled={threadActionBusy !== null}
						aria-label={
							threadActionMenuThread.pinnedAt ? "Unpin thread" : "Pin thread"
						}
						title={
							threadActionMenuThread.pinnedAt ? "Unpin thread" : "Pin thread"
						}
					>
						{materialSymbol("push_pin", "text-[18px]", {
							filled: Boolean(threadActionMenuThread.pinnedAt),
						})}
					</button>
					<button
						type="button"
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#5c2030] bg-[#2c1117] text-[#ff9db0] transition-colors hover:bg-[#39161f] disabled:cursor-not-allowed disabled:opacity-60"
						onClick={() => {
							void deleteSelectedThread();
						}}
						disabled={threadActionBusy !== null}
						aria-label="Delete thread"
						title="Delete thread"
					>
						{materialSymbol("delete", "text-[18px]")}
					</button>
				</div>
			</div>
		) : null;

	const sidebarSearch = (
		<SidebarSearchControl
			value={sidebarSearchQuery}
			onChange={(event) => {
				setSidebarSearchQuery(event.currentTarget.value);
			}}
			onClear={() => setSidebarSearchQuery("")}
		/>
	);

	const projectTree = (
		<div className="space-y-2">
			{filteredProjects.length === 0 ? (
				<div className="px-3 text-sm text-[#a7a7a7]">
					{normalizedSidebarSearchQuery
						? "No matching projects."
						: "No projects in database. Use + to add a project folder."}
				</div>
			) : (
				filteredProjects.map((project) => {
					const state = getProjectState(project.id);
					const projectTreeOpen = isProjectTreeOpen(project.path);
					const isActive = selectedProjectId === project.id;
					const projectErrorLevel = projectThreadErrorLevel(project.id);
					const visibleWorktrees = orderProjectWorktrees(
						project,
						state.worktrees,
					).filter((worktree) =>
						matchesSearchQuery(
							normalizedSidebarSearchQuery,
							project.name,
							worktree.branch,
							worktree.path,
							shortName(worktree.path),
							formatPathForDisplay(
								worktree.path,
								homeDirectory,
								supportsTildePath,
							),
						),
					);
					const showWorktrees =
						projectTreeOpen || Boolean(normalizedSidebarSearchQuery);
					const projectIndicatorClass = isActive
						? "bg-[#4fefb2]"
						: projectErrorLevel === "unread"
							? "bg-[#ff304f]"
							: projectErrorLevel === "failed"
								? "bg-[#8f4956]"
								: projectErrorLevel === "stopped"
									? "bg-[#b98a3a]"
									: "bg-[#5f5f5f]";
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
							<div
								className={`group/project flex w-full items-center gap-1 rounded-sm transition-colors ${
									isActive ? "bg-[#262626]" : "hover:bg-[#1f2020]"
								}`}
							>
								<button
									type="button"
									className={`min-w-0 flex-1 px-3 py-2 text-left ${isActive ? "text-[#bdd5e6]" : "text-[#d7d7d7]"}`}
									onClick={() => {
										hideErrorPreview();
										void refreshProject(project);
									}}
								>
									<div className="flex items-center gap-2">
										<span className="text-sm">
											{projectTreeOpen ? "▾" : "▸"}
										</span>
										<span
											className={`w-2 h-2 rounded-full ${projectIndicatorClass}`}
										/>
										<div className="font-medium text-sm truncate">
											{project.name}
										</div>
									</div>
								</button>
								<button
									type="button"
									className={`mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#303940] bg-[#1a2025] px-1 text-[9px] font-semibold leading-none tracking-[-0.18em] text-[#acb8c1] transition-all hover:bg-[#242d33] hover:text-[#f2f0ef] ${
										isActive
											? "opacity-100"
											: "pointer-events-none opacity-0 group-hover/project:pointer-events-auto group-hover/project:opacity-100 group-focus-within/project:pointer-events-auto group-focus-within/project:opacity-100"
									}`}
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
							</div>

							{showWorktrees ? (
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
									{visibleWorktrees.length === 0 ? (
										<div className="text-xs text-[#8f8d8b] px-2 py-1">
											{normalizedSidebarSearchQuery
												? "No matching worktrees."
												: "No worktrees found."}
										</div>
									) : null}
									{visibleWorktrees.length > 0 ? (
										<div className="app-scrollbar max-h-[18.75rem] overflow-y-auto overscroll-contain pr-1">
											<div className="space-y-1">
												{visibleWorktrees.map((worktree) => {
													const wState = getWorktreeState(
														project.id,
														worktree.path,
													);
													const worktreePinned = Boolean(worktree.pinnedAt);
													const togglingPin =
														worktreePinBusyPath === worktree.path;
													const activeWorktree = isActiveWorktree(
														project.id,
														worktree.path,
													);
													const worktreeErrorLevel = worktreeThreadErrorLevel(
														project.id,
														worktree.path,
													);
													return (
														<div className="relative" key={worktree.path}>
															<button
																type="button"
																className={`w-full min-w-0 text-left px-3 py-2 pr-12 flex flex-col gap-0.5 transition-colors ${
																	activeWorktree
																		? "bg-[#273036] text-[#f2f0ef]"
																		: wState.opened
																			? "bg-[#1f2020] text-[#f2f0ef]"
																			: "text-[#cfd1d4] hover:bg-[#202020]"
																}`}
																onClick={() => {
																	hideErrorPreview();
																	clearThreadSelection();
																	setThreadsError("");
																	selectProject(project, worktree.path);
																	void openOrCloseWorktree(
																		project.id,
																		worktree.path,
																	);
																}}
															>
																<div
																	className="grid min-w-0 items-center gap-x-2 gap-y-0.5"
																	style={{
																		gridTemplateColumns:
																			"minmax(0, 8.75rem) minmax(0, 1.35fr) auto",
																	}}
																>
																	<span
																		className="min-w-0 truncate font-mono text-xs leading-5 text-[#a1c3db]"
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
																			worktreeErrorLevel === "unread"
																				? "bg-[#ff304f]"
																				: worktreeErrorLevel === "failed"
																					? "bg-[#8f4956]"
																					: worktreeErrorLevel === "stopped"
																						? "bg-[#b98a3a]"
																						: "bg-transparent"
																		}`}
																	/>
																	<div
																		className="col-span-2 min-w-0 truncate text-[11px] leading-4 text-[#8f9aa2]"
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
															<button
																type="button"
																className={`absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
																	activeWorktree || wState.opened
																		? "border-[#35414a] bg-[#1f282f] text-[#dfebf3]"
																		: "border-[#303940] bg-[#1a2025] text-[#acb8c1] hover:bg-[#242d33] hover:text-[#f2f0ef]"
																}`}
																onClick={() => {
																	void toggleWorktreePinned(
																		project.id,
																		worktree.path,
																		worktreePinned,
																	);
																}}
																disabled={
																	togglingPin || worktreePinBusyPath !== null
																}
																aria-label={
																	worktreePinned
																		? "Unpin worktree"
																		: "Pin worktree"
																}
																title={
																	worktreePinned
																		? "Unpin worktree"
																		: "Pin worktree"
																}
															>
																{materialSymbol("push_pin", "text-[16px]", {
																	filled: worktreePinned,
																})}
															</button>
														</div>
													);
												})}
											</div>
										</div>
									) : null}
								</div>
							) : null}
						</div>
					);
				})
			)}
		</div>
	);

	const projectSection = (
		<div className="px-3 py-3">
			<SidebarSectionHeader
				title="Projects"
				open={projectsSectionOpen}
				onToggle={() => {
					setProjectsSectionOpen((current) => !current);
				}}
				action={
					<button
						type="button"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#99bed9]/30 bg-[#21282e] text-sm font-semibold leading-none text-[#bdd5e6] transition-colors hover:border-[#bdd5e6]/60 hover:bg-[#2c373e] hover:text-[#dfebf3]"
						onClick={toggleAddProjectForm}
						aria-label={addProjectOpen ? "Close add project" : "Add project"}
					>
						+
					</button>
				}
			/>
			{projectsSectionOpen ? (
				<div className="mt-2 space-y-3">
					{addProjectOpen ? addProjectForm : null}
					{projectTree}
				</div>
			) : null}
		</div>
	);

	const threadSection = (
		<div className="border-t border-[#262626] px-3 py-3">
			<SidebarSectionHeader
				title={
					<>
						<span>Threads</span>
						<span className="font-medium normal-case text-[#879198]">
							{" - "}
							{selectedProject ? shortName(selectedProject.path) : "No Project"}
						</span>
					</>
				}
				open={threadsSectionOpen}
				onToggle={() => {
					setThreadsSectionOpen((current) => !current);
				}}
				action={
					<button
						type="button"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#99bed9]/30 bg-[#21282e] text-sm font-semibold leading-none text-[#bdd5e6] transition-colors hover:border-[#bdd5e6]/60 hover:bg-[#2c373e] hover:text-[#dfebf3] disabled:cursor-not-allowed disabled:opacity-50"
						onClick={() => {
							void createThreadFromSelection();
						}}
						aria-label="Create thread"
						disabled={
							isCreatingThread ||
							!selectedProject ||
							!activeSelectedWorktreePath
						}
						title={
							selectedProject && activeSelectedWorktreePath
								? `Start a new ${APP_TITLE} thread for the selected worktree`
								: "Select a project worktree first"
						}
					>
						+
					</button>
				}
			/>
			{threadsSectionOpen ? (
				<div className="mt-3 space-y-2">
					{!selectedProject || !activeSelectedWorktreePath ? (
						<div className="rounded-sm border border-[#212121] bg-[#151515] px-3 py-3 text-xs text-[#8f8d8b]">
							Select a project worktree first.
						</div>
					) : filteredVisibleThreads.length === 0 ? (
						<div className="rounded-sm border border-[#212121] bg-[#151515] px-3 py-3 text-xs text-[#8f8d8b]">
							{normalizedSidebarSearchQuery
								? "No matching threads in this worktree."
								: `No threads in this worktree yet. Use + to start a ${APP_TITLE} thread for the selected worktree.`}
						</div>
					) : (
						filteredVisibleThreads.map((thread) => {
							const threadProject =
								projects.find((project) => project.id === thread.projectId) ??
								null;
							const threadWorktree = threadProject
								? (getProjectState(thread.projectId).worktrees.find(
										(worktree) => worktree.path === thread.worktreePath,
									) ?? null)
								: null;
							const threadBranchName =
								threadWorktree?.branch?.trim() ||
								(threadProject && thread.worktreePath === threadProject.path
									? "Primary"
									: "detached");
							const threadFolderName = shortName(thread.worktreePath);
							const threadWorktreeDisplayPath = formatPathForDisplay(
								thread.worktreePath,
								homeDirectory,
								supportsTildePath,
							);
							const threadPopoverAnchorId = `thread-sidebar-row-${thread.id}`;
							const threadPinned = Boolean(thread.pinnedAt);
							const isActive = selectedThreadId === thread.id;
							const isWorking = thread.runStatus.state === "working";
							const threadStatusDismissed = isThreadStatusDismissed(thread);
							const hasRunError =
								!threadStatusDismissed && thread.runStatus.state === "failed";
							const hasRunStopped =
								!threadStatusDismissed && thread.runStatus.state === "stopped";
							const hasUnreadError =
								!threadStatusDismissed && thread.runStatus.hasUnreadError;
							const threadErrorPreviewText =
								hasUnreadError || hasRunError || hasRunStopped
									? (thread.runStatus.error ?? "")
									: "";
							const threadAriaLabel = [
								thread.title,
								threadPinned ? "Pinned." : null,
								hasUnreadError
									? "Unread error."
									: hasRunError
										? "Error."
										: hasRunStopped
											? "Stopped."
											: isWorking
												? "Working."
												: null,
								`Branch ${threadBranchName}.`,
								`Worktree ${threadWorktreeDisplayPath}.`,
							]
								.filter(Boolean)
								.join(" ");
							const threadPreviewHandlers = threadErrorPreviewText
								? errorPreviewHandlers(
										threadPopoverAnchorId,
										threadErrorPreviewText,
									)
								: threadSummaryPreviewHandlers(
										threadPopoverAnchorId,
										thread.title,
										thread.summary,
									);
							const threadPreviewDescriptionId =
								errorPreviewPopover?.anchorId === threadPopoverAnchorId
									? "thread-error-popover"
									: threadSummaryPopover?.anchorId === threadPopoverAnchorId
										? "thread-summary-popover"
										: undefined;
							return (
								<button
									type="button"
									key={thread.id}
									aria-describedby={threadPreviewDescriptionId}
									aria-label={threadAriaLabel}
									className={`w-full rounded-sm px-3 py-2 text-left transition-colors ${
										isActive
											? "bg-[#273036] text-[#f2f0ef]"
											: "bg-[#151515] text-[#d7d7d7] hover:bg-[#1f2020]"
									}`}
									{...threadPreviewHandlers}
									onContextMenu={(event) => {
										event.preventDefault();
										event.stopPropagation();
										hideErrorPreview();
										hideThreadSummaryPreview();
										openThreadActionMenu(
											thread,
											event.clientX + 6,
											event.clientY + 6,
										);
									}}
									onClick={() => {
										hideErrorPreview();
										hideThreadSummaryPreview();
										dismissThreadStatus(thread);
										if (thread.runStatus.hasUnreadError) {
											acknowledgeThreadErrorSeenInBackground(thread.id);
										}
										void openThread(thread.id);
									}}
								>
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-2">
											<span
												className={`h-2 w-2 shrink-0 rounded-full ${
													hasUnreadError
														? "bg-[#ff304f]"
														: hasRunError
															? "bg-[#8f4956]"
															: hasRunStopped
																? "bg-[#b98a3a]"
																: isActive
																	? "bg-[#bdd5e6]"
																	: "bg-[#545d64]"
												}`}
											/>
											<div className="min-w-0 truncate text-sm font-medium">
												{thread.title}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											{threadPinned ? (
												<span className="pointer-events-none">
													{materialSymbol(
														"push_pin",
														"text-[14px] text-[#dfebf3]",
														{ filled: true },
													)}
												</span>
											) : null}
											{hasUnreadError ? (
												<span className="rounded-full border border-[#7a2030] bg-[#381018] px-2 py-0.5 font-label text-[9px] font-bold uppercase tracking-[0.16em] text-[#ff8698]">
													Unread
												</span>
											) : null}
											{isWorking ? (
												<BeatLoader
													color="#bdd5e6"
													margin={1}
													size={5}
													speedMultiplier={0.85}
												/>
											) : null}
										</div>
									</div>
									<div className="mt-1 flex min-w-0 items-center gap-1 text-[11px]">
										<span className="min-w-0 truncate text-[#d7d7d7]">
											{threadBranchName}
										</span>
										<span className="shrink-0 text-[#727e86]">|</span>
										<span className="min-w-0 truncate text-[#8f9aa2]">
											{threadFolderName}
										</span>
									</div>
								</button>
							);
						})
					)}
					{threadsError ? (
						<div className="text-xs text-[#ff6e84]">{threadsError}</div>
					) : null}
				</div>
			) : null}
		</div>
	);

	const gitSection = (
		<div className="border-t border-[#262626] px-3 py-3">
			<SidebarSectionHeader
				title={
					<>
						<span>Git</span>
						{gitHistory?.branch || activeSelectedWorktree?.branch ? (
							<span className="font-medium normal-case text-[#879198]">
								{" - "}
								{gitHistory?.branch ?? activeSelectedWorktree?.branch}
							</span>
						) : null}
					</>
				}
				open={gitSectionOpen}
				onToggle={() => {
					setGitSectionOpen((current) => !current);
				}}
			/>
			{gitSectionOpen ? (
				<div className="mt-3 space-y-3">
					<div className="px-1">
						<span className="font-label text-[11px] tracking-[0.12em] text-[#d8d8d8]">
							Git History
						</span>
					</div>
					{!selectedProject || !activeSelectedWorktreePath ? (
						<div className="rounded-sm border border-[#212121] bg-[#151515] px-3 py-3 text-xs text-[#8f8d8b]">
							Select a project worktree first.
						</div>
					) : gitHistoryLoading ? (
						<div className="rounded-sm border border-[#283239] bg-[#151b20] px-3 py-3 text-xs text-[#d4e4ef]">
							Loading git history...
						</div>
					) : gitHistoryError && filteredGitHistoryEntries.length === 0 ? (
						<div className="rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-xs text-[#ff9db0]">
							{gitHistoryError}
						</div>
					) : filteredGitHistoryEntries.length > 0 ? (
						<div className="space-y-2">
							<div
								ref={gitHistoryListRef}
								className="max-h-64 overflow-y-auto pr-1 hide-scrollbar"
								onScroll={handleGitHistoryScroll}
							>
								{visibleGitHistoryEntries.topSpacerHeight > 0 ? (
									<div
										aria-hidden="true"
										style={{
											height: `${visibleGitHistoryEntries.topSpacerHeight}px`,
										}}
									/>
								) : null}
								<div>
									{visibleGitHistoryEntries.entries.map((entry) => (
										<button
											type="button"
											key={entry.hash}
											className="w-full rounded-sm border border-[#23282c] bg-[#151515] px-3 py-2 text-left transition-colors hover:bg-[#1f2427]"
											style={{ height: `${GIT_HISTORY_ROW_HEIGHT_PX}px` }}
											onMouseEnter={() => {
												preloadGitHistoryDiff(entry);
											}}
											onFocus={() => {
												preloadGitHistoryDiff(entry);
											}}
											onBlur={() => {
												cancelPreloadGitHistoryDiff(entry);
											}}
											onPointerDown={() => {
												preloadGitHistoryDiff(entry);
											}}
											onMouseLeave={() => {
												cancelPreloadGitHistoryDiff(entry);
											}}
											onClick={() => {
												void openGitHistoryDiff(entry);
											}}
										>
											<div className="flex items-start gap-3">
												<span className="mt-0.5 shrink-0 rounded-full border border-[#39444b] bg-[#182026] px-2 py-0.5 font-mono text-[10px] text-[#bdd5e6]">
													{entry.shortHash}
												</span>
												<div className="min-w-0 flex-1">
													<div
														className="truncate text-sm text-[#f2f0ef]"
														title={entry.subject}
													>
														{entry.subject}
													</div>
													<div className="mt-1 truncate text-[11px] text-[#8f9aa2]">
														{entry.authorName} ·{" "}
														{formatGitHistoryTimestamp(entry.committedAt)}
													</div>
												</div>
											</div>
										</button>
									))}
								</div>
								{visibleGitHistoryEntries.bottomSpacerHeight > 0 ? (
									<div
										aria-hidden="true"
										style={{
											height: `${visibleGitHistoryEntries.bottomSpacerHeight}px`,
										}}
									/>
								) : null}
							</div>
							{gitHistoryLoadingMore ? (
								<div className="px-1 text-[11px] text-[#8f9aa2]">
									Loading more commits...
								</div>
							) : null}
							{gitHistoryError ? (
								<div className="rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-2 text-[11px] text-[#ff9db0]">
									{gitHistoryError}
								</div>
							) : null}
						</div>
					) : gitHistoryLoadingMore ? (
						<div className="rounded-sm border border-[#283239] bg-[#151b20] px-3 py-3 text-xs text-[#d4e4ef]">
							Loading more git history...
						</div>
					) : (
						<div className="rounded-sm border border-[#212121] bg-[#151515] px-3 py-3 text-xs text-[#8f8d8b]">
							{normalizedSidebarSearchQuery
								? "No matching git history."
								: "No commits found for this worktree yet."}
						</div>
					)}
				</div>
			) : null}
		</div>
	);

	useEffect(() => {
		if (initializedRef.current) {
			return;
		}
		initializedRef.current = true;
		void initialize();
	}, [initialize]);

	useEffect(() => {
		window.__joltAppMountedAt = Date.now();
		console.log("App.tsx mounted", window.__joltAppMountedAt);
	}, []);

	return (
		<div className="h-screen overflow-hidden bg-[#0e0e0e] text-[#ffffff]">
			<div className="hidden h-full md:flex md:flex-col">
				<header className="flex justify-between items-center w-full px-6 h-14 bg-[#131313] border-b border-[#262626] z-50">
					<div className="flex items-center gap-8">
						<h1 className="text-xl font-black tracking-tighter text-[#bdd5e6]">
							{APP_TITLE}
						</h1>
						<nav className="flex items-center gap-6">
							<button
								type="button"
								className={`font-label text-xs uppercase tracking-wider pb-1 transition-colors duration-200 ${
									primaryView === "chat"
										? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
										: "text-[#adabaa] hover:text-[#f2f0ef]"
								}`}
								onClick={() => {
									setPrimaryView("chat");
								}}
							>
								Chat
							</button>
							<button
								type="button"
								className={`font-label text-xs uppercase tracking-wider pb-1 transition-colors duration-200 ${
									primaryView === "diff"
										? "border-b-2 border-[#7eadce] text-[#bdd5e6]"
										: "text-[#adabaa] hover:text-[#f2f0ef]"
								}`}
								onClick={() => {
									setPrimaryView("diff");
								}}
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
					<span className="font-label text-xs font-bold text-[#bdd5e6] shrink-0">
						{selectedThread?.title ??
							selectedProject?.name ??
							"No project selected"}
					</span>
					{selectedProject ? (
						<>
							<span className="text-[#545d64] text-xs shrink-0">|</span>
							<span className="font-label text-xs text-[#f2f0ef] truncate">
								{activeSelectedWorktreeFolder}
							</span>
							<span className="font-label text-xs text-[#8f8d8b] truncate">
								{activeSelectedWorktreeName}
							</span>
						</>
					) : null}
				</div>

				<main className="flex flex-1 min-h-0 overflow-hidden">
					<aside
						className={`flex min-h-0 shrink-0 flex-col border-r border-[#262626] bg-[#131313] transition-all duration-300 ${
							sidebarCollapsed ? "w-14" : "w-80"
						}`}
					>
						<div className="flex items-center justify-end border-b border-[#262626] px-3 py-3">
							<button
								type="button"
								className="px-2 py-1 rounded-sm text-[#bdd5e6] hover:bg-[#202020]"
								onClick={() => setSidebarCollapsed((value) => !value)}
							>
								{sidebarCollapsed ? "☰" : "⟨"}
							</button>
						</div>
						<div className="flex-1 overflow-y-auto py-2">
							{!sidebarCollapsed ? (
								<div className="px-3 pb-2">{sidebarSearch}</div>
							) : null}
							{!sidebarCollapsed ? projectSection : null}
							{!sidebarCollapsed ? threadSection : null}
							{!sidebarCollapsed ? gitSection : null}
						</div>
					</aside>

					<section className="flex min-w-0 flex-1 flex-col bg-[#0e0e0e]">
						{primaryView === "chat" ? (
							<>
								<div
									ref={desktopChatScrollRef}
									className="flex-1 overflow-y-auto px-6 py-8 space-y-8 hide-scrollbar"
									onScroll={handleDesktopChatScroll}
								>
									<div className="max-w-4xl mx-auto mb-12">
										<h1 className="mb-2 font-headline text-4xl font-extrabold tracking-tight text-[#ffffff]">
											{activeScreenTitle}
										</h1>
										<p className="max-w-2xl font-body text-sm text-[#b3afad]">
											<span className="text-[#ddd8d5]">
												{activeScreenSubtitlePrimary}
											</span>
											<span className="text-[#7f7c79]">
												{" "}
												| {activeScreenSubtitleSecondary}
											</span>
										</p>
									</div>
									<div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-10">
										{renderDesktopMessages}
									</div>
								</div>
								<form
									className="bg-[#131313] border-t border-[#262626] p-6"
									onSubmit={onSubmit}
								>
									<div className="max-w-4xl mx-auto">
										<div className="flex items-center gap-2 p-2 border-b border-[#484848]/10">
											<div className="min-w-[15rem] max-w-[22rem]">
												<CodexModelSelector
													models={codexModels}
													value={activeCodexModel}
													disabled={modelSelectorDisabled}
													onChange={(value) => {
														void updateActiveCodexModel(value);
													}}
													variant="desktop"
												/>
											</div>
											<div className="min-w-[7.5rem] max-w-[8.5rem]">
												<ReasoningEffortSelector
													options={reasoningEfforts}
													value={activeReasoningEffort}
													disabled={reasoningEffortSelectorDisabled}
													onChange={(value) => {
														void updateActiveReasoningEffort(value);
													}}
													variant="desktop"
												/>
											</div>
											<ProjectTaskSelector
												tasks={projectTasks}
												loading={isLoadingProjectTasks}
												disabled={taskSelectorDisabled}
												onSelect={(task) => {
													void runSelectedTask(task);
												}}
												variant="desktop"
											/>
											<div className="flex-1" />
											<ContextUsageMeter
												inputTokens={activeContextInputTokens}
												contextWindowTokens={activeContextWindowTokens}
												estimatedTriggerTokens={activeCompactionTriggerTokens}
												estimatedTriggerSource={activeCompactionTriggerSource}
												maxObservedInputTokens={activeMaxObservedInputTokens}
												inferredCount={activeCompactionInferenceCount}
												lastInferredBeforeInputTokens={
													activeLastCompactionBeforeInputTokens
												}
												lastInferredAfterInputTokens={
													activeLastCompactionAfterInputTokens
												}
											/>
										</div>
										{modelControlError ? (
											<div className="mt-2 text-xs text-[#ff6e84]">
												{modelControlError}
											</div>
										) : null}
										{reasoningEffortControlError ? (
											<div className="mt-2 text-xs text-[#ff6e84]">
												{reasoningEffortControlError}
											</div>
										) : null}
										{taskControlError ? (
											<div className="mt-2 text-xs text-[#ff6e84]">
												{taskControlError}
											</div>
										) : null}
										<div className="relative flex items-end p-4 gap-4 border border-[#2b2b2b] bg-[#262626] rounded-sm">
											<textarea
												ref={desktopComposerRef}
												className="flex-1 overflow-y-auto bg-transparent border-none focus:ring-0 text-sm leading-6 placeholder:text-[#adabaa]/50 resize-none font-body px-2"
												placeholder={
													selectedThread
														? `Ask ${APP_TITLE} to generate, refactor, or debug...`
														: `Create a thread to start chatting with ${APP_TITLE}...`
												}
												rows={3}
												style={{
													minHeight: `${DESKTOP_COMPOSER_MIN_HEIGHT_PX}px`,
													maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px`,
												}}
												value={chatInput}
												onChange={onChatInputChange}
												onKeyDown={onEnter}
												disabled={
													!selectedThread ||
													isSending ||
													selectedThreadIsWorking ||
													isThreadLoading
												}
											/>
											<button
												type="submit"
												className={`w-10 h-10 flex items-center justify-center rounded-sm hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60 ${composerActionToneClassName}`}
												disabled={composerActionDisabled}
												aria-label={composerActionLabel}
												title={composerActionLabel}
											>
												{materialSymbol(
													selectedThreadIsWorking ? "stop" : "arrow_forward",
												)}
											</button>
										</div>
									</div>
								</form>
							</>
						) : (
							<div className="min-h-0 flex-1 px-6 py-6">
								{renderDiffWorkspace({
									mobile: false,
								})}
							</div>
						)}
					</section>
				</main>
			</div>

			<div className="flex h-full flex-col overflow-hidden md:hidden">
				<header className="fixed top-0 w-full z-50 bg-[#0e0e0e] flex items-center justify-between px-4 h-14">
					<div className="flex items-center gap-3">
						<button
							type="button"
							className="text-[#bdd5e6]"
							onClick={() => setMobileProjectListOpen((value) => !value)}
						>
							{materialSymbol("menu")}
						</button>
						<h1 className="font-headline tracking-wider uppercase text-sm font-bold text-[#bdd5e6]">
							{APP_TITLE}
						</h1>
					</div>
					<div className="flex items-center gap-3">
						{materialSymbol("search", "text-on-surface-variant")}
					</div>
				</header>

				{mobileProjectListOpen ? (
					<aside className="fixed inset-x-0 top-14 z-40 h-[68vh] overflow-y-auto bg-[#191a1a] border-b border-[#3f3f3f] py-2">
						<div className="px-3 pb-2">{sidebarSearch}</div>
						{projectSection}
						{threadSection}
						{gitSection}
					</aside>
				) : null}

				<main className="mx-auto flex w-full max-w-2xl flex-1 min-h-0 flex-col gap-6 px-4 pt-14 pb-16">
					{primaryView === "chat" ? (
						<>
							<div className="mt-6 shrink-0">
								<h2 className="font-headline text-[1.85rem] font-extrabold tracking-tight text-[#ffffff] leading-tight">
									{activeScreenTitle}
								</h2>
								<p className="mt-2 text-xs text-[#b3afad]">
									<span className="text-[#ddd8d5]">
										{activeScreenSubtitlePrimary}
									</span>
									<span className="text-[#7f7c79]">
										{" "}
										| {activeScreenSubtitleSecondary}
									</span>
								</p>
							</div>
							<div
								ref={mobileChatScrollRef}
								className="flex flex-1 min-h-0 flex-col gap-8 overflow-y-auto pb-40 hide-scrollbar"
								onScroll={handleMobileChatScroll}
							>
								{renderMobileMessages}
							</div>
						</>
					) : (
						<div className="flex min-h-0 flex-1 flex-col gap-4 pt-6">
							{renderDiffWorkspace({
								mobile: true,
							})}
						</div>
					)}
				</main>

				{primaryView === "chat" ? (
					<div className="fixed bottom-16 left-0 right-0 px-4 pb-4 z-40">
						<form
							className="max-w-2xl mx-auto flex flex-col gap-3"
							onSubmit={onSubmit}
						>
							<div className="overflow-visible rounded-[1.35rem] border border-[#384249] bg-[#181b1e] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
								<div className="border-b border-[#313a40] px-2 py-2">
									<div className="flex items-center gap-2">
										<div className="min-w-0 flex-1">
											<CodexModelSelector
												models={codexModels}
												value={activeCodexModel}
												disabled={modelSelectorDisabled}
												onChange={(value) => {
													void updateActiveCodexModel(value);
												}}
												variant="mobile"
											/>
										</div>
										<div className="w-[6.75rem] shrink-0">
											<ReasoningEffortSelector
												options={reasoningEfforts}
												value={activeReasoningEffort}
												disabled={reasoningEffortSelectorDisabled}
												onChange={(value) => {
													void updateActiveReasoningEffort(value);
												}}
												variant="mobile"
											/>
										</div>
										<ProjectTaskSelector
											tasks={projectTasks}
											loading={isLoadingProjectTasks}
											disabled={taskSelectorDisabled}
											onSelect={(task) => {
												void runSelectedTask(task);
											}}
											variant="mobile"
										/>
									</div>
								</div>
								<div className="relative flex items-end gap-2 rounded-b-[1.35rem] bg-[#181b1e] px-2 py-2">
									<textarea
										ref={mobileComposerRef}
										className="min-h-0 flex-grow overflow-y-auto rounded-[1rem] border border-[#333c43] bg-[#1e2123] px-3 py-2 text-[#ffffff] text-sm leading-6 resize-none placeholder:text-[#adabaa]/50 focus:border-[#9fc1da] focus:outline-none"
										placeholder={
											selectedThread
												? `Ask ${APP_TITLE}...`
												: `Create a thread to chat with ${APP_TITLE}...`
										}
										rows={1}
										style={{
											minHeight: `${MOBILE_COMPOSER_MIN_HEIGHT_PX}px`,
											maxHeight: `${COMPOSER_MAX_HEIGHT_PX}px`,
										}}
										value={chatInput}
										onChange={onChatInputChange}
										onKeyDown={onEnter}
										disabled={
											!selectedThread ||
											isSending ||
											selectedThreadIsWorking ||
											isThreadLoading
										}
									/>
									<button
										className={`p-2 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center disabled:cursor-not-allowed disabled:opacity-60 ${
											selectedThreadIsWorking
												? "bg-[#4b2028] text-[#ffd4da]"
												: "bg-gradient-to-tr from-[#bdd5e6] to-[#adcbe0] text-[#224259]"
										}`}
										type="submit"
										disabled={composerActionDisabled}
										aria-label={composerActionLabel}
										title={composerActionLabel}
									>
										{materialSymbol(
											selectedThreadIsWorking ? "stop" : "arrow_upward",
										)}
									</button>
								</div>
							</div>
							{modelControlError ? (
								<div className="text-xs text-[#ff6e84]">
									{modelControlError}
								</div>
							) : null}
							{reasoningEffortControlError ? (
								<div className="text-xs text-[#ff6e84]">
									{reasoningEffortControlError}
								</div>
							) : null}
							{taskControlError ? (
								<div className="text-xs text-[#ff6e84]">{taskControlError}</div>
							) : null}
						</form>
					</div>
				) : null}

				<div className="fixed bottom-0 left-0 w-full z-50">
					<div className="w-full h-1 bg-[#000000]">
						<div className="h-full bg-[#bdd5e6]/40 w-[100%] relative overflow-hidden">
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
						<button
							type="button"
							className={`flex flex-col items-center justify-center pt-2 transition-colors ${
								primaryView === "chat"
									? "text-[#bdd5e6] font-bold border-t-2 border-[#bdd5e6]"
									: "text-[#adabaa] hover:text-[#f2f0ef]"
							}`}
							onClick={() => {
								setPrimaryView("chat");
							}}
						>
							{brandBoltIcon("text-sm")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								AI Chat
							</span>
						</button>
						<button
							type="button"
							className={`flex flex-col items-center justify-center pt-2 transition-colors ${
								primaryView === "diff"
									? "text-[#bdd5e6] font-bold border-t-2 border-[#bdd5e6]"
									: "text-[#adabaa] hover:text-[#f2f0ef]"
							}`}
							onClick={() => {
								setPrimaryView("diff");
							}}
						>
							{materialSymbol("difference")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								Diff
							</span>
						</button>
						<div className="flex flex-col items-center justify-center text-[#adabaa] pt-2 hover:text-[#f2f0ef] transition-colors">
							{materialSymbol("checklist")}
							<span className="font-label text-[10px] uppercase tracking-widest mt-1">
								Tasks
							</span>
						</div>
					</nav>
				</div>
			</div>
			{errorPreviewPopover ? (
				<div
					id="thread-error-popover"
					role="note"
					className="pointer-events-none fixed z-[110] max-w-[22rem] rounded-md border border-[#7a2030] bg-[#341019]/96 px-3 py-2 text-xs leading-5 text-[#ffb1bf] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
					style={{
						left: errorPreviewPopover.x,
						top: errorPreviewPopover.y,
						transform: "translateY(-50%)",
					}}
				>
					<div className="whitespace-pre-wrap break-words">
						{errorPreviewPopover.text}
					</div>
				</div>
			) : null}
			{threadSummaryPopover ? (
				<div
					id="thread-summary-popover"
					role="note"
					className="pointer-events-none fixed z-[108] hidden max-w-[22rem] rounded-md border border-[#31404a] bg-[#13191d]/96 px-3 py-3 text-xs leading-5 text-[#d6e7f2] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm md:block"
					style={{
						left: threadSummaryPopover.x,
						top: threadSummaryPopover.y,
					}}
				>
					<div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#8fb5cd]">
						Thread Summary
					</div>
					<div className="mb-2 text-sm font-semibold text-[#f2f0ef]">
						{threadSummaryPopover.title}
					</div>
					<div className="whitespace-pre-wrap break-words text-[#bfd1dc]">
						{threadSummaryPopover.summary}
					</div>
				</div>
			) : null}
			{gitHistoryModal ? (
				<GitHistoryDiffModal
					state={gitHistoryModal}
					onClose={closeGitHistoryModal}
				/>
			) : null}
			{projectActionMenuPanel}
			{threadActionMenuPanel}
		</div>
	);
}
