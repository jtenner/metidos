import { Electroview } from "electrobun/view";
import * as React from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";

import type { AppRPCSchema, ProjectProcedures } from "../bun/rpc-schema";
import App from "./App";

const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {},
		messages: {},
	},
});

new Electroview({ rpc });

const procedures: ProjectProcedures = rpc.request;

declare global {
	interface Window {
		jtIdeProcedures: ProjectProcedures;
		__jtIdeAppMountedAt?: number;
	}
}

window.jtIdeProcedures = procedures;

const windowControlBindings: Array<[string, () => void]> = [
	["minimize-window", () => rpc.send.minimizeWindow()],
	["maximize-window", () => rpc.send.toggleMaximizeWindow()],
	["close-window", () => rpc.send.closeWindow()],
];

for (const [id, handler] of windowControlBindings) {
	document.getElementById(id)?.addEventListener("click", (event) => {
		event.preventDefault();
		handler();
	});
}

const appRoot = document.getElementById("app");
if (!appRoot) {
	console.error("Mainview root not found");
	document.body.innerHTML =
		'<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Mainview root missing (id="app").</main>';
} else {
	console.log("React version:", React.version);
	console.log("Mounting React app (App.tsx)");
	const root = createRoot(appRoot);
	try {
		root.render(createElement(App, { procedures }));
	} catch (error) {
		console.error("Failed to mount App.tsx", error);
		window.__jtIdeAppMountedAt = Number.NaN;
		appRoot.innerHTML =
			'<main style="padding:24px;color:#fff;font-family:Arial, sans-serif;">Failed to initialize App UI. Check console for details.</main>';
	}
}
