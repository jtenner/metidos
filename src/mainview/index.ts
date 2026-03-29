import { Electroview } from "electrobun/view";

import type { AppRPCSchema, ProjectProcedures } from "../bun/rpc-schema";

const rpc = Electroview.defineRPC<AppRPCSchema>({
	handlers: {
		requests: {},
		messages: {},
	},
});

new Electroview({ rpc });

const procedures: ProjectProcedures = {
	openProject: rpc.request.openProject.bind(rpc.request),
	closeProject: rpc.request.closeProject.bind(rpc.request),
	listProjectWorktrees: rpc.request.listProjectWorktrees.bind(rpc.request),
	openWorktree: rpc.request.openWorktree.bind(rpc.request),
	closeWorktree: rpc.request.closeWorktree.bind(rpc.request),
};

declare global {
	interface Window {
		jtIdeProcedures: ProjectProcedures;
	}
}

window.jtIdeProcedures = procedures;

const status = document.createElement("p");
status.textContent = "Ready for Bun RPC procedures.";
document.body.appendChild(status);
