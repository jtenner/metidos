import {
	type CSSProperties,
	type ChangeEvent,
	type FormEvent,
	type HTMLAttributes,
	type JSX,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactNode,
	type SVGProps,
	type UIEvent,
	startTransition,
	useCallback,
	useDeferredValue,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { BeatLoader } from "react-spinners";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";
import type {
	ProjectProcedures,
	RpcCodexModelOption,
	RpcGitHistoryEntry,
	RpcProject,
	RpcProjectTask,
	RpcThread,
	RpcThreadDetail,
	RpcThreadMessage,
	RpcThreadRunStatus,
	RpcWorktree,
	RpcWorktreeGitHistoryChanged,
	RpcWorktreeGitHistoryResult,
	RpcWorktreeSnapshot,
	RpcWorktreeTasksChanged,
} from "../bun/rpc-schema";

type VisibleMessage =
	| {
			kind: "chat";
			speaker: "assistant" | "user";
			text: string;
			tone?: "normal" | "working" | "error";
	  }
	| {
			kind: "reasoning";
			text: string;
			state: "in_progress" | "completed";
	  }
	| {
			kind: "command";
			command: string;
			output: string;
			state: "in_progress" | "completed" | "failed";
			exitCode: number | null;
	  }
	| {
			kind: "file_change";
			path: string;
			diffText: string;
			changeKind: "add" | "delete" | "update";
			state: "completed" | "failed";
	  };

type MessageGroup =
	| {
			kind: "assistant";
			key: string;
			messages: Array<{
				index: number;
				message: VisibleMessage;
			}>;
	  }
	| {
			kind: "user";
			key: string;
			text: string;
	  };

type DiffLine = {
	kind: "meta" | "file" | "hunk" | "context" | "add" | "remove";
	key: string;
	text: string;
};

type GitHistoryModalState = {
	projectId: number;
	worktreePath: string;
	entry: RpcGitHistoryEntry;
	diffText: string;
	loading: boolean;
	error: string;
};

type ProjectNodeState = {
	worktrees: RpcWorktree[];
	loadingWorktrees: boolean;
	error: string;
	openWorktrees: Set<string>;
};

type WorktreeNodeState = {
	loading: boolean;
	opened: boolean;
	snapshot?: RpcWorktreeSnapshot | undefined;
	error: string;
};

type ProjectStateMap = Record<number, ProjectNodeState>;
type WorktreeStateMap = Record<string, WorktreeNodeState>;
type ProjectActionMenuState = {
	projectId: number;
	x: number;
	y: number;
};

type ThreadActionMenuState = {
	threadId: number;
	x: number;
	y: number;
};

type ThreadErrorLevel = "none" | "failed" | "unread";
type ThreadErrorPreview = {
	level: ThreadErrorLevel;
	text: string;
	updatedAt: string;
};
type ErrorPreviewPopoverState = {
	text: string;
	x: number;
	y: number;
};

type PersistedOpenWorktree = {
	projectId: number;
	worktreePath: string;
};

type PersistedMainviewState = {
	version: number;
	selectedProjectId: number | null;
	selectedWorktreePath: string | null;
	selectedThreadId: number | null;
	pendingThreadModel: string;
	chatInput: string;
	sidebarCollapsed: boolean;
	sidebarSearchQuery: string;
	openWorktrees: PersistedOpenWorktree[];
};

type PersistedTreeViewState = {
	version: number;
	projectsSectionOpen: boolean;
	threadsSectionOpen: boolean;
	gitSectionOpen: boolean;
	openProjectPaths: string[];
};

const WORKTREE_TASKS_CHANGED_EVENT_NAME = "jt-ide:worktree-tasks-changed";
const WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME =
	"jt-ide:worktree-git-history-changed";

const CODE_FONT_STACK =
	'"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const DIRECTORY_SUGGESTION_PREFETCH_DELAY_MS = 50;
const DIRECTORY_SUGGESTION_RESULT_CACHE_MAX_ENTRIES = 128;
const DIRECTORY_SUGGESTION_RESULT_CACHE_TTL_MS = 30_000;
const GIT_HISTORY_PAGE_SIZE = 20;
const GIT_HISTORY_RESULT_CACHE_MAX_ENTRIES = 8;
const GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES = 24;
const GIT_HISTORY_ROW_HEIGHT_PX = 66;
const GIT_HISTORY_DOM_WINDOW_SIZE = 20;
const GIT_HISTORY_RENDER_OVERSCAN_ROWS = 8;
const GIT_HISTORY_LOAD_MORE_THRESHOLD_PX = GIT_HISTORY_ROW_HEIGHT_PX * 3;
const DIFF_VIEWER_ROW_HEIGHT_PX = 24;
const DIFF_VIEWER_RENDER_OVERSCAN_ROWS = 80;
const THREAD_STATUS_POLL_INTERVAL_MS = 1_500;
const DESKTOP_COMPOSER_MIN_HEIGHT_PX = 96;
const MOBILE_COMPOSER_MIN_HEIGHT_PX = 44;
const COMPOSER_MAX_HEIGHT_PX = 240;
const MAINVIEW_STATE_STORAGE_KEY = "jt-ide:mainview-state";
const MAINVIEW_STATE_STORAGE_VERSION = 1;
const TREE_VIEW_STATE_STORAGE_KEY = "jt-ide:tree-view-state";
const TREE_VIEW_STATE_STORAGE_VERSION = 1;
const APP_TITLE = "Jolt";

type AppIconName =
	| "account_circle"
	| "arrow_forward"
	| "arrow_upward"
	| "bolt"
	| "check_circle"
	| "checklist"
	| "chevron_right"
	| "code"
	| "delete"
	| "difference"
	| "expand_less"
	| "expand_more"
	| "folder"
	| "menu"
	| "person"
	| "push_pin"
	| "radio_button_unchecked"
	| "search"
	| "settings"
	| "task_alt"
	| "terminal";

const codeBlockStyle = {
	margin: 0,
	border: "1px solid rgba(153, 190, 217, 0.18)",
	borderRadius: "0.5rem",
	background: "#111213",
	padding: "0.875rem 1rem",
	fontSize: "0.8125rem",
	lineHeight: "1.6",
} satisfies CSSProperties;

const codeTagStyle = {
	fontFamily: CODE_FONT_STACK,
} satisfies CSSProperties;

type DirectorySuggestionResultCacheEntry = {
	directories: string[];
	loadedAt: number;
};

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

const markdownComponents: Components = {
	a({ href, children, ...props }) {
		return (
			<a
				{...props}
				href={href}
				target="_blank"
				rel="noreferrer"
				className="text-[#c6dae9] underline decoration-[#7aa5c4] underline-offset-2 transition-colors hover:text-[#e3edf5]"
			>
				{children}
			</a>
		);
	},
	code({ children, className, node: _node, ...props }) {
		const code = String(children).replace(/\n$/, "");
		const languageMatch = /language-([\w-]+)/.exec(className ?? "");
		const isBlockCode = Boolean(languageMatch) || code.includes("\n");
		if (isBlockCode) {
			return (
				<SyntaxHighlighter
					PreTag="div"
					language={languageMatch?.[1] ?? "text"}
					style={vscDarkPlus}
					customStyle={codeBlockStyle}
					codeTagProps={{ style: codeTagStyle }}
					wrapLongLines
				>
					{code}
				</SyntaxHighlighter>
			);
		}

		return (
			<code
				{...props}
				className={`rounded-sm bg-[#1d2022] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#e1ecf3] ${className ?? ""}`.trim()}
			>
				{children}
			</code>
		);
	},
	pre({ children }) {
		return <div className="my-3 overflow-x-auto">{children}</div>;
	},
	table({ children }) {
		return (
			<div className="my-3 overflow-x-auto">
				<table className="message-markdown-table">{children}</table>
			</div>
		);
	},
};

function shortName(value: string): string {
	const normalized = value.replace(/[\\/]$/, "");
	const parts = normalized.split(/[\\/]/).filter(Boolean);
	return parts.at(-1) ?? value;
}

function normalizeSearchQuery(value: string): string {
	return value.trim().toLowerCase();
}

function matchesSearchQuery(
	searchQuery: string,
	...values: Array<string | null | undefined>
): boolean {
	if (!searchQuery) {
		return true;
	}
	return values.some((value) =>
		(value ?? "").toLowerCase().includes(searchQuery),
	);
}

function worktreeKey(projectId: number, worktreePath: string): string {
	return `${projectId}::${worktreePath}`;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

function defaultProjectState(): ProjectNodeState {
	return {
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

function mergeResetGitHistory(
	current: RpcWorktreeGitHistoryResult | null,
	nextPage: RpcWorktreeGitHistoryResult,
): RpcWorktreeGitHistoryResult {
	if (
		!current ||
		current.projectId !== nextPage.projectId ||
		current.worktreePath !== nextPage.worktreePath ||
		current.headHash !== nextPage.headHash ||
		current.branch !== nextPage.branch
	) {
		return nextPage;
	}

	const nextHashes = new Set(nextPage.entries.map((entry) => entry.hash));
	const preservedTail = current.entries.filter(
		(entry) => !nextHashes.has(entry.hash),
	);

	return {
		...nextPage,
		entries: [...nextPage.entries, ...preservedTail],
		nextOffset:
			preservedTail.length > 0 ? current.nextOffset : nextPage.nextOffset,
	};
}

function appendGitHistoryPage(
	current: RpcWorktreeGitHistoryResult,
	nextPage: RpcWorktreeGitHistoryResult,
): RpcWorktreeGitHistoryResult {
	const existingHashes = new Set(current.entries.map((entry) => entry.hash));
	const appendedEntries = nextPage.entries.filter(
		(entry) => !existingHashes.has(entry.hash),
	);

	return {
		...current,
		branch: nextPage.branch,
		headHash: nextPage.headHash,
		headShortHash: nextPage.headShortHash,
		lastUpdatedAt: nextPage.lastUpdatedAt,
		entries: [...current.entries, ...appendedEntries],
		limit: nextPage.limit,
		nextOffset: nextPage.nextOffset,
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
		const leftPinnedAt = left.pinnedAt ?? "";
		const rightPinnedAt = right.pinnedAt ?? "";
		if (leftPinnedAt || rightPinnedAt) {
			if (!leftPinnedAt) {
				return 1;
			}
			if (!rightPinnedAt) {
				return -1;
			}
			if (leftPinnedAt !== rightPinnedAt) {
				return rightPinnedAt.localeCompare(leftPinnedAt);
			}
		}
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

function defaultPersistedMainviewState(): PersistedMainviewState {
	return {
		version: MAINVIEW_STATE_STORAGE_VERSION,
		selectedProjectId: null,
		selectedWorktreePath: null,
		selectedThreadId: null,
		pendingThreadModel: "",
		chatInput: "",
		sidebarCollapsed: false,
		sidebarSearchQuery: "",
		openWorktrees: [],
	};
}

function defaultPersistedTreeViewState(): PersistedTreeViewState {
	return {
		version: TREE_VIEW_STATE_STORAGE_VERSION,
		projectsSectionOpen: true,
		threadsSectionOpen: true,
		gitSectionOpen: true,
		openProjectPaths: [],
	};
}

function parsePositiveInteger(value: unknown): number | null {
	return typeof value === "number" && Number.isInteger(value) && value > 0
		? value
		: null;
}

function normalizePersistedOpenWorktrees(
	value: unknown,
): PersistedOpenWorktree[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const next: PersistedOpenWorktree[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		const candidate = entry as Partial<PersistedOpenWorktree>;
		const projectId = parsePositiveInteger(candidate.projectId);
		const worktreePath = candidate.worktreePath;
		if (projectId === null) {
			continue;
		}
		if (typeof worktreePath !== "string" || !worktreePath.trim()) {
			continue;
		}

		const key = `${projectId}:${worktreePath}`;
		if (seen.has(key)) {
			continue;
		}

		seen.add(key);
		next.push({
			projectId,
			worktreePath,
		});
	}

	return next;
}

function normalizePersistedOpenProjectPaths(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	const next: string[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") {
			continue;
		}
		const projectPath = entry.trim();
		if (!projectPath || seen.has(projectPath)) {
			continue;
		}
		seen.add(projectPath);
		next.push(projectPath);
	}
	return next;
}

function readPersistedMainviewState(): PersistedMainviewState {
	const fallback = defaultPersistedMainviewState();
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const raw = window.sessionStorage.getItem(MAINVIEW_STATE_STORAGE_KEY);
		if (!raw) {
			return fallback;
		}

		const parsed = JSON.parse(raw) as Partial<PersistedMainviewState>;
		if (parsed.version !== MAINVIEW_STATE_STORAGE_VERSION) {
			return fallback;
		}

		return {
			version: MAINVIEW_STATE_STORAGE_VERSION,
			selectedProjectId: parsePositiveInteger(parsed.selectedProjectId),
			selectedWorktreePath:
				typeof parsed.selectedWorktreePath === "string" &&
				parsed.selectedWorktreePath.trim()
					? parsed.selectedWorktreePath
					: null,
			selectedThreadId: parsePositiveInteger(parsed.selectedThreadId),
			pendingThreadModel:
				typeof parsed.pendingThreadModel === "string"
					? parsed.pendingThreadModel
					: "",
			chatInput: typeof parsed.chatInput === "string" ? parsed.chatInput : "",
			sidebarCollapsed:
				typeof parsed.sidebarCollapsed === "boolean"
					? parsed.sidebarCollapsed
					: false,
			sidebarSearchQuery:
				typeof parsed.sidebarSearchQuery === "string"
					? parsed.sidebarSearchQuery
					: "",
			openWorktrees: normalizePersistedOpenWorktrees(parsed.openWorktrees),
		};
	} catch {
		return fallback;
	}
}

function readPersistedTreeViewState(): PersistedTreeViewState {
	const fallback = defaultPersistedTreeViewState();
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const raw = window.localStorage.getItem(TREE_VIEW_STATE_STORAGE_KEY);
		if (!raw) {
			return fallback;
		}

		const parsed = JSON.parse(raw) as Partial<PersistedTreeViewState>;
		if (parsed.version !== TREE_VIEW_STATE_STORAGE_VERSION) {
			return fallback;
		}

		return {
			version: TREE_VIEW_STATE_STORAGE_VERSION,
			projectsSectionOpen:
				typeof parsed.projectsSectionOpen === "boolean"
					? parsed.projectsSectionOpen
					: true,
			threadsSectionOpen:
				typeof parsed.threadsSectionOpen === "boolean"
					? parsed.threadsSectionOpen
					: true,
			gitSectionOpen:
				typeof parsed.gitSectionOpen === "boolean"
					? parsed.gitSectionOpen
					: true,
			openProjectPaths: normalizePersistedOpenProjectPaths(
				parsed.openProjectPaths,
			),
		};
	} catch {
		return fallback;
	}
}

function writePersistedMainviewState(state: PersistedMainviewState): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.sessionStorage.setItem(
			MAINVIEW_STATE_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Ignore storage write failures and continue without reload persistence.
	}
}

function writePersistedTreeViewState(state: PersistedTreeViewState): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		window.localStorage.setItem(
			TREE_VIEW_STATE_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Ignore storage write failures and continue without persistent tree state.
	}
}

function renderIconGlyph(
	name: AppIconName,
	filled: boolean,
): JSX.Element | JSX.Element[] {
	switch (name) {
		case "account_circle":
			return (
				<>
					<circle cx="12" cy="12" r="9" />
					<circle cx="12" cy="9" r="2.5" />
					<path d="M7.5 17c1.15-2 3.05-3 4.5-3s3.35 1 4.5 3" />
				</>
			);
		case "arrow_forward":
			return (
				<>
					<path d="M5 12h12.5" />
					<path d="m13.5 7 5 5-5 5" />
				</>
			);
		case "arrow_upward":
			return (
				<>
					<path d="M12 18V6" />
					<path d="m7 11 5-5 5 5" />
				</>
			);
		case "bolt":
			return filled ? (
				<path
					d="M13 2 5 13h5l-1 9 8-11h-5z"
					fill="currentColor"
					stroke="none"
				/>
			) : (
				<path d="M13 2 5 13h5l-1 9 8-11h-5z" />
			);
		case "check_circle":
			return (
				<>
					<circle cx="12" cy="12" r="8" />
					<path d="m8.75 12.25 2.15 2.15 4.35-4.65" />
				</>
			);
		case "checklist":
			return (
				<>
					<rect x="6" y="4" width="12" height="16" rx="2" />
					<path d="m9 10 1.5 1.5L13 9" />
					<path d="M9 15h6" />
				</>
			);
		case "chevron_right":
			return <path d="m10 7 5 5-5 5" />;
		case "code":
			return (
				<>
					<path d="m9 7-5 5 5 5" />
					<path d="m15 7 5 5-5 5" />
				</>
			);
		case "delete":
			return (
				<>
					<path d="M5 7h14" />
					<path d="M9 7V5h6v2" />
					<path d="M8 7v11h8V7" />
					<path d="M10 10v5" />
					<path d="M14 10v5" />
				</>
			);
		case "difference":
			return (
				<>
					<rect x="5" y="5" width="8" height="8" rx="1.5" />
					<rect x="11" y="11" width="8" height="8" rx="1.5" />
				</>
			);
		case "expand_less":
			return <path d="m7 14 5-5 5 5" />;
		case "expand_more":
			return <path d="m7 10 5 5 5-5" />;
		case "folder":
			return (
				<>
					<path d="M3.5 8.5h5l1.75-2h10.25v11H3.5z" />
					<path d="M3.5 8.5v-1A2.5 2.5 0 0 1 6 5h3" />
				</>
			);
		case "menu":
			return (
				<>
					<path d="M4 7h16" />
					<path d="M4 12h16" />
					<path d="M4 17h16" />
				</>
			);
		case "person":
			return (
				<>
					<circle cx="12" cy="9" r="2.5" />
					<path d="M7.5 18c1.15-2.1 3.05-3.2 4.5-3.2s3.35 1.1 4.5 3.2" />
				</>
			);
		case "push_pin":
			return filled ? (
				<path
					d="M9 4h6l-1.25 4L17 11v1h-4v7l-1 1-1-1v-7H7v-1l3.25-3L9 4Z"
					fill="currentColor"
					stroke="none"
				/>
			) : (
				<>
					<path d="M9 4h6l-1.25 4L17 11v1H7v-1l3.25-3L9 4Z" />
					<path d="M12 12v8" />
				</>
			);
		case "radio_button_unchecked":
			return <circle cx="12" cy="12" r="7.5" />;
		case "search":
			return (
				<>
					<circle cx="11" cy="11" r="5.5" />
					<path d="m16 16 4 4" />
				</>
			);
		case "settings":
			return (
				<>
					<circle cx="12" cy="12" r="2.75" />
					<path d="M12 4.5v2" />
					<path d="M12 17.5v2" />
					<path d="M4.5 12h2" />
					<path d="M17.5 12h2" />
					<path d="m6.7 6.7 1.4 1.4" />
					<path d="m15.9 15.9 1.4 1.4" />
					<path d="m17.3 6.7-1.4 1.4" />
					<path d="m8.1 15.9-1.4 1.4" />
				</>
			);
		case "task_alt":
			return (
				<>
					<circle cx="12" cy="12" r="8" />
					<path d="m8.75 12.25 2.15 2.15 4.35-4.65" />
				</>
			);
		case "terminal":
			return (
				<>
					<path d="m6.5 8.5 3.5 3.5-3.5 3.5" />
					<path d="M12 15.5h5.5" />
				</>
			);
	}

	const exhaustiveCheck: never = name;
	throw new Error(`Unsupported icon: ${exhaustiveCheck}`);
}

function materialSymbol(
	name: AppIconName,
	className = "",
	options: {
		filled?: boolean;
	} = {},
): JSX.Element {
	const { filled = false } = options;
	const svgProps: SVGProps<SVGSVGElement> = {
		"aria-hidden": "true",
		className: `inline-block shrink-0 align-middle ${className}`.trim(),
		fill: "none",
		focusable: false,
		height: "1em",
		stroke: "currentColor",
		strokeLinecap: "round",
		strokeLinejoin: "round",
		strokeWidth: 1.85,
		viewBox: "0 0 24 24",
		width: "1em",
	};

	return (
		<svg {...svgProps}>
			<title>{name.replaceAll("_", " ")}</title>
			{renderIconGlyph(name, filled)}
		</svg>
	);
}

function brandBoltIcon(className = ""): JSX.Element {
	return materialSymbol("bolt", `rotate-45 ${className}`.trim(), {
		filled: true,
	});
}

function MarkdownMessage({ text }: { text: string }): JSX.Element {
	return (
		<div className="message-markdown min-w-0 break-words">
			<ReactMarkdown
				components={markdownComponents}
				remarkPlugins={[remarkGfm]}
			>
				{text}
			</ReactMarkdown>
		</div>
	);
}

function groupCodexModels(
	models: RpcCodexModelOption[],
): Array<{ group: string; models: RpcCodexModelOption[] }> {
	const grouped = new Map<string, RpcCodexModelOption[]>();
	for (const model of models) {
		const entries = grouped.get(model.group) ?? [];
		entries.push(model);
		grouped.set(model.group, entries);
	}
	return [...grouped.entries()].map(([group, entries]) => ({
		group,
		models: entries,
	}));
}

function codexModelLabel(model: RpcCodexModelOption): string {
	return model.deprecated ? `${model.label} (Deprecated)` : model.label;
}

function findCodexModel(
	models: RpcCodexModelOption[],
	modelId: string,
): RpcCodexModelOption | null {
	return models.find((model) => model.id === modelId) ?? null;
}

function formatCompactTokenCount(value: number): string {
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
	}
	return value.toString();
}

