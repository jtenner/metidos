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

export type RpcThreadRunStatus = {
	state: "idle" | "working" | "failed";
	startedAt: string | null;
	updatedAt: string | null;
	error: string | null;
};

export type RpcThread = {
	id: number;
	projectId: number;
	worktreePath: string;
	title: string;
	codexThreadId: string | null;
	createdAt: string;
	updatedAt: string;
	lastRunAt: string | null;
	runStatus: RpcThreadRunStatus;
};

export type RpcThreadMessage = {
	id: number;
	threadId: number;
	role: "assistant" | "user";
	text: string;
	createdAt: string;
};

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
			params: { projectId: number; worktreePath: string };
			response: RpcThreadDetail;
		};
		getThread: {
			params: { threadId: number };
			response: RpcThreadDetail;
		};
		sendThreadMessage: {
			params: { threadId: number; input: string };
			response: RpcThreadDetail;
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
	sendThreadMessage: (
		params: AppRPCSchema["requests"]["sendThreadMessage"]["params"],
	) => Promise<AppRPCSchema["requests"]["sendThreadMessage"]["response"]>;
}
