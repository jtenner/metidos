import { BrowserWindow } from "electrobun/bun";
import { initAppDatabase } from "./db";

// Initialize persistent Bun-side app state store on startup.
initAppDatabase();

new BrowserWindow({
	title: "jt-ide",
	frame: {
		width: 960,
		height: 640,
		x: 100,
		y: 100,
	},
	url: "views://mainview/index.html",
});
