import { resolve } from "node:path";

import type { AppRPCSchema, RpcRequestContext } from "./rpc-schema";

type RequireStepUpInput = {
  actionDescription: string;
  sessionId: string | null;
};

type CreateThreadParams = AppRPCSchema["requests"]["createThread"]["params"];

export function createThreadRequiresStepUp(
  params: CreateThreadParams,
): boolean {
  if (
    typeof params.currentProjectId !== "number" ||
    typeof params.currentWorktreePath !== "string" ||
    params.currentWorktreePath.trim().length === 0
  ) {
    return false;
  }

  return (
    params.projectId !== params.currentProjectId ||
    resolve(params.worktreePath) !== resolve(params.currentWorktreePath)
  );
}

export function enforceRpcStepUp(options: {
  actionDescription: string;
  context: RpcRequestContext;
  onRequireStepUp: (input: RequireStepUpInput) => void;
}): void {
  if (options.context.auth.authBypass) {
    return;
  }

  options.onRequireStepUp({
    actionDescription: options.actionDescription,
    sessionId: options.context.auth.sessionId,
  });
}
