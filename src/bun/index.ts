import { BrowserView, BrowserWindow } from "electrobun/bun";
import { initAppDatabase } from "./db";
import {
	closeProjectProcedure,
	closeWorktreeProcedure,
	listProjectWorktreesProcedure,
	listProjectsProcedure,
	openProjectProcedure,
	openWorktreeProcedure,
} from "./project-procedures";
import type { AppRPCSchema } from "./rpc-schema";

// Initialize persistent Bun-side app state store on startup.
initAppDatabase();

const rpc = BrowserView.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {
			listProjects: (params) => listProjectsProcedure(params),
			openProject: (params) => openProjectProcedure(params),
			closeProject: (params) => closeProjectProcedure(params),
			listProjectWorktrees: (params) => listProjectWorktreesProcedure(params),
			openWorktree: (params) => openWorktreeProcedure(params),
			closeWorktree: (params) => closeWorktreeProcedure(params),
		},
	},
});

new BrowserWindow({
	title: "jt-ide",
	frame: {
		width: 960,
		height: 640,
		x: 100,
		y: 100,
	},
	titleBarStyle: "default",
	styleMask: {
		Borderless: false,
		Titled: true,
		Closable: true,
		Miniaturizable: true,
		Resizable: true,
		UnifiedTitleAndToolbar: false,
		FullScreen: false,
		FullSizeContentView: false,
		UtilityWindow: false,
		DocModalWindow: false,
		NonactivatingPanel: false,
		HUDWindow: false,
	},
	rpc,
	url: "views://mainview/index.html",
});
