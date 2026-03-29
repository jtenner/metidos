import { BrowserView, BrowserWindow, Screen } from "electrobun/bun";
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

type WindowFrame = {
	x: number;
	y: number;
	width: number;
	height: number;
};

let mainWindow: BrowserWindow | null = null;
let restoredWindowFrame: WindowFrame | null = null;

const FRAME_TOLERANCE = 1;

function framesMatch(a: WindowFrame, b: WindowFrame): boolean {
	return (
		Math.abs(a.x - b.x) <= FRAME_TOLERANCE &&
		Math.abs(a.y - b.y) <= FRAME_TOLERANCE &&
		Math.abs(a.width - b.width) <= FRAME_TOLERANCE &&
		Math.abs(a.height - b.height) <= FRAME_TOLERANCE
	);
}

function getDisplayWorkArea(frame: WindowFrame): WindowFrame {
	const displays = Screen.getAllDisplays();
	const centerX = frame.x + frame.width / 2;
	const centerY = frame.y + frame.height / 2;

	const display =
		displays.find((entry) => {
			const withinX =
				centerX >= entry.bounds.x &&
				centerX <= entry.bounds.x + entry.bounds.width;
			const withinY =
				centerY >= entry.bounds.y &&
				centerY <= entry.bounds.y + entry.bounds.height;
			return withinX && withinY;
		}) ??
		displays.find((entry) => entry.isPrimary) ??
		Screen.getPrimaryDisplay();

	return display.workArea;
}

function toggleMainWindowMaximize(): void {
	if (!mainWindow) {
		return;
	}

	const currentFrame = mainWindow.getFrame();
	const workArea = getDisplayWorkArea(currentFrame);

	if (framesMatch(currentFrame, workArea)) {
		if (!restoredWindowFrame) {
			return;
		}
		mainWindow.setFrame(
			restoredWindowFrame.x,
			restoredWindowFrame.y,
			restoredWindowFrame.width,
			restoredWindowFrame.height,
		);
		restoredWindowFrame = null;
		return;
	}

	restoredWindowFrame = currentFrame;
	mainWindow.setFrame(workArea.x, workArea.y, workArea.width, workArea.height);
}

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
		messages: {
			closeWindow: () => {
				mainWindow?.close();
			},
			minimizeWindow: () => {
				mainWindow?.minimize();
			},
			toggleMaximizeWindow: () => {
				toggleMainWindowMaximize();
			},
		},
	},
});

mainWindow = new BrowserWindow({
	title: "jt-ide",
	frame: {
		width: 960,
		height: 640,
		x: 100,
		y: 100,
	},
	titleBarStyle: "hidden",
	rpc,
	url: "views://mainview/index.html",
});
