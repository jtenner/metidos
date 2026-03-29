import { Electroview } from "electrobun/view";
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
	}
}

window.jtIdeProcedures = procedures;

const appRoot = document.getElementById("app");
if (!appRoot) {
	throw new Error("Mainview root not found");
}

const root = createRoot(appRoot);
root.render(createElement(App, { procedures }));
