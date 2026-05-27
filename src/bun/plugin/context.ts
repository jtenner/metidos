/**
 * @file src/bun/plugin/context.ts
 * @description Shared Plugin System v1 callback context names and wrong-context errors.
 */

export type PluginCallbackContextKind =
  | "cron"
  | "gc"
  | "global"
  | "init"
  | "notificationProvider"
  | "oauthProvider"
  | "providerConfig"
  | "providerExecution"
  | "startup"
  | "threadTool";

export type PluginContextErrorCode =
  | "plugin_confirmation_unavailable"
  | "plugin_context_error"
  | "plugin_terminal_unavailable_in_cron"
  | "project_context_unavailable";

export class PluginPermissionError extends Error {
  readonly code: string;
  readonly permission: string | null;

  constructor(
    input:
      | { code?: string; message: string; permission?: string | null }
      | string,
  ) {
    if (typeof input === "string") {
      super(input);
      this.code = "permission_denied";
      this.permission = null;
    } else {
      super(input.message);
      this.code = input.code ?? "plugin_permission_error";
      this.permission = input.permission ?? null;
    }
    this.name = "PluginPermissionError";
  }
}

export class PluginContextError extends Error {
  readonly code: PluginContextErrorCode;
  readonly contextKind: string | null;
  readonly virtualPath: string | null;

  constructor(input: {
    code: PluginContextErrorCode;
    contextKind?: string | null;
    message: string;
    virtualPath?: string | null;
  }) {
    super(input.message);
    this.name = "PluginContextError";
    this.code = input.code;
    this.contextKind = input.contextKind ?? null;
    this.virtualPath = input.virtualPath ?? null;
  }
}

export function isThreadProjectPluginContext(
  contextKind: PluginCallbackContextKind,
): boolean {
  return contextKind === "threadTool";
}

export function assertThreadProjectPluginContext(input: {
  contextKind: PluginCallbackContextKind;
  feature: string;
  virtualPath: string;
}): void {
  if (isThreadProjectPluginContext(input.contextKind)) {
    return;
  }
  throw new PluginContextError({
    code: "project_context_unavailable",
    contextKind: input.contextKind,
    message: `Plugin ${input.feature} are available only in thread tool contexts.`,
    virtualPath: input.virtualPath,
  });
}

export function assertPluginProjectRootContext(input: {
  contextKind: PluginCallbackContextKind;
  feature: string;
  projectRootPath?: string | null | undefined;
  threadRootPath?: string | null | undefined;
  virtualPath: string;
}): void {
  assertThreadProjectPluginContext(input);
  if (input.threadRootPath || input.projectRootPath) {
    return;
  }
  throw new PluginContextError({
    code: "project_context_unavailable",
    contextKind: input.contextKind,
    message: `Plugin ${input.feature} require a current thread or project context.`,
    virtualPath: input.virtualPath,
  });
}
