export type RpcProject = {
	id: number;
	path: string;
	name: string;
	isOpen: 1 | 0;
	createdAt: string;
	updatedAt: string;
	lastOpenedAt: string;
};

export type RpcWorktree = {
	path: string;
	branch: string | null;
	head: string | null;
	bare: boolean;
	pinnedAt: string | null;
};

export type RpcWorktreeSnapshot = {
	path: string;
	diff: string[];
	files: string[];
	lastUpdatedAt: string;
};

export type RpcProjectWorktreesResult = {
	project: RpcProject;
	worktrees: RpcWorktree[];
};

export type RpcOpenWorktreeResult = {
	project: RpcProject;
	worktree: RpcWorktreeSnapshot;
	history: RpcWorktreeGitHistoryResult;
};

export type RpcSetActiveWorktreeResult = {
	success: boolean;
	projectId: number | null;
	worktreePath: string | null;
};

export type RpcHomeDirectoryResult = {
	homeDirectory: string;
	supportsTildePath: boolean;
};

export type RpcDirectorySuggestionsResult = {
	directories: string[];
};

export type RpcCreateWorktreeResult = {
	project: RpcProject;
	worktrees: RpcWorktree[];
	worktreePath: string;
};

export type RpcProjectTask = {
	id: string;
	kind: "file" | "script";
	path: string;
	title: string;
	scriptName?: string | null;
	command?: string | null;
};

export type RpcWorktreeTasksChanged = {
	projectId: number;
	worktreePath: string;
};

export type RpcWorktreeGitHistoryChanged = {
	projectId: number;
	worktreePath: string;
};

export type RpcGitHistoryEntry = {
	hash: string;
	shortHash: string;
	subject: string;
	authorName: string;
	committedAt: string;
};

export type RpcWorktreeGitHistorySummary = {
	projectId: number;
	worktreePath: string;
	branch: string | null;
	headHash: string | null;
	headShortHash: string | null;
	lastUpdatedAt: string;
};

export type RpcWorktreeGitHistoryResult = RpcWorktreeGitHistorySummary & {
	entries: RpcGitHistoryEntry[];
	limit: number;
	nextOffset: number | null;
};

export type RpcGitCommitDiffResult = {
	projectId: number;
	worktreePath: string;
	commit: RpcGitHistoryEntry;
	diffText: string;
};

export type RpcRequestPriority = "background" | "default" | "foreground";

export type RpcProcedureCallOptions = {
	signal?: AbortSignal;
	timeoutMs?: number;
	priority?: RpcRequestPriority;
};

export type RpcRequestContext = {
	signal: AbortSignal;
	priority: RpcRequestPriority;
	timeoutMs: number | null;
};

export type RpcCodexModelOption = {
	id: string;
	label: string;
	group: string;
	summary: string;
	deprecated: boolean;
	contextWindowTokens: number;
};

export type RpcCodexModelCatalog = {
	defaultModel: string;
	models: RpcCodexModelOption[];
};

export type RpcThreadRunStatus = {
	state: "idle" | "working" | "failed";
	startedAt: string | null;
	updatedAt: string | null;
	error: string | null;
	hasUnreadError: boolean;
};

export type RpcThreadUsage = {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
};

export type RpcThreadCompaction = {
	estimatedTriggerTokens: number;
	estimatedTriggerSource: "heuristic" | "observed";
	maxObservedInputTokens: number | null;
	inferredCount: number;
	lastInferredAt: string | null;
	lastInferredBeforeInputTokens: number | null;
	lastInferredAfterInputTokens: number | null;
};

export type RpcThread = {
	id: number;
	projectId: number;
	worktreePath: string;
	title: string;
	model: string;
	codexThreadId: string | null;
	pinnedAt: string | null;
	createdAt: string;
	updatedAt: string;
	lastRunAt: string | null;
	usage: RpcThreadUsage | null;
	compaction: RpcThreadCompaction;
	runStatus: RpcThreadRunStatus;
};

export type RpcChatThreadMessage = {
	id: number;
	threadId: number;
	role: "assistant" | "user";
	kind: "chat";
	itemId: string | null;
	text: string;
	state: "in_progress" | "completed" | "failed" | null;
	createdAt: string;
	updatedAt: string;
};

export type RpcReasoningThreadMessage = {
	id: number;
	threadId: number;
	role: "assistant";
	kind: "reasoning";
	itemId: string;
	text: string;
	state: "in_progress" | "completed";
	createdAt: string;
	updatedAt: string;
};

