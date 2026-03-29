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

type EmptyProtocolMap = Record<string, never>;

export type AppRPCSchema = {
	bun: {
		requests: {
			listProjects: {
				params: {
					includeClosed?: boolean;
				};
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
		messages: {
			closeWindow: undefined;
			minimizeWindow: undefined;
			toggleMaximizeWindow: undefined;
		};
	};
	webview: {
		requests: EmptyProtocolMap;
		messages: EmptyProtocolMap;
	};
};

export interface ProjectProcedures {
	listProjects: (
		params?: AppRPCSchema["bun"]["requests"]["listProjects"]["params"],
	) => Promise<AppRPCSchema["bun"]["requests"]["listProjects"]["response"]>;
	openProject: (
		params: AppRPCSchema["bun"]["requests"]["openProject"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	closeProject: (
		params: AppRPCSchema["bun"]["requests"]["closeProject"]["params"],
	) => Promise<AppRPCSchema["bun"]["requests"]["closeProject"]["response"]>;
	listProjectWorktrees: (
		params: AppRPCSchema["bun"]["requests"]["listProjectWorktrees"]["params"],
	) => Promise<RpcProjectWorktreesResult>;
	openWorktree: (
		params: AppRPCSchema["bun"]["requests"]["openWorktree"]["params"],
	) => Promise<RpcOpenWorktreeResult>;
	closeWorktree: (
		params: AppRPCSchema["bun"]["requests"]["closeWorktree"]["params"],
	) => Promise<AppRPCSchema["bun"]["requests"]["closeWorktree"]["response"]>;
}
