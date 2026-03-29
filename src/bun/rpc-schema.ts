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

export type AppRPCSchema = {
	requests: {
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
		listProjectWorktrees: {
			params: { projectId: number };
			response: RpcProjectWorktreesResult;
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
	};
};

export interface ProjectProcedures {
	listProjects: (
		params?: AppRPCSchema["requests"]["listProjects"]["params"],
	) => Promise<AppRPCSchema["requests"]["listProjects"]["response"]>;
	openProject: (
		params: AppRPCSchema["requests"]["openProject"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	closeProject: (
		params: AppRPCSchema["requests"]["closeProject"]["params"],
	) => Promise<AppRPCSchema["requests"]["closeProject"]["response"]>;
	listProjectWorktrees: (
		params: AppRPCSchema["requests"]["listProjectWorktrees"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	openWorktree: (
		params: AppRPCSchema["requests"]["openWorktree"]["params"],
	) => Promise<RpcOpenWorktreeResult>;
	closeWorktree: (
		params: AppRPCSchema["requests"]["closeWorktree"]["params"],
	) => Promise<AppRPCSchema["requests"]["closeWorktree"]["response"]>;
}
