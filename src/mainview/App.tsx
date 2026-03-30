import {
	type CSSProperties,
	type ChangeEvent,
	type FormEvent,
	type HTMLAttributes,
	type KeyboardEvent,
	type MouseEvent as ReactMouseEvent,
	useCallback,
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

const WORKTREE_TASKS_CHANGED_EVENT_NAME = "jt-ide:worktree-tasks-changed";
const WORKTREE_GIT_HISTORY_CHANGED_EVENT_NAME =
	"jt-ide:worktree-git-history-changed";

const CODE_FONT_STACK =
	'"Fira Code", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const THREAD_STATUS_POLL_INTERVAL_MS = 1_500;
const DESKTOP_COMPOSER_MIN_HEIGHT_PX = 96;
const MOBILE_COMPOSER_MIN_HEIGHT_PX = 44;
const COMPOSER_MAX_HEIGHT_PX = 240;
const MAINVIEW_STATE_STORAGE_KEY = "jt-ide:mainview-state";
const MAINVIEW_STATE_STORAGE_VERSION = 1;

const codeBlockStyle = {
	margin: 0,
	border: "1px solid rgba(125, 115, 255, 0.18)",
	borderRadius: "0.5rem",
	background: "#101114",
	padding: "0.875rem 1rem",
	fontSize: "0.8125rem",
	lineHeight: "1.6",
} satisfies CSSProperties;

const codeTagStyle = {
	fontFamily: CODE_FONT_STACK,
} satisfies CSSProperties;

const markdownComponents: Components = {
	a({ href, children, ...props }) {
		return (
			<a
				{...props}
				href={href}
				target="_blank"
				rel="noreferrer"
				className="text-[#b5b0ff] underline decoration-[#6f66d8] underline-offset-2 transition-colors hover:text-[#ddd9ff]"
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
				className={`rounded-sm bg-[#1b1d24] px-1.5 py-0.5 font-mono text-[0.8125rem] text-[#d9d5ff] ${className ?? ""}`.trim()}
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
		const projectId = candidate.projectId;
		const worktreePath = candidate.worktreePath;
		if (!Number.isInteger(projectId) || projectId < 1) {
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
			selectedProjectId: Number.isInteger(parsed.selectedProjectId)
				? parsed.selectedProjectId
				: null,
			selectedWorktreePath:
				typeof parsed.selectedWorktreePath === "string" &&
				parsed.selectedWorktreePath.trim()
					? parsed.selectedWorktreePath
					: null,
			selectedThreadId: Number.isInteger(parsed.selectedThreadId)
				? parsed.selectedThreadId
				: null,
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

function materialSymbol(name: string, className = ""): JSX.Element {
	return (
		<span className={`material-symbols-outlined ${className}`.trim()}>
			{name}
		</span>
	);
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
	const usagePercent = Math.round(usageRatio * 100);
	const windowUsagePercent = Math.round(
		Math.min(inputTokens / safeContextWindowTokens, 1) * 100,
	);
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
		<div className="flex items-center gap-3" title={titleParts.join(" • ")}>
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
				<span className="absolute inset-0 flex items-center justify-center font-label text-[8px] font-bold uppercase tracking-[0.08em] text-[#f2f0ef]">
					{usagePercent}
				</span>
			</div>
			<div className="flex flex-col items-end leading-none text-right">
				<div className="flex items-center gap-2">
					<span className="font-label text-[10px] uppercase tracking-widest text-[#dad7ff]">
						{formatCompactTokenCount(inputTokens)} /{" "}
						{formatCompactTokenCount(estimatedTriggerTokens)}
					</span>
					<span
						className={`rounded-full border px-1.5 py-[2px] font-label text-[8px] uppercase tracking-[0.18em] ${
							estimatedTriggerSource === "observed"
								? "border-[#2f6b5d] bg-[#142821] text-[#8bf0c0]"
								: "border-[#4c4760] bg-[#1b1b24] text-[#b7b2d9]"
						}`}
					>
						{estimateLabel}
					</span>
				</div>
				<span className="mt-1 font-label text-[9px] uppercase tracking-[0.16em] text-[#8f8d8b]">
					Compaction est. · Win {windowUsagePercent}%
				</span>
				<span className="mt-1 font-label text-[9px] uppercase tracking-[0.14em] text-[#6f6f89]">
					{formatCompactTokenCount(inputTokens)} /{" "}
					{formatCompactTokenCount(contextWindowTokens)} window
				</span>
				{lastCompactionTransition ? (
					<span className="mt-1 font-label text-[9px] uppercase tracking-[0.12em] text-[#8bf0c0]">
						Last compact {lastCompactionTransition}
					</span>
				) : inferredCount > 0 ? (
					<span className="mt-1 font-label text-[9px] uppercase tracking-[0.12em] text-[#8bf0c0]">
						{inferredCount} compact events observed
					</span>
				) : null}
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
			title={activeModel?.summary ?? "Codex model"}
		>
			<button
				type="button"
				className={`flex w-full items-center gap-2 overflow-hidden border text-left transition-colors ${
					variant === "desktop"
						? "rounded-sm border-[#3a3a44] bg-[#131313] px-3 py-1.5 hover:bg-[#181a20]"
						: "rounded-xl border-[#3c415d] bg-[#1b1d24] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#232632]"
				} ${disabled ? "cursor-not-allowed opacity-60" : ""} ${
					open
						? "border-[#8e86f3] shadow-[0_0_0_1px_rgba(142,134,243,0.18)]"
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
				<span
					className={`shrink-0 ${
						variant === "desktop" ? "text-[#948def]" : "text-[#aaa4ff]"
					}`}
				>
					{materialSymbol("neurology", "text-[16px]")}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={`block truncate font-label font-bold uppercase text-[#f2f0ef] ${
							variant === "desktop"
								? "text-[10px] tracking-wider"
								: "text-[10px] tracking-widest"
						}`}
					>
						{buttonLabel}
					</span>
				</span>
				<span className="shrink-0 text-[#8f8d8b]">
					{materialSymbol(open ? "expand_less" : "expand_more", "text-[16px]")}
				</span>
			</button>
			{open ? (
				<div
					className={`absolute left-0 right-0 bottom-[calc(100%+0.5rem)] z-40 overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
						variant === "desktop"
							? "rounded-md border-[#3a355f] bg-[#14131d]"
							: "rounded-2xl border-[#413e5e] bg-[#15161f]"
					}`}
				>
					<div className="border-b border-[#3a355f] px-2 py-2">
						<div className="flex items-center gap-2.5 rounded-md border border-[#3a355f] bg-[#101114] px-3 py-2">
							{materialSymbol("search", "text-[15px] text-[#8f89df]")}
							<input
								ref={searchInputRef}
								className="min-w-0 flex-1 bg-transparent text-[11px] text-[#f2f0ef] outline-none placeholder:text-[#6f6f89]"
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
									className="flex h-5 w-5 items-center justify-center rounded-sm text-[#8f8d8b] transition-colors hover:bg-[#1b1d28] hover:text-[#f2f0ef]"
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
							<div className="px-4 py-4 text-xs text-[#8e8aa7]">
								No matching models.
							</div>
						) : null}
						{filteredGroups.map((group) => (
							<div key={group.group} className="px-2 pb-2 last:pb-0">
								<div className="px-2 pb-1 pt-1 font-label text-[9px] uppercase tracking-[0.18em] text-[#8e89bf]">
									{group.group}
								</div>
								<div className="space-y-1">
									{group.models.map((model) => {
										const selected = model.id === value;
										return (
											<button
												key={model.id}
												type="button"
												className={`flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors ${
													selected
														? "bg-[#282244] text-[#f7f5ff]"
														: "text-[#e8e4ff] hover:bg-[#1d1c2a]"
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
														selected ? "text-[#aaa4ff]" : "text-[#5d5a72]"
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
															selected ? "text-[#cbc5ff]" : "text-[#a6a0c9]"
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

	return (
		<div ref={rootRef} className="relative">
			<button
				type="button"
				className={`flex items-center gap-2 transition-colors ${
					variant === "desktop"
						? "rounded-sm bg-[#191a1a] px-3 py-1.5 hover:bg-[#262626]"
						: "rounded-xl border border-[#3c415d] bg-[#1b1d24] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] hover:bg-[#232632]"
				} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
				onClick={() => {
					if (!disabled) {
						setOpen((current) => !current);
					}
				}}
				disabled={disabled}
				aria-expanded={open}
				aria-haspopup="menu"
			>
				{materialSymbol(
					"checklist",
					variant === "desktop"
						? "text-[#ff96bb] text-[16px]"
						: "text-on-surface-variant text-sm",
				)}
				<span
					className={`font-label uppercase ${
						variant === "desktop"
							? "text-[10px] font-bold text-[#f2f0ef]"
							: "text-[10px] tracking-widest text-[#f2f0ef]"
					}`}
				>
					{buttonLabel}
				</span>
			</button>
			{open ? (
				<div
					className={`absolute bottom-[calc(100%+0.5rem)] left-0 z-40 min-w-[18rem] overflow-hidden border shadow-[0_18px_38px_rgba(0,0,0,0.42)] ${
						variant === "desktop"
							? "rounded-md border-[#3a355f] bg-[#14131d]"
							: "rounded-2xl border-[#413e5e] bg-[#15161f]"
					}`}
				>
					<div className="border-b border-[#3a355f] px-3 py-2 font-label text-[9px] uppercase tracking-[0.18em] text-[#8e89bf]">
						Project Tasks
					</div>
					<div className="max-h-80 overflow-y-auto py-2 hide-scrollbar">
						{loading ? (
							<div className="px-4 py-4 text-xs text-[#8e8aa7]">
								Loading tasks...
							</div>
						) : tasks.length === 0 ? (
							<div className="px-4 py-4 text-xs text-[#8e8aa7]">
								No project tasks found.
							</div>
						) : (
							tasks.map((task) => (
								<button
									key={task.id}
									type="button"
									className="flex w-full items-start gap-3 px-3 py-2 text-left transition-colors hover:bg-[#1d1c2a]"
									onClick={() => {
										setOpen(false);
										onSelect(task);
									}}
								>
									<span className="mt-0.5 shrink-0 text-[#ff96bb]">
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
											<span className="mt-1 block truncate text-[11px] leading-4 text-[#a6a0c9]">
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
		<div className="flex w-full min-w-0 items-center gap-3 rounded-sm border border-[#282d48] bg-[#151926] px-3 py-3 text-[#d7d3ff]">
			<BeatLoader color="#aaa4ff" margin={2} size={6} speedMultiplier={0.85} />
			<span className="font-label text-[11px] uppercase tracking-[0.16em] text-[#c3beff]">
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
	const trimmed = diffText.trim();
	if (!trimmed) {
		return [
			{
				kind: "meta",
				key: "meta:no-diff",
				text: "No diff preview available.",
			},
		];
	}

	const keyCounts = new Map<string, number>();
	return trimmed.split(/\r?\n/).map((line): DiffLine => {
		const count = (keyCounts.get(line) ?? 0) + 1;
		keyCounts.set(line, count);
		if (
			line.startsWith("diff --git ") ||
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ")
		) {
			return {
				kind: "file",
				key: `file:${line}:${count}`,
				text: line,
			};
		}
		if (line.startsWith("@@")) {
			return {
				kind: "hunk",
				key: `hunk:${line}:${count}`,
				text: line,
			};
		}
		if (line.startsWith("+")) {
			return {
				kind: "add",
				key: `add:${line}:${count}`,
				text: line,
			};
		}
		if (line.startsWith("-")) {
			return {
				kind: "remove",
				key: `remove:${line}:${count}`,
				text: line,
			};
		}
		if (line.startsWith("\\")) {
			return {
				kind: "meta",
				key: `meta:${line}:${count}`,
				text: line,
			};
		}
		return {
			kind: "context",
			key: `context:${line}:${count}`,
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
	const lines = parseUnifiedDiff(diffText);
	return (
		<div
			className={`app-scrollbar min-h-0 overflow-y-auto overscroll-contain border-t border-[#262b40] bg-[#0c1018] font-mono text-[12px] leading-5 ${className}`.trim()}
			style={{ WebkitOverflowScrolling: "touch" }}
		>
			{lines.map((line) => (
				<div
					key={line.key}
					className={`whitespace-pre-wrap break-all px-3 py-0.5 ${
						line.kind === "add"
							? "bg-[#10261d] text-[#80f2c5]"
							: line.kind === "remove"
								? "bg-[#31141b] text-[#ff9bb0]"
								: line.kind === "hunk"
									? "bg-[#181f33] text-[#aeb7e8]"
									: line.kind === "file"
										? "bg-[#121827] text-[#8cc5ff]"
										: line.kind === "meta"
											? "bg-[#10141d] text-[#7f88ad]"
											: "text-[#d7d8e0]"
					}`}
				>
					{line.text || " "}
				</div>
			))}
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
		<details className="w-full min-w-0 overflow-hidden rounded-sm border border-[#2a2f48] bg-[#111521] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
			<summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
				<div className="min-w-0">
					<div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#aaa4ff]">
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
								: "border border-[#3b4162] bg-[#1c2135] text-[#c8c4ff]"
					}`}
				>
					{commandStateLabel(state, exitCode)}
				</span>
			</summary>
			<div className="border-t border-[#262b40] bg-[#0d1018] px-3 py-3">
				<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-[#1c2236] bg-[#090c13] px-3 py-3 font-mono text-[12px] leading-5 text-[#d6d3ec]">
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
		<div className="w-full min-w-0 rounded-sm border border-[#2a2f48] bg-[#111521] px-3 py-3 shadow-[0_12px_28px_rgba(0,0,0,0.22)]">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#aaa4ff]">
					Reasoning
				</div>
				<span className="rounded-full border border-[#313754] bg-[#171c2c] px-2 py-0.5 font-label text-[9px] uppercase tracking-[0.16em] text-[#c8c4ff]">
					{state === "completed" ? "Ready" : "Thinking"}
				</span>
			</div>
			<div className="text-sm leading-relaxed text-[#d9d7ef]">
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
}: {
	changeKind: "add" | "delete" | "update";
	diffText: string;
	path: string;
	state: "completed" | "failed";
}): JSX.Element {
	return (
		<details className="w-full min-w-0 overflow-hidden rounded-sm border border-[#2a2f48] bg-[#111521] shadow-[0_12px_28px_rgba(0,0,0,0.24)]">
			<summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3">
				<div className="min-w-0">
					<div className="font-label text-[10px] uppercase tracking-[0.16em] text-[#aaa4ff]">
						File Change
					</div>
					<div
						className="truncate font-mono text-[12px] text-[#b8b2ff] underline decoration-[#6f66d8] underline-offset-2"
						title={path}
					>
						{path}
					</div>
				</div>
			</summary>
			<DiffViewer diffText={diffText} className="max-h-[28rem]" />
		</details>
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
				className="absolute inset-0 bg-[#05060b]/84 backdrop-blur-sm"
				onClick={onClose}
				aria-label="Close git diff"
			/>
			<div className="absolute inset-0 md:flex md:items-center md:justify-center md:p-6">
				<div className="relative flex h-full min-h-0 w-full flex-col border border-[#24293d] bg-[#0c1018] shadow-[0_24px_56px_rgba(0,0,0,0.56)] md:h-[88vh] md:max-h-[56rem] md:max-w-5xl md:overflow-hidden md:rounded-xl">
					<div className="flex items-start justify-between gap-4 border-b border-[#262b40] bg-[#101522] px-4 py-4 md:px-6">
						<div className="min-w-0">
							<div className="flex flex-wrap items-center gap-2">
								<span className="rounded-full border border-[#3d4260] bg-[#171c2c] px-2 py-0.5 font-mono text-[10px] text-[#aaa4ff]">
									{state.entry.shortHash}
								</span>
								<span className="font-label text-[10px] uppercase tracking-[0.16em] text-[#8e95bc]">
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
							className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#363b55] bg-[#151a29] text-[#d7d3ff] transition-colors hover:bg-[#1d2335]"
							onClick={onClose}
							aria-label="Close git diff"
						>
							×
						</button>
					</div>
					<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
						{state.loading ? (
							<div className="flex h-full items-center justify-center px-6 py-10">
								<div className="flex items-center gap-3 rounded-full border border-[#303755] bg-[#14192a] px-4 py-3 text-sm text-[#d7d3ff]">
									<BeatLoader
										color="#aaa4ff"
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
							<DiffViewer diffText={state.diffText} className="flex-1" />
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
	title: string;
	open: boolean;
	onToggle: () => void;
	action?: JSX.Element | null;
}): JSX.Element {
	return (
		<div className="flex items-center gap-3">
			<button
				type="button"
				className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1.5 text-left transition-colors hover:bg-[#191b24]"
				onClick={onToggle}
				aria-expanded={open}
			>
				<span className="shrink-0 text-[#b7b2ff]">
					{materialSymbol(
						open ? "expand_more" : "chevron_right",
						"text-[18px]",
					)}
				</span>
				<span className="font-label text-[13px] font-bold uppercase tracking-[0.18em] text-[#f4f1ff]">
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
	const [directorySuggestions, setDirectorySuggestions] = useState<string[]>(
		[],
	);
	const [directorySuggestionsLoading, setDirectorySuggestionsLoading] =
		useState(false);
	const [isAddingProject, setIsAddingProject] = useState(false);
	const [isCreatingWorktree, setIsCreatingWorktree] = useState(false);
	const [threads, setThreads] = useState<RpcThread[]>([]);
	const [projectTasks, setProjectTasks] = useState<RpcProjectTask[]>([]);
	const [gitHistory, setGitHistory] =
		useState<RpcWorktreeGitHistoryResult | null>(null);
	const [gitHistoryLoading, setGitHistoryLoading] = useState(false);
	const [gitHistoryError, setGitHistoryError] = useState("");
	const [projectsSectionOpen, setProjectsSectionOpen] = useState(true);
	const [threadsSectionOpen, setThreadsSectionOpen] = useState(true);
	const [gitSectionOpen, setGitSectionOpen] = useState(true);
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
	const projectActionMenuRef = useRef<HTMLDivElement | null>(null);
	const threadActionMenuRef = useRef<HTMLDivElement | null>(null);
	const desktopComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const mobileComposerRef = useRef<HTMLTextAreaElement | null>(null);
	const projectActionMenuRequestId = useRef(0);
	const projectTasksRequestIdRef = useRef(0);
	const gitHistoryRequestIdRef = useRef(0);
	const gitHistoryDiffRequestIdRef = useRef(0);
	const gitHistoryDiffCacheRef = useRef(
		new Map<string, { commit: RpcGitHistoryEntry; diffText: string }>(),
	);
	const selectedThreadIdRef = useRef<number | null>(null);
	const selectedThreadRunStateRef = useRef<RpcThreadRunStatus["state"]>("idle");

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
	const activeScreenSubtitleSecondary =
		activeSelectedWorktreePath ?? "No worktree selected";

	const taskSelectorDisabled =
		!selectedProject ||
		!activeSelectedWorktreePath ||
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

				gitHistoryDiffCacheRef.current.set(cacheKey, {
					commit: result.commit,
					diffText: result.diffText,
				});
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

	const loadProjectWorktrees = useCallback(
		async (projectId: number): Promise<RpcWorktree[]> => {
			const result = await procedures.listProjectWorktrees({ projectId });
			setProjectState(projectId, {
				worktrees: result.worktrees,
				loadingWorktrees: false,
				error: "",
			});
			return result.worktrees;
		},
		[procedures, setProjectState],
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

	const loadGitHistory = useCallback(
		async (
			projectId: number,
			worktreePath: string,
			options?: {
				silent?: boolean;
			},
		): Promise<void> => {
			const requestId = ++gitHistoryRequestIdRef.current;
			if (!options?.silent) {
				setGitHistoryLoading(true);
				setGitHistoryError("");
			}

			try {
				const result = await procedures.listWorktreeGitHistory({
					projectId,
					worktreePath,
				});
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}
				setGitHistory(result);
				setGitHistoryError("");
			} catch (error) {
				if (gitHistoryRequestIdRef.current !== requestId) {
					return;
				}
				if (!options?.silent) {
					setGitHistory(null);
				}
				setGitHistoryError(
					error instanceof Error ? error.message : String(error),
				);
			} finally {
				if (!options?.silent && gitHistoryRequestIdRef.current === requestId) {
					setGitHistoryLoading(false);
				}
			}
		},
		[procedures],
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
			} catch (error) {
				setThreadsError(error instanceof Error ? error.message : String(error));
			} finally {
				setIsThreadLoading(false);
			}
		},
		[loadProjectWorktrees, procedures, syncThreadContext],
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

			const openProjects = loaded.filter((project) => project.isOpen === 1);
			const openProjectIds = new Set(openProjects.map((project) => project.id));
			const restoredProjectWorktrees = new Map<number, RpcWorktree[]>();

			for (const project of openProjects) {
				setProjectState(project.id, {
					expanded: true,
					loadingWorktrees: true,
					error: "",
				});
			}

			await Promise.all(
				openProjects.map(async (project) => {
					try {
						const worktrees = await loadProjectWorktrees(project.id);
						restoredProjectWorktrees.set(project.id, worktrees);
					} catch (error) {
						setProjectState(project.id, {
							loadingWorktrees: false,
							error: error instanceof Error ? error.message : String(error),
						});
					}
				}),
			);

			const restoredOpenWorktrees = await Promise.all(
				persistedState.openWorktrees
					.filter(({ projectId }) => openProjectIds.has(projectId))
					.map(async ({ projectId, worktreePath }) => {
						try {
							const result = await procedures.openWorktree({
								projectId,
								worktreePath,
							});
							return {
								ok: true as const,
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

			for (const result of restoredOpenWorktrees) {
				if (result.ok) {
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

			const initialThread = pickInitialThread(sortedThreads, persistedState);
			if (initialThread) {
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
		hydrateProjectRows,
		initialMainviewState,
		loadProjectWorktrees,
		openThread,
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
		[closeThreadActionMenu, loadProjectWorktrees],
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
			procedures,
			projectActionMenu,
			selectedProjectId,
			selectedThreadId,
			setProjectState,
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
		if (!selectedProject || !activeSelectedWorktreePath) {
			projectTasksRequestIdRef.current += 1;
			setProjectTasks([]);
			setIsLoadingProjectTasks(false);
			setTaskControlError("");
			return;
		}
		void loadProjectTasks(selectedProject.id, activeSelectedWorktreePath);
	}, [activeSelectedWorktreePath, loadProjectTasks, selectedProject]);

	useEffect(() => {
		if (!selectedProject || !activeSelectedWorktreePath) {
			gitHistoryRequestIdRef.current += 1;
			setGitHistory(null);
			setGitHistoryLoading(false);
			setGitHistoryError("");
			return;
		}
		void loadGitHistory(selectedProject.id, activeSelectedWorktreePath);
	}, [activeSelectedWorktreePath, loadGitHistory, selectedProject]);

	useEffect(() => {
		const handleWorktreeTasksChanged = (
			event: CustomEvent<RpcWorktreeTasksChanged>,
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
	}, [activeSelectedWorktreePath, loadProjectTasks, selectedProject]);

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
		if (!selectedProjectId || !activeSelectedWorktreePath) {
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
				model: activeCodexModel || defaultCodexModel || undefined,
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
						? "Create a thread from the Threads section to start a Codex conversation for the selected worktree."
						: "Add a project, choose a worktree, and create a thread to begin.",
				},
			];
		} else if (threadMessages.length === 0) {
			messages = [
				{
					kind: "chat",
					speaker: "assistant",
					tone: "normal",
					text: `Thread ready in ${selectedProject?.name ?? "this project"} · ${activeSelectedWorktreeFolder}. Ask Codex to inspect, refactor, or debug this worktree.`,
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

	const assistantMessageLabel = useCallback(
		(message: VisibleMessage): string => {
			if (message.kind === "chat") {
				if (message.tone === "error") {
					return "Codex • Error";
				}
				return "Codex • Assistant";
			}
			if (message.kind === "reasoning") {
				return "Codex • Reasoning";
			}
			if (message.kind === "command") {
				return "Codex • Command";
			}
			return "Codex • File Change";
		},
		[],
	);

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
				/>
			);
		},
		[],
	);

	const renderDesktopMessages = visibleMessages.map((message, index) => {
		if (message.kind !== "chat" || message.speaker === "assistant") {
			return (
				<div
					className="group flex w-full min-w-0 items-start gap-6"
					key={`${message.kind}-${index}`}
				>
					<div className="w-8 h-8 rounded-sm bg-[#9c95f8] flex items-center justify-center shrink-0">
						<span
							className="material-symbols-outlined text-[#1b0a71] text-sm"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							psychology
						</span>
					</div>
					<div className="min-w-0 flex-1 space-y-4">
						<div
							className={`font-label text-[10px] uppercase tracking-widest font-bold ${
								message.kind === "chat" && message.tone === "error"
									? "text-[#ff8ca0]"
									: message.kind === "reasoning"
										? "text-[#bfc5ff]"
										: message.kind === "command"
											? "text-[#93d8ff]"
											: message.kind === "file_change"
												? "text-[#8ce7c5]"
												: "text-[#aaa4ff]"
							}`}
						>
							{assistantMessageLabel(message)}
						</div>
						<div className="min-w-0 max-w-full text-[#ffffff] leading-relaxed text-sm">
							{renderAssistantMessageContent(message)}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div
				className="flex w-full min-w-0 justify-end gap-6"
				key={`${message.speaker}-${index}`}
			>
				<div className="min-w-0 w-full max-w-2xl space-y-3 text-right">
					<div className="font-body text-[13px] font-semibold tracking-[0.01em] text-[#b7b3b1]">
						{localUserLabel}
					</div>
					<div className="ml-auto max-w-full overflow-hidden rounded-sm bg-[#262626] p-4 text-left text-sm text-[#ffffff]">
						<MarkdownMessage text={message.text} />
					</div>
				</div>
				<div className="w-8 h-8 rounded-sm bg-[#262626] flex items-center justify-center shrink-0">
					{materialSymbol("person")}
				</div>
			</div>
		);
	});

	const renderMobileMessages = visibleMessages.map((message, index) => {
		if (message.kind !== "chat" || message.speaker === "assistant") {
			return (
				<div
					className="flex flex-col items-start gap-3 max-w-full"
					key={`${message.kind}-${index}`}
				>
					<div className="flex items-center gap-2 text-[#aaa4ff] px-1">
						<span
							className="material-symbols-outlined text-sm"
							style={{ fontVariationSettings: "'FILL' 1" }}
						>
							hub
						</span>
						<span className="text-[10px] font-label uppercase tracking-wider font-bold">
							{message.kind === "reasoning"
								? "Reasoning"
								: message.kind === "command"
									? "Command"
									: message.kind === "file_change"
										? "File Change"
										: message.kind === "chat" && message.tone === "error"
											? "Error"
											: "Intelligence"}
						</span>
					</div>
					<div className="glass-panel p-5 rounded-lg border border-[#aaa4ff]/10 w-full flex flex-col gap-4">
						<div className="text-sm leading-relaxed text-[#ffffff]">
							{renderAssistantMessageContent(message)}
						</div>
					</div>
				</div>
			);
		}

		return (
			<div
				className="flex flex-col items-end gap-2 max-w-[90%] self-end"
				key={`${message.speaker}-${index}`}
			>
				<div className="flex items-center gap-2 px-1 text-[#b7b3b1]">
					<span className="font-body text-[13px] font-semibold tracking-[0.01em]">
						{localUserLabel}
					</span>
					<span className="material-symbols-outlined text-sm text-[#9f9b99]">
						account_circle
					</span>
				</div>
				<div className="bg-[#1f2020] p-4 rounded-lg rounded-tr-none text-sm leading-relaxed text-[#ffffff] shadow-sm">
					<MarkdownMessage text={message.text} />
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
								<span className="material-symbols-outlined text-[18px]">
									delete
								</span>
							</button>
							<button
								type="button"
								className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2b2f45] bg-[#171a28] text-[#a6abc7] transition-colors hover:bg-[#202537] hover:text-[#f2f0ef]"
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
									className="rounded-sm border border-[#21253a] bg-[#131624] px-3 py-2"
									key={worktree.path}
									{...errorPreviewHandlers(worktreeErrorPreviewText)}
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
												worktreeErrorLevel === "unread"
													? "bg-[#ff304f]"
													: worktreeErrorLevel === "failed"
														? "bg-[#8f4956]"
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
			</div>
		) : null;

	const threadActionMenuPanel =
		threadActionMenu && threadActionMenuThread ? (
			<div
				className="fixed z-[95] w-80 overflow-hidden rounded-lg border border-[#2f3150] bg-[#11131d]/96 shadow-[0_18px_42px_rgba(0,0,0,0.58)] backdrop-blur-xl"
				ref={threadActionMenuRef}
				style={{
					left: threadActionMenu.x,
					top: threadActionMenu.y,
				}}
			>
				<div className="border-b border-[#262b40] bg-[#151827] px-3 py-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="font-label text-[10px] uppercase tracking-widest text-[#8f89df]">
								Thread Actions
							</div>
							<div className="truncate text-sm font-semibold text-[#f2f0ef]">
								{threadActionMenuThread.title}
							</div>
							<div className="truncate text-[11px] text-[#8e8aa7]">
								{formatPathForDisplay(
									threadActionMenuThread.worktreePath,
									homeDirectory,
									supportsTildePath,
								)}
							</div>
						</div>
						<button
							type="button"
							className="flex h-7 w-7 items-center justify-center rounded-sm border border-[#2b2f45] bg-[#171a28] text-[#a6abc7] transition-colors hover:bg-[#202537] hover:text-[#f2f0ef]"
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
					className="border-b border-[#262b40] bg-[#141724] px-3 py-3"
					onSubmit={submitThreadRename}
				>
					<label
						className="block text-[10px] font-label uppercase tracking-widest text-[#8f89df]"
						htmlFor="thread-rename-title"
					>
						Rename Thread
					</label>
					<div className="mt-2 flex items-center gap-2">
						<input
							id="thread-rename-title"
							className="min-w-0 flex-1 rounded-sm border border-[#353a55] bg-[#10131d] px-3 py-2 text-sm text-[#f2f0ef] outline-none transition-colors placeholder:text-[#6f6f89] focus:border-[#7d73ff]"
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
				<div className="flex justify-end gap-2 border-t border-[#262b40] px-3 py-3">
					<button
						type="button"
						className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-[#2b3150] bg-[#141829] text-[#d7d3ff] transition-colors hover:bg-[#1a1f34] disabled:cursor-not-allowed disabled:opacity-60"
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
						<span
							className="material-symbols-outlined text-[18px]"
							style={{
								fontVariationSettings: threadActionMenuThread.pinnedAt
									? "'FILL' 1"
									: "'FILL' 0",
							}}
						>
							push_pin
						</span>
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
						<span className="material-symbols-outlined text-[18px]">
							delete
						</span>
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
				<div className="flex items-center gap-2 rounded-sm border border-[#2f3242] bg-[#101114] px-3 py-2">
					{materialSymbol("search", "text-[16px] text-[#8f89df]")}
					<input
						className="min-w-0 flex-1 bg-transparent text-sm text-[#f2f0ef] outline-none placeholder:text-[#6f6f89]"
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
							className="flex h-5 w-5 items-center justify-center rounded-sm text-[#8f8d8b] transition-colors hover:bg-[#1b1d28] hover:text-[#f2f0ef]"
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
						state.expanded || Boolean(normalizedSidebarSearchQuery);
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
									className={`min-w-0 flex-1 px-3 py-2 text-left ${isActive ? "text-[#aaa4ff]" : "text-[#d7d7d7]"}`}
									{...errorPreviewHandlers(projectErrorPreviewText)}
									onClick={() => {
										hideErrorPreview();
										void refreshProject(project);
									}}
								>
									<div className="flex items-center gap-2">
										<span className="text-sm">
											{state.expanded ? "▾" : "▸"}
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
									className={`mr-2 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#2b2f45] bg-[#171a28] px-1 text-[9px] font-semibold leading-none tracking-[-0.18em] text-[#a6abc7] transition-all hover:bg-[#202537] hover:text-[#f2f0ef] ${
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
									{visibleWorktrees.map((worktree) => {
										const wState = getWorktreeState(project.id, worktree.path);
										const activeWorktree = isActiveWorktree(
											project.id,
											worktree.path,
										);
										const worktreeErrorLevel = worktreeThreadErrorLevel(
											project.id,
											worktree.path,
										);
										const worktreeErrorPreviewText =
											worktreeThreadErrorPreviewText(project.id, worktree.path);
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
												{...errorPreviewHandlers(worktreeErrorPreviewText)}
												onClick={() => {
													hideErrorPreview();
													clearThreadSelection();
													setThreadsError("");
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
															worktreeErrorLevel === "unread"
																? "bg-[#ff304f]"
																: worktreeErrorLevel === "failed"
																	? "bg-[#8f4956]"
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
									})}
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
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#7d73ff]/30 bg-[#1f1d31] text-sm font-semibold leading-none text-[#aaa4ff] transition-colors hover:border-[#aaa4ff]/60 hover:bg-[#2a2743] hover:text-[#d7d3ff]"
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
				title="Threads"
				open={threadsSectionOpen}
				onToggle={() => {
					setThreadsSectionOpen((current) => !current);
				}}
				action={
					<button
						type="button"
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-[#7d73ff]/30 bg-[#1f1d31] text-sm font-semibold leading-none text-[#aaa4ff] transition-colors hover:border-[#aaa4ff]/60 hover:bg-[#2a2743] hover:text-[#d7d3ff] disabled:cursor-not-allowed disabled:opacity-50"
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
								? "Start a new Codex thread for the selected worktree"
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
								: "No threads in this worktree yet. Use + to start a Codex thread for the selected worktree."}
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
											? "bg-[#25233a] text-[#f2f0ef]"
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
																? "bg-[#aaa4ff]"
																: "bg-[#4f5269]"
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
												<span
													className="material-symbols-outlined text-[14px] text-[#d7d3ff]"
													style={{ fontVariationSettings: "'FILL' 1" }}
													title="Pinned"
												>
													push_pin
												</span>
											) : null}
											{hasUnreadError ? (
												<span className="rounded-full border border-[#7a2030] bg-[#381018] px-2 py-0.5 font-label text-[9px] font-bold uppercase tracking-[0.16em] text-[#ff8698]">
													Unread
												</span>
											) : null}
											{isWorking ? (
												<BeatLoader
													color="#aaa4ff"
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
										<span className="shrink-0 text-[#6f6f89]">|</span>
										<span className="min-w-0 truncate text-[#8e8aa7]">
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
				title="Git"
				open={gitSectionOpen}
				onToggle={() => {
					setGitSectionOpen((current) => !current);
				}}
			/>
			{gitSectionOpen ? (
				<div className="mt-3 space-y-3">
					<div className="flex items-center justify-between gap-3 px-1">
						<span className="font-label text-[11px] tracking-[0.12em] text-[#d8d8d8]">
							Git History
						</span>
						{gitHistory?.branch || activeSelectedWorktree?.branch ? (
							<span className="shrink-0 rounded-full border border-[#343950] bg-[#151a29] px-2 py-0.5 font-mono text-[10px] text-[#aaa4ff]">
								{gitHistory?.branch ?? activeSelectedWorktree?.branch}
							</span>
						) : null}
					</div>
					{!selectedProject || !activeSelectedWorktreePath ? (
						<div className="rounded-sm border border-[#212121] bg-[#151515] px-3 py-3 text-xs text-[#8f8d8b]">
							Select a project worktree first.
						</div>
					) : gitHistoryLoading ? (
						<div className="rounded-sm border border-[#24293d] bg-[#121723] px-3 py-3 text-xs text-[#c8c4ff]">
							Loading git history...
						</div>
					) : gitHistoryError ? (
						<div className="rounded-sm border border-[#5c2030] bg-[#2c1117] px-3 py-3 text-xs text-[#ff9db0]">
							{gitHistoryError}
						</div>
					) : filteredGitHistoryEntries.length > 0 ? (
						<div className="max-h-64 space-y-1 overflow-y-auto pr-1 hide-scrollbar">
							{filteredGitHistoryEntries.map((entry) => (
								<button
									type="button"
									key={entry.hash}
									className="w-full rounded-sm border border-[#20242f] bg-[#151515] px-3 py-2 text-left transition-colors hover:bg-[#1d2029]"
									onClick={() => {
										void openGitHistoryDiff(entry);
									}}
								>
									<div className="flex items-start gap-3">
										<span className="mt-0.5 shrink-0 rounded-full border border-[#343950] bg-[#151a29] px-2 py-0.5 font-mono text-[10px] text-[#aaa4ff]">
											{entry.shortHash}
										</span>
										<div className="min-w-0 flex-1">
											<div
												className="truncate text-sm text-[#f2f0ef]"
												title={entry.subject}
											>
												{entry.subject}
											</div>
											<div className="mt-1 truncate text-[11px] text-[#8e8aa7]">
												{entry.authorName} ·{" "}
												{formatGitHistoryTimestamp(entry.committedAt)}
											</div>
										</div>
									</div>
								</button>
							))}
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
						<h1 className="text-xl font-black tracking-tighter text-[#aaa4ff]">
							JT_IDE
						</h1>
						<nav className="flex items-center gap-6">
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
						{selectedThread?.title ??
							selectedProject?.name ??
							"No project selected"}
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

				<main className="flex flex-1 min-h-0 overflow-hidden">
					<aside
						className={`flex min-h-0 shrink-0 flex-col border-r border-[#262626] bg-[#131313] transition-all duration-300 ${
							sidebarCollapsed ? "w-14" : "w-80"
						}`}
					>
						<div className="flex items-center justify-end border-b border-[#262626] px-3 py-3">
							<button
								type="button"
								className="px-2 py-1 rounded-sm text-[#aaa4ff] hover:bg-[#202020]"
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
										~ {activeScreenSubtitleSecondary}
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
												? "Ask Codex to generate, refactor, or debug..."
												: "Create a thread to start chatting with Codex..."
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
										className="w-10 h-10 flex items-center justify-center bg-[#aaa4ff] rounded-sm text-[#281d7c] hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
										disabled={
											!selectedThread ||
											isSending ||
											selectedThreadIsWorking ||
											isThreadLoading
										}
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

			<div className="flex h-full flex-col overflow-hidden md:hidden">
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
							JT_IDE
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
								~ {activeScreenSubtitleSecondary}
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
						<div className="overflow-hidden rounded-[1.35rem] border border-[#34384d] bg-[#17191f] shadow-[0_24px_60px_rgba(0,0,0,0.42)]">
							<div className="border-b border-[#2d3144] px-2 py-2">
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
							<div className="relative flex items-end gap-2 bg-[#17191f] px-2 py-2">
								<textarea
									ref={mobileComposerRef}
									className="min-h-0 flex-grow overflow-y-auto rounded-[1rem] border border-[#2f3347] bg-[#1d1f24] px-3 py-2 text-[#ffffff] text-sm leading-6 resize-none placeholder:text-[#adabaa]/50 focus:border-[#8e86f3] focus:outline-none"
									placeholder={
										selectedThread
											? "Ask Codex..."
											: "Create a thread to chat with Codex..."
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
									className="bg-gradient-to-tr from-[#aaa4ff] to-[#9c95f8] text-[#1b0a71] p-2 rounded-xl shadow-lg active:scale-95 transition-transform flex items-center justify-center"
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