export type RpcCommandThreadMessage = {
	id: number;
	threadId: number;
	role: "assistant";
	kind: "command";
	itemId: string;
	text: string;
	state: "in_progress" | "completed" | "failed";
	command: string;
	output: string;
	exitCode: number | null;
	createdAt: string;
	updatedAt: string;
};

export type RpcFileChangeThreadMessage = {
	id: number;
	threadId: number;
	role: "assistant";
	kind: "file_change";
	itemId: string;
	text: string;
	state: "completed" | "failed";
	path: string;
	changeKind: "add" | "delete" | "update";
	diffText: string;
	createdAt: string;
	updatedAt: string;
};

export type RpcThreadMessage =
	| RpcChatThreadMessage
	| RpcReasoningThreadMessage
	| RpcCommandThreadMessage
	| RpcFileChangeThreadMessage;

export type RpcThreadDetail = {
	thread: RpcThread;
	messages: RpcThreadMessage[];
};

export type AppRPCSchema = {
	requests: {
		getHomeDirectory: {
			params: undefined;
			response: RpcHomeDirectoryResult;
		};
		listDirectorySuggestions: {
			params: { query: string };
			response: RpcDirectorySuggestionsResult;
		};
		getCodexModelCatalog: {
			params: undefined;
			response: RpcCodexModelCatalog;
		};
		listProjects: {
			params:
				| {
						includeClosed?: boolean;
				  }
				| undefined;
			response: RpcProject[];
		};
		openProject: {
			params: { projectPath: string; name?: string | null };
			response: RpcProjectWorktreesResult;
		};
		closeProject: {
			params: { projectId: number };
			response: { success: boolean; projectId: number; message?: string };
		};
		deleteProject: {
			params: { projectId: number };
			response: { success: boolean; projectId: number; message?: string };
		};
		listProjectWorktrees: {
			params: { projectId: number };
			response: RpcProjectWorktreesResult;
		};
		listProjectTasks: {
			params: { projectId: number; worktreePath: string };
			response: RpcProjectTask[];
		};
		createWorktree: {
			params: { projectId: number; name: string };
			response: RpcCreateWorktreeResult;
		};
		openWorktree: {
			params: { projectId: number; worktreePath: string };
			response: RpcOpenWorktreeResult;
		};
		setActiveWorktree: {
			params: {
				projectId: number | null;
				worktreePath: string | null;
			};
			response: RpcSetActiveWorktreeResult;
		};
		listWorktreeGitHistory: {
			params: {
				projectId: number;
				worktreePath: string;
				offset?: number;
				limit?: number;
			};
			response: RpcWorktreeGitHistoryResult;
		};
		getWorktreeGitCommitDiff: {
			params: { projectId: number; worktreePath: string; commitHash: string };
			response: RpcGitCommitDiffResult;
		};
		closeWorktree: {
			params: { projectId: number; worktreePath: string };
			response: {
				success: boolean;
				projectId: number;
				worktreePath: string;
			};
		};
		setWorktreePinned: {
			params: { projectId: number; worktreePath: string; pinned: boolean };
			response: RpcProjectWorktreesResult;
		};
		listThreads: {
			params: undefined;
			response: RpcThread[];
		};
		createThread: {
			params: {
				projectId: number;
				worktreePath: string;
				model?: string | null;
			};
			response: RpcThreadDetail;
		};
		getThread: {
			params: { threadId: number };
			response: RpcThreadDetail;
		};
		markThreadErrorSeen: {
			params: { threadId: number };
			response: RpcThreadDetail;
		};
		sendThreadMessage: {
			params: { threadId: number; input: string };
			response: RpcThreadDetail;
		};
		runProjectTask: {
			params: {
				projectId: number;
				worktreePath: string;
				task: RpcProjectTask;
				threadId?: number | null;
				model?: string | null;
			};
			response: RpcThreadDetail;
		};
		renameThread: {
			params: { threadId: number; title: string };
			response: RpcThread;
		};
		setThreadPinned: {
			params: { threadId: number; pinned: boolean };
			response: RpcThread;
		};
		updateThreadModel: {
			params: { threadId: number; model: string };
			response: RpcThread;
		};
		deleteThread: {
			params: { threadId: number };
			response: { success: boolean; threadId: number; message?: string };
		};
	};
};

type RpcProcedureCall<Params, Response> = undefined extends Params
	? (params?: Params, options?: RpcProcedureCallOptions) => Promise<Response>
	: (params: Params, options?: RpcProcedureCallOptions) => Promise<Response>;