function formatCompactionTransition(
	beforeTokens: number | null,
	afterTokens: number | null,
): string | null {
	if (
		typeof beforeTokens !== "number" ||
		typeof afterTokens !== "number" ||
		beforeTokens <= 0 ||
		afterTokens < 0
	) {
		return null;
	}
	return `${formatCompactTokenCount(beforeTokens)}→${formatCompactTokenCount(afterTokens)}`;
}

function ContextUsageMeter({
	inputTokens,
	contextWindowTokens,
	estimatedTriggerTokens,
	estimatedTriggerSource,
	maxObservedInputTokens,
	inferredCount,
	lastInferredBeforeInputTokens,
	lastInferredAfterInputTokens,
}: {
	inputTokens: number;
	contextWindowTokens: number;
	estimatedTriggerTokens: number;
	estimatedTriggerSource: "heuristic" | "observed";
	maxObservedInputTokens: number | null;
	inferredCount: number;
	lastInferredBeforeInputTokens: number | null;
	lastInferredAfterInputTokens: number | null;
}): JSX.Element {
	const safeEstimatedTriggerTokens = Math.max(estimatedTriggerTokens, 1);
	const safeContextWindowTokens = Math.max(contextWindowTokens, 1);
	const usageRatio = Math.min(inputTokens / safeEstimatedTriggerTokens, 1);
	const radius = 9;
	const circumference = 2 * Math.PI * radius;
	const strokeOffset = circumference * (1 - usageRatio);
	const strokeColor =
		usageRatio >= 1 ? "#ff6e84" : usageRatio >= 0.85 ? "#ffbe78" : "#8bf0c0";
	const estimateLabel =
		estimatedTriggerSource === "observed" ? "Observed" : "Heuristic";
	const lastCompactionTransition = formatCompactionTransition(
		lastInferredBeforeInputTokens,
		lastInferredAfterInputTokens,
	);
	const titleParts = [
		`Last turn input: ${inputTokens.toLocaleString()} tokens`,
		`${estimateLabel} compaction trigger: ${estimatedTriggerTokens.toLocaleString()} tokens`,
		`Model window: ${contextWindowTokens.toLocaleString()} tokens`,
	];
	if (typeof maxObservedInputTokens === "number") {
		titleParts.push(
			`Max observed input: ${maxObservedInputTokens.toLocaleString()} tokens`,
		);
	}
	if (lastCompactionTransition) {
		titleParts.push(
			`Last inferred compaction: ${lastCompactionTransition} (${inferredCount} observed)`,
		);
	}

	return (
		<div className="flex items-center" title={titleParts.join(" • ")}>
			<div className="relative h-7 w-7 shrink-0">
				<svg
					viewBox="0 0 24 24"
					className="-rotate-90 h-7 w-7"
					aria-hidden="true"
				>
					<circle
						cx="12"
						cy="12"
						r={radius}
						fill="none"
						stroke="rgba(143, 141, 139, 0.22)"
						strokeWidth="2"
					/>
					<circle
						cx="12"
						cy="12"
						r={radius}
						fill="none"
						stroke={strokeColor}
						strokeWidth="2"
						strokeLinecap="round"
						strokeDasharray={circumference}
						strokeDashoffset={strokeOffset}
					/>
				</svg>
			</div>
		</div>
	);
}

