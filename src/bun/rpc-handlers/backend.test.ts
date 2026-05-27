import { describe, expect, it } from "bun:test";

import type { RpcRequestContext } from "../rpc-schema";
import type { RpcRequestHandlerMap } from "../rpc-transport";
import {
  createBackendRpcHandlers,
  type BackendRpcHandlerDependencies,
} from "./backend";

const requestContext = {} as RpcRequestContext;

const expectedRpcMethods = [
  "approveThreadStartRequest",
  "closeProject",
  "closeTerminal",
  "closeWorktree",
  "createCalendar",
  "createCalendarEvent",
  "createExternalIcsCalendar",
  "createPluginIngressLinkCode",
  "createTerminal",
  "createThread",
  "createWorktree",
  "deleteCalendar",
  "deleteCalendarEvent",
  "deleteExternalIcsCalendar",
  "deletePluginIngressExternalBinding",
  "deleteProject",
  "deleteThread",
  "discardEmptyThread",
  "dismissCalendarNotification",
  "dismissUserNotification",
  "focusContext",
  "getAppBootstrap",
  "getCalendarBootstrap",
  "getHomeDirectory",
  "getModelCatalog",
  "getPluginInventory",
  "getPluginSecurityDiagnostics",
  "getPluginSettings",
  "getPluginSidecarDiagnostics",
  "getTerminalSettings",
  "getThread",
  "getThreadMessageContent",
  "getTimezoneSettings",
  "getUserRuntimeSettings",
  "getWorktreeGitCommitDiff",
  "getWorktreeSnapshot",
  "leaveSharedCalendar",
  "listCalendarNotifications",
  "listCalendarOccurrences",
  "listCrons",
  "listDirectorySuggestions",
  "listPluginAccessGroups",
  "listPluginIngressExternalBindings",
  "listPluginIngressRouteConfigs",
  "listPluginIngressSources",
  "listProjectFavicons",
  "listProjectSkills",
  "listProjectWorktrees",
  "listProjects",
  "listTerminals",
  "listThreadStatuses",
  "listThreads",
  "listUserNotifications",
  "listWorktreeGitHistory",
  "logClientEvent",
  "markThreadErrorSeen",
  "newCron",
  "openProject",
  "openProjectsBatch",
  "openWorktree",
  "openWorktreesBatch",
  "readWorktreeFileContentPage",
  "readWorktreeFileDiff",
  "refreshExternalIcsCalendar",
  "renameTerminal",
  "renameThread",
  "requestThreadStart",
  "respondThreadExtensionUi",
  "runCronNow",
  "runPluginAdminAction",
  "runPluginLifecycleAction",
  "sendThreadMessage",
  "setActiveWorktree",
  "setCalendarShare",
  "setPluginIngressExternalBindingEnabled",
  "setThreadPinned",
  "setWorktreePinned",
  "snoozeCalendarNotification",
  "stopThreadTurn",
  "updateCalendar",
  "updateCalendarEvent",
  "updateCalendarNotificationSettings",
  "updateCalendarPreference",
  "updateCron",
  "updateExternalIcsCalendar",
  "updatePluginSettings",
  "updateTerminalSettings",
  "updateThreadAccess",
  "updateThreadExtensionEditor",
  "updateThreadMetadata",
  "updateThreadModel",
  "updateThreadReasoningEffort",
  "updateTimezoneSettings",
  "updateUserRuntimeSettings",
  "upsertPluginIngressRouteConfig",
] satisfies Array<keyof RpcRequestHandlerMap>;

function createDependencies(
  overrides: Partial<BackendRpcHandlerDependencies> = {},
) {
  const calls: Array<{
    name: string;
    args: unknown[];
  }> = [];
  const dependencies = new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") {
          return undefined;
        }
        if (property in overrides) {
          return overrides[property as keyof BackendRpcHandlerDependencies];
        }
        return (...args: unknown[]) => {
          calls.push({ name: property, args });
          return { id: 0 };
        };
      },
    },
  ) as BackendRpcHandlerDependencies;

  return { calls, dependencies };
}

describe("createBackendRpcHandlers", () => {
  it("registers the complete backend RPC surface through domain registrars", () => {
    const { dependencies } = createDependencies();
    const handlers = createBackendRpcHandlers(dependencies);

    expect(Object.keys(handlers).sort()).toEqual(
      [...expectedRpcMethods].sort(),
    );
  });

  it("delegates app bootstrap handlers through the composed registrar", async () => {
    const bootstrapResult = { projects: [] } as unknown as Awaited<
      ReturnType<RpcRequestHandlerMap["getAppBootstrap"]>
    >;
    const clientLogResult = { accepted: true, id: 17 } as Awaited<
      ReturnType<RpcRequestHandlerMap["logClientEvent"]>
    >;
    const { calls, dependencies } = createDependencies({
      getAppBootstrapProcedure: (params, context) => {
        calls.push({
          name: "getAppBootstrapProcedure",
          args: [params, context],
        });
        return Promise.resolve(bootstrapResult);
      },
      logClientEventProcedure: (params, context) => {
        calls.push({
          name: "logClientEventProcedure",
          args: [params, context],
        });
        return Promise.resolve(clientLogResult);
      },
    });
    const handlers = createBackendRpcHandlers(dependencies);

    await expect(
      handlers.getAppBootstrap({ refresh: true } as never, requestContext),
    ).resolves.toBe(bootstrapResult);
    await expect(
      handlers.logClientEvent({ event: "loaded" } as never, requestContext),
    ).resolves.toBe(clientLogResult);
    expect(calls.map((call) => call.name)).toEqual([
      "getAppBootstrapProcedure",
      "logClientEventProcedure",
    ]);
  });

  it("preserves cross-domain side effects from composed registrars", async () => {
    const sideEffects: string[] = [];
    const { dependencies } = createDependencies({
      getModelCatalogProcedure: async () => ({ providers: [] }) as never,
      newCronProcedure: async () => ({ id: 51 }) as never,
      refreshPluginModelProviderRegistrationsIfDue: () => {
        sideEffects.push("refresh-plugin-model-providers-if-due");
      },
      refreshPluginModelProvidersForCatalog: async () => {
        sideEffects.push("refresh-plugin-model-providers-for-catalog");
      },
      syncCronSchedulerCron: (cronId) => {
        sideEffects.push(`sync-cron-${cronId}`);
      },
    });
    const handlers = createBackendRpcHandlers(dependencies);

    await handlers.getModelCatalog(undefined, requestContext);
    await handlers.getModelCatalog({ refreshProviders: true }, requestContext);
    await handlers.newCron({} as never, requestContext);

    expect(sideEffects).toEqual([
      "refresh-plugin-model-providers-if-due",
      "refresh-plugin-model-providers-for-catalog",
      "sync-cron-51",
    ]);
  });
});