export interface ProjectProcedures {
	getHomeDirectory: RpcProcedureCall<
		AppRPCSchema["requests"]["getHomeDirectory"]["params"],
		AppRPCSchema["requests"]["getHomeDirectory"]["response"]
	>;
	listDirectorySuggestions: RpcProcedureCall<
		AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
		AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]
	>;
	getCodexModelCatalog: RpcProcedureCall<
		AppRPCSchema["requests"]["getCodexModelCatalog"]["params"],
		AppRPCSchema["requests"]["getCodexModelCatalog"]["response"]
	>;
	listProjects: RpcProcedureCall<
		AppRPCSchema["requests"]["listProjects"]["params"],
		AppRPCSchema["requests"]["listProjects"]["response"]
	>;
	openProject: RpcProcedureCall<
		AppRPCSchema["requests"]["openProject"]["params"],
		RpcProjectWorktreesResult
	>;
	closeProject: RpcProcedureCall<
		AppRPCSchema["requests"]["closeProject"]["params"],
		AppRPCSchema["requests"]["closeProject"]["response"]
	>;
	deleteProject: RpcProcedureCall<
		AppRPCSchema["requests"]["deleteProject"]["params"],
		AppRPCSchema["requests"]["deleteProject"]["response"]
	>;
	listProjectWorktrees: RpcProcedureCall<
		AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
		RpcProjectWorktreesResult
	>;
	listProjectTasks: RpcProcedureCall<
		AppRPCSchema["requests"]["listProjectTasks"]["params"],
		AppRPCSchema["requests"]["listProjectTasks"]["response"]
	>;
	createWorktree: RpcProcedureCall<
		AppRPCSchema["requests"]["createWorktree"]["params"],
		RpcCreateWorktreeResult
	>;
	openWorktree: RpcProcedureCall<
		AppRPCSchema["requests"]["openWorktree"]["params"],
		RpcOpenWorktreeResult
	>;
	setActiveWorktree: RpcProcedureCall<
		AppRPCSchema["requests"]["setActiveWorktree"]["params"],
		AppRPCSchema["requests"]["setActiveWorktree"]["response"]
	>;
	listWorktreeGitHistory: RpcProcedureCall<
		AppRPCSchema["requests"]["listWorktreeGitHistory"]["params"],
		AppRPCSchema["requests"]["listWorktreeGitHistory"]["response"]
	>;
	getWorktreeGitCommitDiff: RpcProcedureCall<
		AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["params"],
		AppRPCSchema["requests"]["getWorktreeGitCommitDiff"]["response"]
	>;
	closeWorktree: RpcProcedureCall<
		AppRPCSchema["requests"]["closeWorktree"]["params"],
		AppRPCSchema["requests"]["closeWorktree"]["response"]
	>;
	setWorktreePinned: RpcProcedureCall<
		AppRPCSchema["requests"]["setWorktreePinned"]["params"],
		AppRPCSchema["requests"]["setWorktreePinned"]["response"]
	>;
	listThreads: RpcProcedureCall<
		AppRPCSchema["requests"]["listThreads"]["params"],
		AppRPCSchema["requests"]["listThreads"]["response"]
	>;
	createThread: RpcProcedureCall<
		AppRPCSchema["requests"]["createThread"]["params"],
		AppRPCSchema["requests"]["createThread"]["response"]
	>;
	getThread: RpcProcedureCall<
		AppRPCSchema["requests"]["getThread"]["params"],
		AppRPCSchema["requests"]["getThread"]["response"]
	>;
	markThreadErrorSeen: RpcProcedureCall<
		AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
		AppRPCSchema["requests"]["markThreadErrorSeen"]["response"]
	>;
	sendThreadMessage: RpcProcedureCall<
		AppRPCSchema["requests"]["sendThreadMessage"]["params"],
		AppRPCSchema["requests"]["sendThreadMessage"]["response"]
	>;
	runProjectTask: RpcProcedureCall<
		AppRPCSchema["requests"]["runProjectTask"]["params"],
		AppRPCSchema["requests"]["runProjectTask"]["response"]
	>;
	renameThread: RpcProcedureCall<
		AppRPCSchema["requests"]["renameThread"]["params"],
		AppRPCSchema["requests"]["renameThread"]["response"]
	>;
	setThreadPinned: RpcProcedureCall<
		AppRPCSchema["requests"]["setThreadPinned"]["params"],
		AppRPCSchema["requests"]["setThreadPinned"]["response"]
	>;
	updateThreadModel: RpcProcedureCall<
		AppRPCSchema["requests"]["updateThreadModel"]["params"],
		AppRPCSchema["requests"]["updateThreadModel"]["response"]
	>;
	deleteThread: RpcProcedureCall<
		AppRPCSchema["requests"]["deleteThread"]["params"],
		AppRPCSchema["requests"]["deleteThread"]["response"]
	>;
}
