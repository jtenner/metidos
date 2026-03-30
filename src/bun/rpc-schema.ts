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
		closeWorktree: {
			params: { projectId: number; worktreePath: string };
			response: {
				success: boolean;
				projectId: number;
				worktreePath: string;
			};
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

export interface ProjectProcedures {
	getHomeDirectory: (
		params?: AppRPCSchema["requests"]["getHomeDirectory"]["params"],
	) => Promise<AppRPCSchema["requests"]["getHomeDirectory"]["response"]>;
	listDirectorySuggestions: (
		params: AppRPCSchema["requests"]["listDirectorySuggestions"]["params"],
	) => Promise<
		AppRPCSchema["requests"]["listDirectorySuggestions"]["response"]
	>;
	getCodexModelCatalog: (
		params?: AppRPCSchema["requests"]["getCodexModelCatalog"]["params"],
	) => Promise<AppRPCSchema["requests"]["getCodexModelCatalog"]["response"]>;
	listProjects: (
		params?: AppRPCSchema["requests"]["listProjects"]["params"],
	) => Promise<AppRPCSchema["requests"]["listProjects"]["response"]>;
	openProject: (
		params: AppRPCSchema["requests"]["openProject"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	closeProject: (
		params: AppRPCSchema["requests"]["closeProject"]["params"],
	) => Promise<AppRPCSchema["requests"]["closeProject"]["response"]>;
	deleteProject: (
		params: AppRPCSchema["requests"]["deleteProject"]["params"],
	) => Promise<AppRPCSchema["requests"]["deleteProject"]["response"]>;
	listProjectWorktrees: (
		params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	listProjectTasks: (
		params: AppRPCSchema["requests"]["listProjectTasks"]["params"],
	) => Promise<AppRPCSchema["requests"]["listProjectTasks"]["response"]>;
	createWorktree: (
		params: AppRPCSchema["requests"]["createWorktree"]["params"],
	) => Promise<RpcCreateWorktreeResult>;
	openWorktree: (
		params: AppRPCSchema["requests"]["openWorktree"]["params"],
	) => Promise<RpcOpenWorktreeResult>;
	closeWorktree: (
		params: AppRPCSchema["requests"]["closeWorktree"]["params"],
	) => Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]>;
	listThreads: (
		params?: AppRPCSchema["requests"]["listThreads"]["params"],
	) => Promise<AppRPCSchema["requests"]["listThreads"]["response"]>;
	createThread: (
		params: AppRPCSchema["requests"]["createThread"]["params"],
	) => Promise<AppRPCSchema["requests"]["createThread"]["response"]>;
	getThread: (
		params: AppRPCSchema["requests"]["getThread"]["params"],
	) => Promise<AppRPCSchema["requests"]["getThread"]["response"]>;
	markThreadErrorSeen: (
		params: AppRPCSchema["requests"]["markThreadErrorSeen"]["params"],
	) => Promise<AppRPCSchema["requests"]["markThreadErrorSeen"]["response"]>;
	sendThreadMessage: (
		params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
	) => Promise<AppRPCSchema["requests"]["sendThreadMessage"]["response"]>;
	runProjectTask: (
		params: AppRPCSchema["requests"]["runProjectTask"]["params"],
	) => Promise<AppRPCSchema["requests"]["runProjectTask"]["response"]>;
	renameThread: (
		params: AppRPCSchema["requests"]["renameThread"]["params"],
	) => Promise<AppRPCSchema["requests"]["renameThread"]["response"]>;
	setThreadPinned: (
		params: AppRPCSchema["requests"]["setThreadPinned"]["params"],
	) => Promise<AppRPCSchema["requests"]["setThreadPinned"]["response"]>;
	updateThreadModel: (
		params: AppRPCSchema["requests"]["updateThreadModel"]["params"],
	) => Promise<AppRPCSchema["requests"]["updateThreadModel"]["response"]>;
	deleteThread: (
		params: AppRPCSchema["requests"]["deleteThread"]["params"],
	) => Promise<AppRPCSchema["requests"]["deleteThread"]["response"]>;
}