function resizeComposerTextarea(
	element: HTMLTextAreaElement | null,
	minHeightPx: number,
): void {
	if (!element) {
		return;
	}
	element.style.height = "auto";
	const nextHeight = Math.min(
		Math.max(element.scrollHeight, minHeightPx),
		COMPOSER_MAX_HEIGHT_PX,
	);
	element.style.height = `${nextHeight}px`;
	element.style.overflowY =
		element.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
}

function CodexModelSelector({
	models,
	value,
	disabled,
	onChange,
	variant,
}: {
	models: RpcCodexModelOption[];
	value: string;
	disabled: boolean;
	onChange: (value: string) => void;
	variant: "desktop" | "mobile";
}): JSX.Element {
	const groupedModels = groupCodexModels(models);
	const activeModel = findCodexModel(models, value);
	const [open, setOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const rootRef = useRef<HTMLDivElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const buttonLabel = activeModel
		? codexModelLabel(activeModel)
		: models.length === 0
			? "Loading models"
			: "Select model";
	const normalizedSearchQuery = normalizeSearchQuery(searchQuery);
	const filteredGroups = useMemo(
		() =>
			groupedModels
				.map((group) => ({
					...group,
					models: group.models.filter((model) =>
						matchesSearchQuery(
							normalizedSearchQuery,
							model.id,
							model.label,
							model.summary,
							model.group,
						),
					),
				}))
				.filter((group) => group.models.length > 0),
		[groupedModels, normalizedSearchQuery],
	);

	useEffect(() => {
		if (disabled && open) {
			setOpen(false);
		}
	}, [disabled, open]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	useEffect(() => {
		if (!open) {
			setSearchQuery("");
			return;
		}
		searchInputRef.current?.focus();
	}, [open]);

	return (
		<div
			ref={rootRef}
			className="relative"
			title={activeModel?.summary ?? `${APP_TITLE} model`}
		>
			<button
				type="button"
				className={`flex w-full items-center overflow-hidden border text-left transition-colors ${
					variant === "desktop"
						? "h-7 gap-1 rounded-sm border-[#3a3a44] bg-[#131313] px-2.5 hover:bg-[#191c1f]"
						: "h-10 gap-2 rounded-xl border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
				} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${
					open
						? "border-[#9fc1da] shadow-[0_0_0_1px_rgba(159,193,218,0.18)]"
						: ""
				}`}
				onClick={() => {
					if (!disabled) {
						setOpen((current) => !current);
					}
				}}
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="menu"
			>
				<span className="min-w-0 flex-1">
					<span
						className={`block truncate font-label font-bold uppercase text-[#f2f0ef] ${
							variant === "desktop"
								? "text-[10px] leading-none tracking-wider"
								: "text-[10px] leading-none tracking-widest"
						}`}
					>
						{buttonLabel}
					</span>
				</span>
				<span
					className={`shrink-0 text-[#8f8d8b] ${
						variant === "desktop"
							? "leading-none"
							: "flex h-4 items-center leading-none"
					}`}
				>
					{materialSymbol(
						open ? "expand_less" : "expand_more",
						variant === "desktop" ? "text-[13px]" : "text-[16px]",
					)}
				</span>
			</button>
			{open ? (
				<div
					className={`absolute left-0 right-0 bottom-[calc(100%+0.5rem)] overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
						variant === "desktop"
							? "z-40 rounded-md border-[#3c4c58] bg-[#15191b]"
							: "z-50 rounded-2xl border-[#445058] bg-[#171b1d]"
					}`}
				>
					<div className="border-b border-[#3c4c58] px-2 py-2">
						<div className="flex items-center gap-2.5 rounded-md border border-[#3c4c58] bg-[#111213] px-3 py-2">
							{materialSymbol("search", "text-[15px] text-[#98b9d0]")}
							<input
								ref={searchInputRef}
								className="min-w-0 flex-1 bg-transparent text-[11px] text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
								placeholder="Search models"
								value={searchQuery}
								onChange={(event) => {
									setSearchQuery(event.currentTarget.value);
								}}
								onKeyDown={(event) => {
									event.stopPropagation();
								}}
								autoCapitalize="none"
								autoCorrect="off"
								spellCheck={false}
							/>
							{searchQuery ? (
								<button
									type="button"
									className="flex h-5 w-5 items-center justify-center rounded-sm text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
									onClick={() => {
										setSearchQuery("");
										searchInputRef.current?.focus();
									}}
									aria-label="Clear model search"
								>
									×
								</button>
							) : null}
						</div>
					</div>
					<div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
						{filteredGroups.length === 0 ? (
							<div className="px-4 py-4 text-xs text-[#8f9aa2]">
								No matching models.
							</div>
						) : null}
						{filteredGroups.map((group) => (
							<div key={group.group} className="px-2 pb-2 last:pb-0">
								<div className="px-2 pb-1 pt-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
									{group.group}
								</div>
								<div>
									{group.models.map((model) => {
										const selected = model.id === value;
										return (
											<button
												key={model.id}
												type="button"
												className={`flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors ${
													selected
														? "bg-[#28353e] text-[#f8fafc]"
														: "text-[#ebf3f8] hover:bg-[#1e2428]"
												}`}
												onClick={() => {
													setOpen(false);
													if (model.id !== value) {
														onChange(model.id);
													}
												}}
											>
												<span
													className={`mt-0.5 shrink-0 ${
														selected ? "text-[#bdd5e6]" : "text-[#5e676e]"
													}`}
												>
													{materialSymbol(
														selected
															? "check_circle"
															: "radio_button_unchecked",
														"text-[16px]",
													)}
												</span>
												<span className="min-w-0 flex-1">
													<span className="block font-label text-[10px] font-bold uppercase tracking-wider text-inherit">
														{codexModelLabel(model)}
													</span>
													<span
														className={`mt-1 block text-[11px] leading-4 ${
															selected ? "text-[#d5e4ef]" : "text-[#a7b7c2]"
														}`}
													>
														{model.summary}
													</span>
												</span>
											</button>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}
		</div>
	);
}

function ProjectTaskSelector({
	tasks,
	loading,
	disabled,
	onSelect,
	variant,
}: {
	tasks: RpcProjectTask[];
	loading: boolean;
	disabled: boolean;
	onSelect: (task: RpcProjectTask) => void;
	variant: "desktop" | "mobile";
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);
	const noTasksAvailable = !loading && tasks.length === 0;
	const unavailable = disabled || noTasksAvailable;
	const buttonLabel = loading
		? "Loading Tasks"
		: tasks.length > 0
			? `Tasks (${tasks.length})`
			: "Tasks";

	const taskMetaText = (task: RpcProjectTask): string | null => {
		if (task.kind === "script") {
			return task.command?.trim()
				? `${task.path} · ${task.command}`
				: task.path;
		}
		return task.path !== task.title ? task.path : null;
	};

	useEffect(() => {
		if (unavailable && open) {
			setOpen(false);
		}
	}, [open, unavailable]);

	useEffect(() => {
		if (!open) {
			return;
		}

		const handlePointerDown = (event: MouseEvent) => {
			if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
				setOpen(false);
			}
		};

		const handleKeyDown = (event: globalThis.KeyboardEvent) => {
			if (event.key === "Escape") {
				setOpen(false);
			}
		};

		document.addEventListener("mousedown", handlePointerDown);
		document.addEventListener("keydown", handleKeyDown);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown);
			document.removeEventListener("keydown", handleKeyDown);
		};
	}, [open]);

	return (
		<div
			ref={rootRef}
			className={noTasksAvailable ? "group relative" : "relative"}
		>
			<button
				type="button"
				className={`flex items-center gap-2 transition-colors ${
					variant === "desktop"
						? unavailable
							? "h-7 gap-1.5 rounded-sm bg-[#191a1a] px-2.5"
							: "h-7 gap-1.5 rounded-sm bg-[#191a1a] px-2.5 hover:bg-[#262626]"
						: unavailable
							? "h-10 rounded-xl border border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
							: "h-10 rounded-xl border border-[#424e57] bg-[#1d2022] px-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#262b2f]"
				} ${unavailable ? "cursor-not-allowed opacity-60" : ""}`}
				onClick={() => {
					if (!unavailable) {
						setOpen((current) => !current);
					}
				}}
				disabled={disabled}
				aria-disabled={unavailable}
				aria-expanded={open}
				aria-haspopup="menu"
			>
				{materialSymbol(
					"checklist",
					variant === "desktop"
						? "text-[#bdd5e6] text-[16px]"
						: "text-on-surface-variant text-sm",
				)}
				<span
					className={`font-label uppercase ${
						variant === "desktop"
							? "text-[10px] font-bold leading-none text-[#f2f0ef]"
							: "text-[10px] leading-none tracking-widest text-[#f2f0ef]"
					}`}
				>
					{buttonLabel}
				</span>
			</button>
			{noTasksAvailable ? (
				<div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 -translate-x-1/2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
					<div className="whitespace-nowrap rounded-md border border-[#3c4c58] bg-[#15191b] px-3 py-2 text-xs text-[#dfebf3] shadow-[0_18px_38px_rgba(0,0,0,0.42)]">
						No tasks found.
					</div>
				</div>
			) : null}
			{open ? (
				<div
					className={`absolute bottom-[calc(100%+0.5rem)] z-40 overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
						variant === "desktop"
							? "left-0 min-w-[18rem] rounded-md border-[#3c4c58] bg-[#15191b]"
							: "right-0 w-[calc(100vw-2rem)] max-w-[18rem] rounded-2xl border-[#445058] bg-[#171b1d]"
					}`}
				>
					<div className="border-b border-[#3c4c58] px-3 py-2 font-label text-[9px] uppercase tracking-[0.18em] text-[#92a7b6]">
						Project Tasks
					</div>
					<div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
						{loading ? (
							<div className="px-4 py-4 text-xs text-[#8f9aa2]">
								Loading tasks...
							</div>
						) : tasks.length === 0 ? (
							<div className="px-4 py-4 text-xs text-[#8f9aa2]">
								No project tasks found.
							</div>
						) : (
							tasks.map((task) => (
								<button
									key={task.id}
									type="button"
									className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[#1e2428]"
									onClick={() => {
										setOpen(false);
										onSelect(task);
									}}
								>
									<span className="mt-0.5 shrink-0 text-[#bdd5e6]">
										{materialSymbol(
											task.kind === "script" ? "terminal" : "task_alt",
											"text-[16px]",
										)}
									</span>
									<span className="min-w-0 flex-1">
										<span className="block truncate font-label text-[10px] font-bold uppercase tracking-wider text-[#f2f0ef]">
											{task.title}
										</span>
										{taskMetaText(task) ? (
											<span className="mt-1 block truncate text-[11px] leading-4 text-[#a7b7c2]">
												{taskMetaText(task)}
											</span>
										) : null}
									</span>
								</button>
							))
						)}
					</div>
				</div>
			) : null}
		</div>
	);
}

function threadRunStatus(thread: RpcThread | null): RpcThreadRunStatus {
	return (
		thread?.runStatus ?? {
			state: "idle",
			startedAt: null,
			updatedAt: null,
			error: null,
			hasUnreadError: false,
		}
	);
}

function threadErrorLevel(thread: RpcThread): ThreadErrorLevel {
	if (thread.runStatus.hasUnreadError) {
		return "unread";
	}
	if (thread.runStatus.state === "failed") {
		return "failed";
	}
	return "none";
}

function mergeThreadErrorLevel(
	current: ThreadErrorLevel,
	next: ThreadErrorLevel,
): ThreadErrorLevel {
	if (current === "unread" || next === "unread") {
		return "unread";
	}
	if (current === "failed" || next === "failed") {
		return "failed";
	}
	return "none";
}

function threadErrorLevelWeight(level: ThreadErrorLevel): number {
	if (level === "unread") {
		return 2;
	}
	if (level === "failed") {
		return 1;
	}
	return 0;
}

function isAssistantVisibleMessage(message: VisibleMessage): boolean {
	return message.kind !== "chat" || message.speaker === "assistant";
}

function isPlainAssistantTextMessage(message: VisibleMessage): boolean {
	return (
		message.kind === "chat" &&
		message.speaker === "assistant" &&
		message.tone !== "working" &&
		message.tone !== "error"
	);
}

function threadErrorPreview(thread: RpcThread): ThreadErrorPreview | null {
	const level = threadErrorLevel(thread);
	const text = thread.runStatus.error?.trim() ?? "";
	if (level === "none" || !text) {
		return null;
	}
	return {
		level,
		text,
		updatedAt: thread.runStatus.updatedAt ?? thread.updatedAt,
	};
}

function pickPreferredThreadErrorPreview(
	current: ThreadErrorPreview | undefined,
	next: ThreadErrorPreview,
): ThreadErrorPreview {
	if (!current) {
		return next;
	}
	const currentWeight = threadErrorLevelWeight(current.level);
	const nextWeight = threadErrorLevelWeight(next.level);
	if (nextWeight > currentWeight) {
		return next;
	}
	if (nextWeight < currentWeight) {
		return current;
	}
	return next.updatedAt >= current.updatedAt ? next : current;
}

function ProcessingMessage(): JSX.Element {
	return (
		<div className="flex w-full min-w-0 items-center gap-3 rounded-sm border border-[#2e3a42] bg-[#181e23] px-3 py-3 text-[#dfebf3]">
			<BeatLoader color="#bdd5e6" margin={2} size={6} speedMultiplier={0.85} />
			<span className="font-label text-[11px] uppercase tracking-[0.16em] text-[#d0e1ed]">
				Processing
			</span>
		</div>
	);
}

function ChatErrorMessage({ text }: { text: string }): JSX.Element {
	return (
		<div className="w-full min-w-0 rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-sm text-[#ff9db0]">
			<MarkdownMessage text={text} />
		</div>
	);
}

function parseUnifiedDiff(diffText: string): DiffLine[] {
	const normalized = diffText.replace(/\r/g, "");
	if (!normalized.trim()) {
		return [
			{
				kind: "meta",
				key: "meta:no-diff",
				text: "No diff preview available.",
			},
		];
	}

	const rawLines = normalized.endsWith("\n")
		? normalized.slice(0, -1).split("\n")
		: normalized.split("\n");
	return rawLines.map((line, index): DiffLine => {
		if (
			line.startsWith("diff --git ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ")
		) {
			return {
				kind: "file",
				key: `file:${index}`,
				text: line,
			};
		}
		if (line.startsWith("@@")) {
			return {
				kind: "hunk",
				key: `hunk:${index}`,
				text: line,
			};
		}
		if (line.startsWith("+")) {
			return {
				kind: "add",
				key: `add:${index}`,
				text: line,
			};
		}
		if (line.startsWith("-")) {
			return {
				kind: "remove",
				key: `remove:${index}`,
				text: line,
			};
		}
		if (line.startsWith("\\")) {
			return {
				kind: "meta",
				key: `meta:${index}`,
				text: line,
			};
		}
		return {
			kind: "context",
			key: `context:${index}`,
			text: line,
		};
	});
}

function commandStateLabel(
	state: "in_progress" | "completed" | "failed",
	exitCode: number | null,
): string {
	if (exitCode !== null) {
		return `Exit (${exitCode})`;
	}
	if (state === "failed") {
		return "Failed";
	}
	if (state === "completed") {
		return "Completed";
	}
	return "Running";
}

function DiffViewer({
	diffText,
	className = "",
}: {
	diffText: string;
	className?: string;
}): JSX.Element {
	const deferredDiffText = useDeferredValue(diffText);
	const [scrollTop, setScrollTop] = useState(0);
	const lines = useMemo(
		() => parseUnifiedDiff(deferredDiffText),
		[deferredDiffText],
	);
	const visibleLines = useMemo(() => {
		const totalLines = lines.length;
		const windowSize = Math.min(
			totalLines,
			Math.max(DIFF_VIEWER_RENDER_OVERSCAN_ROWS * 2, 160),
		);
		const maxStartIndex = Math.max(0, totalLines - windowSize);
		const startIndex = clampNumber(
			Math.floor(scrollTop / DIFF_VIEWER_ROW_HEIGHT_PX) -
				DIFF_VIEWER_RENDER_OVERSCAN_ROWS,
			0,
			maxStartIndex,
		);
		const endIndex = Math.min(totalLines, startIndex + windowSize);
		return {
			entries: lines.slice(startIndex, endIndex),
			topSpacerHeight: startIndex * DIFF_VIEWER_ROW_HEIGHT_PX,
			bottomSpacerHeight: Math.max(
				0,
				(totalLines - endIndex) * DIFF_VIEWER_ROW_HEIGHT_PX,
			),
		};
	}, [lines, scrollTop]);
	const isRenderingDeferred = deferredDiffText !== diffText;

	return (
		<div
			className={`app-scrollbar min-h-0 overflow-auto overscroll-contain border-t border-[#2b343b] bg-[#0c1018] font-mono text-[12px] leading-5 ${className}`.trim()}
			style={{ WebkitOverflowScrolling: "touch" }}
			onScroll={(event) => {
				setScrollTop(event.currentTarget.scrollTop);
			}}
		>
			{isRenderingDeferred ? (
				<div className="sticky top-0 z-10 border-b border-[#2b343b] bg-[#12171b]/95 px-3 py-1.5 text-[11px] text-[#9aa9b5] backdrop-blur-sm">
					Rendering diff...
				</div>
			) : null}
			<div style={{ paddingTop: visibleLines.topSpacerHeight }}>
				{visibleLines.entries.map((line) => (
					<div
						key={line.key}
						className={`min-w-fit whitespace-pre px-3 py-0.5 ${
							line.kind === "add"
								? "bg-[#10261d] text-[#80f2c5]"
								: line.kind === "remove"
									? "bg-[#31141b] text-[#ff9bb0]"
									: line.kind === "hunk"
										? "bg-[#1d272e] text-[#b8cede]"
										: line.kind === "file"
											? "bg-[#161e23] text-[#8cc5ff]"
											: line.kind === "meta"
												? "bg-[#12171b] text-[#8798a5]"
												: "text-[#d9dcde]"
						}`}
						style={{ height: `${DIFF_VIEWER_ROW_HEIGHT_PX}px` }}
					>
						{line.text || " "}
					</div>
				))}
			</div>
			{visibleLines.bottomSpacerHeight > 0 ? (
				<div style={{ height: `${visibleLines.bottomSpacerHeight}px` }} />
			) : null}
		</div>
	);
}

function CommandExecutionMessage({
	command,
	exitCode,
	output,
	state,
}: {
	command: string;
	exitCode: number | null;
	output: string;
	state: "in_progress" | "completed" | "failed";
}): JSX.Element {
	return (
		<details className="w-full min-w-0 overflow-hidden rounded-sm border border-[#2f3b43] bg-[#141a1e] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
			<summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
				<div className="min-w-0">
					<div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#bdd5e6]">
						Command
					</div>
					<div className="truncate font-mono text-[12px] text-[#f2f0ef]">
						{command}
					</div>
				</div>
				<span
					className={`shrink-0 rounded-full px-2 py-0.5 font-label text-[9px] tracking-[0.16em] ${
						state === "failed" || (exitCode !== null && exitCode !== 0)
							? "border border-[#7a2030] bg-[#381018] text-[#ff8698]"
							: state === "completed" || exitCode === 0
								? "border border-[#284240] bg-[#102522] text-[#74f0c0]"
								: "border border-[#42515b] bg-[#202a31] text-[#d4e4ef]"
					}`}
				>
					{commandStateLabel(state, exitCode)}
				</span>
			</summary>
			<div className="border-t border-[#2b343b] bg-[#0f1316] px-3 py-3">
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-[#212a31] bg-[#0b0f11] px-3 py-3 font-mono text-[12px] leading-5 text-[#d7e1e8]">
					{output || "(No output yet.)"}
				</pre>
			</div>
		</details>
	);
}

function ReasoningMessage({
	state,
	text,
}: {
	state: "in_progress" | "completed";
	text: string;
}): JSX.Element {
	return (
		<div className="w-full min-w-0 rounded-sm border border-[#2f3b43] bg-[#141a1e] px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#bdd5e6]">
					Reasoning
				</div>
				<span className="rounded-full border border-[#37444e] bg-[#1b2328] px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-[#d4e4ef]">
					{state === "completed" ? "Ready" : "Thinking"}
				</span>
			</div>
			<div className="text-sm leading-relaxed text-[#dbe4eb]">
				<MarkdownMessage text={text} />
			</div>
		</div>
	);
}

function FileChangeMessage({
	changeKind,
	diffText,
	path,
	state,
	worktreePath,
}: {
	changeKind: "add" | "delete" | "update";
	diffText: string;
	path: string;
	state: "completed" | "failed";
	worktreePath?: string | undefined;
}): JSX.Element {
	const fileHref = buildLocalFileHref(path, worktreePath);
	return (
		<details className="w-full min-w-0 overflow-hidden rounded-sm border border-[#2f3b43] bg-[#141a1e] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
			<summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
				<div className="min-w-0 text-sm">
					<span className="font-label text-[10px] uppercase tracking-[0.16em] text-[#bdd5e6]">
						File Change
					</span>
					<span className="px-1 text-[#8494a0]">-</span>
					<a
						className="font-mono text-[12px] text-[#c7dbea] underline decoration-[#7aa5c4] underline-offset-2"
						href={fileHref}
						onClick={(event) => event.stopPropagation()}
						rel="noreferrer"
						target="_blank"
						title={path}
					>
						{path}
					</a>
				</div>
			</summary>
			<DiffViewer diffText={diffText} className="max-h-[28rem]" />
		</details>
	);
}

function isAbsoluteLocalPath(value: string): boolean {
	return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function joinLocalPath(basePath: string, nextPath: string): string {
	const normalizedBase = basePath.replace(/\\/g, "/").replace(/\/+$/, "");
	const normalizedNext = nextPath.replace(/\\/g, "/").replace(/^\.?\//, "");
	return `${normalizedBase}/${normalizedNext}`;
}

function toFileHref(path: string): string {
	const normalizedPath = path.replace(/\\/g, "/");
	if (/^[A-Za-z]:\//.test(normalizedPath)) {
		return `file:///${encodeURI(normalizedPath)}`;
	}
	return `file://${encodeURI(normalizedPath)}`;
}

function buildLocalFileHref(path: string, worktreePath?: string): string {
	const absolutePath =
		isAbsoluteLocalPath(path) || !worktreePath
			? path
			: joinLocalPath(worktreePath, path);
	return toFileHref(absolutePath);
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

function formatGitHistoryTimestamp(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	}).format(date);
}

function GitHistoryDiffModal({
	state,
	onClose,
}: {
	state: GitHistoryModalState;
	onClose: () => void;
}): JSX.Element {
	return (
		<div className="fixed inset-0 z-[120]">
			<button
				type="button"
				className="absolute inset-0 bg-[#06080a]/84 backdrop-blur-sm"
				onClick={onClose}
				aria-label="Close git diff"
			/>
			<div className="pointer-events-none absolute inset-0 flex items-stretch justify-center p-3 md:items-center md:p-6">
				<div className="pointer-events-auto relative flex h-full min-h-0 w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[#283239] bg-[#0c1018] shadow-[0_24px_56px_rgba(0,0,0,0.56)] md:h-[88vh] md:max-h-[56rem]">
					<div className="flex items-start justify-between gap-4 border-b border-[#2b343b] bg-[#131a1f] px-4 py-4 md:px-6">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<span className="rounded-full border border-[#43505a] bg-[#1b2328] px-2 py-0.5 font-mono text-[10px] text-[#bdd5e6]">
									{state.entry.shortHash}
								</span>
								<span className="font-label text-[10px] uppercase tracking-[0.16em] text-[#96a7b4]">
									{state.entry.authorName} ·{" "}
									{formatGitHistoryTimestamp(state.entry.committedAt)}
								</span>
							</div>
							<h2 className="mt-2 truncate text-base font-semibold text-[#f2f0ef] md:text-lg">
								{state.entry.subject}
							</h2>
						</div>
						<button
							type="button"
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#3b4750] bg-[#182026] text-[#dfebf3] transition-colors hover:bg-[#212a31]"
							onClick={onClose}
							aria-label="Close git diff"
						>
							×
						</button>
					</div>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{state.loading ? (
							<div className="flex h-full items-center justify-center px-6 py-10">
								<div className="flex items-center gap-3 rounded-full border border-[#36454f] bg-[#182026] px-4 py-3 text-sm text-[#dfebf3]">
									<BeatLoader
										color="#bdd5e6"
										margin={2}
										size={6}
										speedMultiplier={0.85}
									/>
									<span>Loading commit diff...</span>
								</div>
							</div>
						) : state.error ? (
							<div className="px-6 py-6 text-sm text-[#ff9db0]">
								{state.error}
							</div>
						) : (
							<DiffViewer
								key={state.entry.hash}
								diffText={state.diffText}
								className="flex-1"
							/>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function SidebarSectionHeader({
	title,
	open,
	onToggle,
	action,
}: {
	title: ReactNode;
	open: boolean;
	onToggle: () => void;
	action?: JSX.Element | null;
}): JSX.Element {
	return (
		<div className="flex items-center gap-3">
			<button
				type="button"
				className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-[#1b1f22]"
				onClick={onToggle}
				aria-expanded={open}
			>
				<span className="shrink-0 text-[#c7dbea]">
					{materialSymbol(
						open ? "expand_more" : "chevron_right",
						"text-[18px]",
					)}
				</span>
				<span className="font-label text-[13px] font-bold uppercase tracking-[0.18em] text-[#f5f9fb]">
					{title}
				</span>
			</button>
			{action ?? null}
		</div>
	);
}

function sortThreads(items: RpcThread[]): RpcThread[] {
	return [...items].sort((left, right) => {
		const leftPinnedAt = left.pinnedAt ?? "";
		const rightPinnedAt = right.pinnedAt ?? "";
		if (leftPinnedAt || rightPinnedAt) {
			if (!leftPinnedAt) {
				return 1;
			}
			if (!rightPinnedAt) {
				return -1;
			}
			if (leftPinnedAt !== rightPinnedAt) {
				return rightPinnedAt.localeCompare(leftPinnedAt);
			}
		}
		if (left.updatedAt !== right.updatedAt) {
			return right.updatedAt.localeCompare(left.updatedAt);
		}
		if (left.createdAt !== right.createdAt) {
			return right.createdAt.localeCompare(left.createdAt);
		}
		return right.id - left.id;
	});
}

function compareThreadsByRecency(left: RpcThread, right: RpcThread): number {
	if (left.updatedAt !== right.updatedAt) {
		return right.updatedAt.localeCompare(left.updatedAt);
	}
	if (left.createdAt !== right.createdAt) {
		return right.createdAt.localeCompare(left.createdAt);
	}
	return right.id - left.id;
}

function latestThreadForWorktree(
	items: RpcThread[],
	projectId: number,
	worktreePath: string,
): RpcThread | null {
	const matches = items
		.filter(
			(thread) =>
				thread.projectId === projectId && thread.worktreePath === worktreePath,
		)
		.sort(compareThreadsByRecency);
	return matches[0] ?? null;
}

function serializeOpenWorktrees(
	projectStates: ProjectStateMap,
): PersistedOpenWorktree[] {
	return Object.entries(projectStates).flatMap(([projectId, state]) =>
		[...state.openWorktrees].map((worktreePath) => ({
			projectId: Number.parseInt(projectId, 10),
			worktreePath,
		})),
	);
}

function pickInitialThread(
	threads: RpcThread[],
	persistedState: PersistedMainviewState,
): RpcThread | null {
	if (persistedState.selectedThreadId !== null) {
		const selectedThread =
			threads.find((thread) => thread.id === persistedState.selectedThreadId) ??
			null;
		if (selectedThread) {
			return selectedThread;
		}
	}

	if (
		persistedState.selectedProjectId !== null &&
		persistedState.selectedWorktreePath
	) {
		const selectedWorktreeThread = latestThreadForWorktree(
			threads,
			persistedState.selectedProjectId,
			persistedState.selectedWorktreePath,
		);
		if (selectedWorktreeThread) {
			return selectedWorktreeThread;
		}
	}

	return threads[0] ?? null;
}

function upsertThreadList(items: RpcThread[], thread: RpcThread): RpcThread[] {
	const next = items.filter((entry) => entry.id !== thread.id);
	next.push(thread);
	return sortThreads(next);
}

function removeThreadFromList(
	items: RpcThread[],
	threadId: number,
): RpcThread[] {
	return items.filter((entry) => entry.id !== threadId);
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
	const [defaultCodexModel, setDefaultCodexModel] = useState("");
	const [pendingThreadModel, setPendingThreadModel] = useState(
		initialMainviewState.pendingThreadModel,
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
	const [errorPreviewPopover, setErrorPreviewPopover] =
		useState<ErrorPreviewPopoverState | null>(null);
	const [sessionStateReady, setSessionStateReady] = useState(false);
	const [gitHistoryScrollTop, setGitHistoryScrollTop] = useState(0);
	const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
	const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
	const desktopComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const mobileComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const gitHistoryListRef = useRef<HTMLDivElement | null>(null);
	const projectActionMenuRequestId = useRef(0);
	const projectTasksRequestIdRef = useRef(0);
	const gitHistoryRequestIdRef = useRef(0);
	const gitHistoryDiffRequestIdRef = useRef(0);
	const gitHistoryLoadingMoreRef = useRef(false);
	const projectWorktreeRequestCacheRef = useRef(
		new Map<number, Promise<RpcWorktree[]>>(),
	);
	const gitHistoryDiffCacheRef = useRef(
		new Map<string, { commit: RpcGitHistoryEntry; diffText: string }>(),
	);
	const gitHistoryCacheRef = useRef(
		new Map<string, RpcWorktreeGitHistoryResult>(),
	);
	const directorySuggestionPrefetchTimerRef = useRef<number | null>(null);
	const directorySuggestionResultCacheRef = useRef(
		new Map<string, DirectorySuggestionResultCacheEntry>(),
	);
	const directorySuggestionRequestCacheRef = useRef(
		new Map<string, Promise<string[]>>(),
	);
	const prefetchedDirectorySuggestionQueriesRef = useRef(new Set<string>());
	const homeDirectoryPrefetchQueryRef = useRef<string | null>(null);
	const selectedThreadIdRef = useRef<number | null>(null);
	const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");
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

	const projectThreadErrorLevels = useMemo(() => {
		const next = new Map<number, ThreadErrorLevel>();
		for (const thread of threads) {
			const level = threadErrorLevel(thread);
			if (level === "none") {
				continue;
			}
			next.set(
				thread.projectId,
				mergeThreadErrorLevel(next.get(thread.projectId) ?? "none", level),
			);
		}
		return next;
	}, [threads]);

	const projectThreadErrorPreviews = useMemo(() => {
		const next = new Map<number, ThreadErrorPreview>();
		for (const thread of threads) {
			const preview = threadErrorPreview(thread);
			if (!preview) {
				continue;
			}
			next.set(
				thread.projectId,
				pickPreferredThreadErrorPreview(next.get(thread.projectId), preview),
			);
		}
		return next;
	}, [threads]);

	const worktreeThreadErrorLevels = useMemo(() => {
		const next = new Map<string, ThreadErrorLevel>();
		for (const thread of threads) {
			const level = threadErrorLevel(thread);
			if (level === "none") {
				continue;
			}
			const key = worktreeKey(thread.projectId, thread.worktreePath);
			next.set(key, mergeThreadErrorLevel(next.get(key) ?? "none", level));
		}
		return next;
	}, [threads]);

	const worktreeThreadErrorPreviews = useMemo(() => {
		const next = new Map<string, ThreadErrorPreview>();
		for (const thread of threads) {
			const preview = threadErrorPreview(thread);
			if (!preview) {
				continue;
			}
			const key = worktreeKey(thread.projectId, thread.worktreePath);
			next.set(key, pickPreferredThreadErrorPreview(next.get(key), preview));
		}
		return next;
	}, [threads]);

	const selectedThreadIsWorking = selectedThreadRunStatus.state === "working";
	const modelSelectorDisabled =
		codexModels.length === 0 ||
		isCreatingThread ||
		isThreadLoading ||
		isSending ||
		isUpdatingThreadModel ||
		selectedThreadIsWorking;

	const selectedThreadRunError =
		selectedThreadRunStatus.state === "failed"
			? (selectedThreadRunStatus.error ?? "")
			: "";

	const activeChatError = chatError || selectedThreadRunError;

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

	const closeGitHistoryModal = useCallback(() => {
		setGitHistoryModal(null);
	}, []);

	const openGitHistoryDiff = useCallback(
		async (entry: RpcGitHistoryEntry) => {
			if (!selectedProject || !activeSelectedWorktreePath) {
				return;
			}

			const projectId = selectedProject.id;
			const worktreePath = activeSelectedWorktreePath;
			const cacheKey = `${projectId}::${worktreePath}::${entry.hash}`;
			const cached = gitHistoryDiffCacheRef.current.get(cacheKey);

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

			const requestId = ++gitHistoryDiffRequestIdRef.current;
			try {
				const result = await procedures.getWorktreeGitCommitDiff({
					projectId,
					worktreePath,
					commitHash: entry.hash,
				});
				if (gitHistoryDiffRequestIdRef.current !== requestId) {
					return;
				}

				writeLruValue(
					gitHistoryDiffCacheRef.current,
					cacheKey,
					{
						commit: result.commit,
						diffText: result.diffText,
					},
					GIT_HISTORY_DIFF_CACHE_MAX_ENTRIES,
				);
				startTransition(() => {
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
				});
			} catch (error) {
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
			}
		},
		[activeSelectedWorktreePath, procedures, selectedProject],
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

	const projectThreadErrorPreviewText = useCallback(
		(projectId: number): string =>
			projectThreadErrorPreviews.get(projectId)?.text ?? "",
		[projectThreadErrorPreviews],
	);

	const worktreeThreadErrorPreviewText = useCallback(
		(projectId: number, worktreePath: string): string =>
			worktreeThreadErrorPreviews.get(worktreeKey(projectId, worktreePath))
				?.text ?? "",
		[worktreeThreadErrorPreviews],
	);

	const showErrorPreview = useCallback(
		(event: ReactMouseEvent<HTMLElement>, text: string): void => {
			const previewText = text.trim();
			if (!previewText) {
				setErrorPreviewPopover(null);
				return;
			}
			const viewportWidth =
				typeof window === "undefined" ? 1280 : window.innerWidth;
			const viewportHeight =
				typeof window === "undefined" ? 720 : window.innerHeight;
			setErrorPreviewPopover({
				text: previewText,
				x: clampProjectMenuCoordinate(event.clientX + 18, viewportWidth, 368),
				y: clampProjectMenuCoordinate(event.clientY + 18, viewportHeight, 196),
			});
		},
		[],
	);

	const hideErrorPreview = useCallback((): void => {
		setErrorPreviewPopover(null);
	}, []);

	const errorPreviewHandlers = useCallback(
		(
			text: string | null | undefined,
		): Pick<
			HTMLAttributes<HTMLElement>,
			"onMouseEnter" | "onMouseMove" | "onMouseLeave"
		> => {
			const previewText = text?.trim();
			if (!previewText) {
				return {};
			}
			return {
				onMouseEnter: (event) => {
					showErrorPreview(event as ReactMouseEvent<HTMLElement>, previewText);
				},
				onMouseMove: (event) => {
					showErrorPreview(event as ReactMouseEvent<HTMLElement>, previewText);
				},
				onMouseLeave: () => {
					hideErrorPreview();
				},
			};
		},
		[hideErrorPreview, showErrorPreview],
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

	const clearThreadSelection = useCallback(() => {
		setSelectedThreadId(null);
		setThreadMessages([]);
		setChatError("");
		setModelControlError("");
		selectedThreadIdRef.current = null;
		selectedThreadRunStateRef.current = "idle";
	}, []);

	const syncThreadContext = useCallback((thread: RpcThread) => {
		setSelectedProjectId(thread.projectId);
		setSelectedWorktreePath(thread.worktreePath);
	}, []);

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

	const loadProjectTasks = useCallback(
		async (projectId: number, worktreePath: string): Promise<void> => {
			const requestId = ++projectTasksRequestIdRef.current;
			setIsLoadingProjectTasks(true);
			setTaskControlError("");

			try {
				const tasks = await procedures.listProjectTasks({
					projectId,
					worktreePath,
				});
				if (projectTasksRequestIdRef.current !== requestId) {
					return;
				}
				setProjectTasks(tasks);
			} catch (error) {
				if (projectTasksRequestIdRef.current !== requestId) {
					return;
				}
				setProjectTasks([]);
				setTaskControlError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				if (projectTasksRequestIdRef.current === requestId) {
					setIsLoadingProjectTasks(false);
				}
			}
		},
		[procedures],
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
			const cacheKey = worktreeKey(projectId, worktreePath);
			const cachedHistory = readLruValue(gitHistoryCacheRef.current, cacheKey);
			if (options?.preferCached && cachedHistory) {
				setGitHistory(cachedHistory);
				setGitHistoryLoading(false);
				setGitHistoryLoadingMore(false);
				gitHistoryLoadingMoreRef.current = false;
				setGitHistoryError("");
				return;
			}
			if (!options?.silent) {
				setGitHistoryLoading(true);
				setGitHistoryError("");
			}
			const requestId = ++gitHistoryRequestIdRef.current;

			try {
				const result = await procedures.listWorktreeGitHistory({
					projectId,
					worktreePath,
					offset: 0,
					limit: GIT_HISTORY_PAGE_SIZE,
				});
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}

				const nextHistory = mergeResetGitHistory(cachedHistory, result);
				setGitHistory(nextHistory);
				cacheGitHistoryResult(nextHistory);
				setGitHistoryError("");
			} catch (error) {
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}
				if (!options?.silent && !cachedHistory) {
					setGitHistory(null);
					setGitHistoryError(
						error instanceof Error ? error.message : String(error),
					);
				}
			} finally {
				if (gitHistoryRequestIdRef.current === requestId) {
					setGitHistoryLoading(false);
					setGitHistoryLoadingMore(false);
					gitHistoryLoadingMoreRef.current = false;
				}
			}
		},
		[cacheGitHistoryResult, procedures],
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

		gitHistoryLoadingMoreRef.current = true;
		setGitHistoryLoadingMore(true);

		try {
			const result = await procedures.listWorktreeGitHistory({
				projectId: selectedProject.id,
				worktreePath: activeSelectedWorktreePath,
				offset: nextOffset,
				limit: GIT_HISTORY_PAGE_SIZE,
			});
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
			if (gitHistoryRequestIdRef.current !== requestId) {
				return;
			}
			setGitHistoryError(
				error instanceof Error ? error.message : String(error),
			);
		} finally {
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

	const refreshThreadStatuses = useCallback(async () => {
		const loadedThreads = sortThreads(await procedures.listThreads());
		const selectedSummary =
			selectedThreadId === null
				? null
				: (loadedThreads.find((thread) => thread.id === selectedThreadId) ??
					null);

		if (!selectedSummary) {
			selectedThreadRunStateRef.current = "idle";
			setThreads(loadedThreads);
			return;
		}

		const shouldRefreshSelectedDetail =
			selectedSummary.runStatus.state === "working" ||
			selectedThreadRunStateRef.current === "working" ||
			(selectedSummary.runStatus.state === "failed" &&
				selectedThreadRunStateRef.current !== "failed");

		if (!shouldRefreshSelectedDetail) {
			selectedThreadRunStateRef.current = selectedSummary.runStatus.state;
			setThreads(loadedThreads);
			return;
		}

		let detail = await procedures.getThread({
			threadId: selectedSummary.id,
		});
		if (selectedThreadIdRef.current !== selectedSummary.id) {
			setThreads(loadedThreads);
			return;
		}
		if (detail.thread.runStatus.hasUnreadError) {
			detail = await procedures.markThreadErrorSeen({
				threadId: selectedSummary.id,
			});
		}
		selectedThreadRunStateRef.current = detail.thread.runStatus.state;
		setThreads(upsertThreadList(loadedThreads, detail.thread));
		setThreadMessages(detail.messages);
	}, [procedures, selectedThreadId]);

	const applyOpenedThreadDetail = useCallback(
		async (detail: RpcThreadDetail) => {
			setThreads((prev) => upsertThreadList(prev, detail.thread));
			setSelectedThreadId(detail.thread.id);
			selectedThreadRunStateRef.current = detail.thread.runStatus.state;
			setThreadMessages(detail.messages);
			syncThreadContext(detail.thread);
			try {
				await loadProjectWorktrees(detail.thread.projectId);
			} catch {
				// Best effort; thread history should still open even if worktree metadata refresh fails.
			}
			setMobileProjectListOpen(false);
		},
		[loadProjectWorktrees, syncThreadContext],
	);

	const openThread = useCallback(
		async (
			threadId: number,
			options?: {
				acknowledgeUnreadError?: boolean;
			},
		) => {
			setIsThreadLoading(true);
			setThreadsError("");
			setChatError("");
			setModelControlError("");
			try {
				let detail = options?.acknowledgeUnreadError
					? await procedures.markThreadErrorSeen({ threadId })
					: await procedures.getThread({ threadId });
				if (
					!options?.acknowledgeUnreadError &&
					detail.thread.runStatus.hasUnreadError
				) {
					detail = await procedures.markThreadErrorSeen({ threadId });
				}
				await applyOpenedThreadDetail(detail);
			} catch (error) {
				setThreadsError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsThreadLoading(false);
			}
		},
		[applyOpenedThreadDetail, procedures],
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

	const fetchDirectorySuggestions = useCallback(
		async (
			query: string,
			options?: {
				forceRefresh?: boolean | undefined;
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
				return inFlight;
			}

			const request = procedures
				.listDirectorySuggestions({ query: normalizedQuery })
				.then((result) => {
					cacheDirectorySuggestions(normalizedQuery, result.directories);
					return result.directories;
				})
				.finally(() => {
					directorySuggestionRequestCacheRef.current.delete(normalizedQuery);
				});
			directorySuggestionRequestCacheRef.current.set(normalizedQuery, request);
			return request;
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
				await fetchDirectorySuggestions(normalizedQuery);
			} catch {
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

			setProjects(loaded);
			setThreads(sortedThreads);
			setCodexModels(modelCatalog.models);
			setDefaultCodexModel(modelCatalog.defaultModel);
			setPendingThreadModel((current) => current || modelCatalog.defaultModel);
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

			const initialThread = pickInitialThread(sortedThreads, persistedState);
			const initialThreadDetailPromise = initialThread
				? procedures
						.getThread({
							threadId: initialThread.id,
						})
						.catch(() => null)
				: null;

			const openProjects = loaded.filter((project) => project.isOpen === 1);
			const restoredOpenProjectIds = new Set(
				openProjects.map((project) => project.id),
			);
			const initiallyOpenProjectTreePaths = new Set(
				initialTreeViewState.openProjectPaths,
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
			const restoredProjectWorktrees = new Map<number, RpcWorktree[]>();
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
						const worktrees = await loadProjectWorktrees(project.id, {
							backgroundRefresh: true,
						});
						restoredProjectWorktrees.set(project.id, worktrees);
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
				try {
					let detail = initialThreadDetailPromise
						? await initialThreadDetailPromise
						: null;
					if (detail?.thread.runStatus.hasUnreadError) {
						detail = await procedures.markThreadErrorSeen({
							threadId: initialThread.id,
						});
					}
					if (detail) {
						await applyOpenedThreadDetail(detail);
						return;
					}
				} catch {
					// Fall through to the normal open-thread flow below.
				}

				await openThread(initialThread.id, {
					acknowledgeUnreadError: initialThread.runStatus.hasUnreadError,
				});
				return;
			}

			const initialProject =
				loaded.find(
					(project) => project.id === persistedState.selectedProjectId,
				) ??
				loaded[0] ??
				null;
			const initialWorktreePath =
				initialProject === null
					? null
					: initialProject.id === persistedState.selectedProjectId &&
							persistedState.selectedWorktreePath
						? persistedState.selectedWorktreePath
						: primaryWorktreePath(
								initialProject,
								restoredProjectWorktrees.get(initialProject.id) ?? [],
							);

			setSelectedProjectId(initialProject?.id ?? null);
			setSelectedWorktreePath(initialWorktreePath);
		} catch (error) {
			setThreadsError(error instanceof Error ? error.message : String(error));
		} finally {
			setSessionStateReady(true);
		}
	}, [
		applyOpenedThreadDetail,
		cacheGitHistoryResult,
		getProjectState,
		hydrateProjectRows,
		initialMainviewState,
		initialTreeViewState,
		loadProjectWorktrees,
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
				y: clampProjectMenuCoordinate(y, viewportHeight, 286),
			});
			setThreadActionMenuError("");
			setThreadRenameTitle(thread.title);
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
				setSelectedProjectId((current) => {
					if (current && loaded.some((project) => project.id === current)) {
						return current;
					}
					return loaded[0]?.id ?? null;
				});
				if (selectedProjectId === projectId) {
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
				});
				setThreads((prev) => upsertThreadList(prev, updatedThread));
				setThreadRenameTitle(updatedThread.title);
			} catch (error) {
				setThreadActionMenuError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				setThreadActionBusy(null);
			}
		},
		[procedures, threadActionBusy, threadActionMenuThread, threadRenameTitle],
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
		};

		window.addEventListener("resize", dismissErrorPreview);
		window.addEventListener("scroll", dismissErrorPreview, true);
		document.addEventListener("mousedown", dismissErrorPreview);
		return () => {
			window.removeEventListener("resize", dismissErrorPreview);
			window.removeEventListener("scroll", dismissErrorPreview, true);
			document.removeEventListener("mousedown", dismissErrorPreview);
		};
	}, [hideErrorPreview]);

	useEffect(() => {
		selectedThreadIdRef.current = selectedThreadId;
	}, [selectedThreadId]);

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
			chatInput,
			sidebarCollapsed,
			sidebarSearchQuery,
			openWorktrees: serializeOpenWorktrees(projectStates),
		});
	}, [
		chatInput,
		pendingThreadModel,
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
		if (
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened
		) {
			projectTasksRequestIdRef.current += 1;
			setProjectTasks([]);
			setIsLoadingProjectTasks(false);
			setTaskControlError("");
			return;
		}
		void loadProjectTasks(selectedProject.id, activeSelectedWorktreePath);
	}, [
		activeSelectedWorktreePath,
		activeSelectedWorktreeOpened,
		loadProjectTasks,
		selectedProject,
	]);

	useEffect(() => {
		if (
			!selectedProject ||
			!activeSelectedWorktreePath ||
			!activeSelectedWorktreeOpened
		) {
			gitHistoryRequestIdRef.current += 1;
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
		activeSelectedWorktreeOpened,
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
	}, [
		activeSelectedWorktreePath,
		activeSelectedWorktreeOpened,
		loadGitHistory,
		selectedProject,
	]);

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
			setGitHistoryModal(null);
		}
	}, [activeSelectedWorktreePath, gitHistoryModal, selectedProject]);

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
		const latestThread = latestThreadForWorktree(
			threads,
			selectedProjectId,
			activeSelectedWorktreePath,
		);
		if (!latestThread) {
			clearThreadSelection();
			return;
		}
		if (selectedThreadId === latestThread.id) {
			return;
		}
		void openThread(latestThread.id);
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
		if (threads.length === 0) {
			selectedThreadRunStateRef.current = "idle";
			return;
		}

		let cancelled = false;
		const poll = async () => {
			try {
				await refreshThreadStatuses();
			} catch (error) {
				if (!cancelled) {
					console.error("Failed to poll thread statuses", error);
				}
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
	}, [refreshThreadStatuses, threads.length]);

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
		if (!addProjectOpen) {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			setHoveredDirectorySuggestion(null);
			clearDirectorySuggestionPrefetchTimer();
			return;
		}

		const query = addProjectPath.trim();
		if (!query) {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(false);
			clearDirectorySuggestionPrefetchTimer();
			return;
		}

		const cached = readCachedDirectorySuggestions(query);
		let cancelled = false;
		if (cached) {
			setDirectorySuggestions(cached.directories);
			setDirectorySuggestionsLoading(cached.isStale);
		} else {
			setDirectorySuggestions([]);
			setDirectorySuggestionsLoading(true);
		}
		void (async () => {
			try {
				const directories = await fetchDirectorySuggestions(
					query,
					cached ? { forceRefresh: cached.isStale } : undefined,
				);
				if (!cancelled) {
					setDirectorySuggestions(directories);
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
	}, [
		addProjectOpen,
		addProjectPath,
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
			try {
				const detail = await procedures.runProjectTask({
					projectId: selectedProject.id,
					worktreePath: activeSelectedWorktreePath,
					task,
					threadId: selectedThread?.id ?? null,
					model: selectedThread
						? null
						: activeCodexModel || defaultCodexModel || null,
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
			activeSelectedWorktreePath,
			defaultCodexModel,
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

		setIsCreatingThread(true);
		setThreadsError("");
		setModelControlError("");
		setChatError("");
		try {
			const detail = await procedures.createThread({
				projectId: selectedProject.id,
				worktreePath: activeSelectedWorktreePath,
				model: activeCodexModel || defaultCodexModel || null,
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
				// Best effort; thread creation should still succeed even if the worktree refresh fails.
			}
		} catch (error) {
			setThreadsError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsCreatingThread(false);
		}
	}, [
		activeSelectedWorktreePath,
		activeCodexModel,
		defaultCodexModel,
		isCreatingThread,
		loadProjectWorktrees,
		procedures,
		selectedProject,
		syncThreadContext,
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
				const loaded = await procedures.listProjects({ includeClosed: true });
				const existingState = getProjectState(result.project.id);
				setProjects(loaded);
				hydrateProjectRows(loaded);
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
				} catch {
					// best effort
				}
				if (selectedProjectId === project.id) {
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
				cacheGitHistoryResult(result.history);
				setWorktreeState(projectId, worktreePath, {
					loading: false,
					opened: true,
					snapshot: result.worktree,
					error: "",
				});
				setProjectState(projectId, {
					loadingWorktrees: false,
					openWorktrees: new Set([...projectState.openWorktrees, worktreePath]),
				});
				setSelectedProjectId(projectId);
				setSelectedWorktreePath(worktreePath);
				setGitHistory(result.history);
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
			cacheGitHistoryResult,
			selectedWorktreePath,
			setProjectState,
			setWorktreeState,
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

	const onSubmit = useCallback(
		(event: FormEvent<HTMLFormElement>) => {
			event.preventDefault();
			postMessage();
		},
		[postMessage],
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
		return messages;
	}, [
		activeSelectedWorktreeFolder,
		activeChatError,
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
							const worktreeErrorPreviewText = worktreeThreadErrorPreviewText(
								projectActionMenuProject.id,
								worktree.path,
							);
							return (
								<div
									className="rounded-sm border border-[#252f36] bg-[#161c21] px-3 py-2"
									key={worktree.path}
									{...errorPreviewHandlers(worktreeErrorPreviewText)}
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
		<div className="px-1 pb-1 pt-2">
			<label className="block">
				<span className="sr-only">
					Search projects, threads, and git history
				</span>
				<div className="flex items-center gap-2 rounded-sm border border-[#323a3f] bg-[#111213] px-3 py-2">
					{materialSymbol("search", "text-[16px] text-[#98b9d0]")}
					<input
						className="min-w-0 flex-1 bg-transparent text-sm text-[#f2f0ef] outline-none placeholder:text-[#727e86]"
						placeholder="Search projects, threads, and git..."
						value={sidebarSearchQuery}
						onChange={(event) => {
							setSidebarSearchQuery(event.currentTarget.value);
						}}
						autoCapitalize="none"
						autoCorrect="off"
						spellCheck={false}
					/>
					{sidebarSearchQuery ? (
						<button
							type="button"
							className="flex h-5 w-5 items-center justify-center rounded-sm text-[#8f8d8b] transition-colors hover:bg-[#1d2226] hover:text-[#f2f0ef]"
							onClick={() => setSidebarSearchQuery("")}
							aria-label="Clear sidebar search"
						>
							×
						</button>
					) : null}
				</div>
			</label>
		</div>
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
					const projectErrorPreviewText = projectThreadErrorPreviewText(
						project.id,
					);
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
									{...errorPreviewHandlers(projectErrorPreviewText)}
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
													const worktreeErrorPreviewText =
														worktreeThreadErrorPreviewText(
															project.id,
															worktree.path,
														);
													return (
														<div
															className="relative"
															key={worktree.path}
															{...errorPreviewHandlers(
																worktreeErrorPreviewText,
															)}
														>
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
							const threadPinned = Boolean(thread.pinnedAt);
							const isActive = selectedThreadId === thread.id;
							const isWorking = thread.runStatus.state === "working";
							const hasRunError = thread.runStatus.state === "failed";
							const hasUnreadError = thread.runStatus.hasUnreadError;
							const threadErrorPreviewText =
								hasUnreadError || hasRunError
									? (thread.runStatus.error ?? "")
									: "";
							return (
								<button
									type="button"
									key={thread.id}
									className={`w-full rounded-sm px-3 py-2 text-left transition-colors ${
										isActive
											? "bg-[#273036] text-[#f2f0ef]"
											: "bg-[#151515] text-[#d7d7d7] hover:bg-[#1f2020]"
									}`}
									{...errorPreviewHandlers(threadErrorPreviewText)}
									onContextMenu={(event) => {
										event.preventDefault();
										event.stopPropagation();
										hideErrorPreview();
										openThreadActionMenu(
											thread,
											event.clientX + 6,
											event.clientY + 6,
										);
									}}
									onClick={() => {
										hideErrorPreview();
										void openThread(thread.id, {
											acknowledgeUnreadError: hasUnreadError,
										});
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
															: isActive
																? "bg-[#bdd5e6]"
																: "bg-[#545d64]"
												}`}
											/>
											<div
												className="min-w-0 truncate text-sm font-medium"
												title={thread.title}
											>
												{thread.title}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											{threadPinned ? (
												<span title="Pinned">
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
									<div
										className="mt-1 flex min-w-0 items-center gap-1 text-[11px]"
										title={`${threadBranchName} | ${formatPathForDisplay(thread.worktreePath, homeDirectory, supportsTildePath)}`}
									>
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
		window.__jtIdeAppMountedAt = Date.now();
		console.log("App.tsx mounted", window.__jtIdeAppMountedAt);
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
								className="font-label text-xs uppercase tracking-wider text-[#bdd5e6] border-b-2 border-[#7eadce] pb-1"
							>
								Chat
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
						<div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 hide-scrollbar">
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
										className="w-10 h-10 flex items-center justify-center bg-[#bdd5e6] rounded-sm text-[#2e526b] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
										disabled={
											!selectedThread ||
											isSending ||
											selectedThreadIsWorking ||
											isThreadLoading
										}
									>
										{materialSymbol("arrow_forward")}
									</button>
								</div>
							</div>
						</form>
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
					<div className="flex flex-1 min-h-0 flex-col gap-8 overflow-y-auto pb-40 hide-scrollbar">
						{renderMobileMessages}
					</div>
				</main>

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
									className="bg-gradient-to-tr from-[#bdd5e6] to-[#adcbe0] text-[#224259] p-2 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center"
									type="submit"
									disabled={
										!selectedThread ||
										isSending ||
										selectedThreadIsWorking ||
										isThreadLoading
									}
								>
									{materialSymbol("arrow_upward")}
								</button>
							</div>
						</div>
						{modelControlError ? (
							<div className="text-xs text-[#ff6e84]">{modelControlError}</div>
						) : null}
						{taskControlError ? (
							<div className="text-xs text-[#ff6e84]">{taskControlError}</div>
						) : null}
					</form>
				</div>

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
						<div className="flex flex-col items-center justify-center text-[#bdd5e6] font-bold border-t-2 border-[#bdd5e6] pt-2">
							{brandBoltIcon("text-sm")}
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
			{errorPreviewPopover ? (
				<div
					className="pointer-events-none fixed z-[110] max-w-[22rem] rounded-md border border-[#7a2030] bg-[#341019]/96 px-3 py-2 text-xs leading-5 text-[#ffb1bf] shadow-[0_18px_42px_rgba(0,0,0,0.56)] backdrop-blur-sm"
					style={{
						left: errorPreviewPopover.x,
						top: errorPreviewPopover.y,
					}}
				>
					<div className="mb-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#ff8698]">
						Error Preview
					</div>
					<div className="whitespace-pre-wrap break-words">
						{errorPreviewPopover.text}
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
