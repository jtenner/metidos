import { AuthServiceError } from "../auth/service";
import {
  createSecurityAuditEvent,
  getProjectById,
  initAppDatabase,
  listProjectWorktreesMetadata,
} from "../db";
import {
  createPluginIngressLinkCode,
  deletePluginIngressExternalBinding,
  getPluginIngressExternalBindingById,
  listPluginIngressExternalBindings,
  listPluginIngressRouteConfigs,
  setPluginIngressExternalBindingEnabled,
  upsertPluginIngressRouteConfig,
  type PluginIngressExternalBindingRecord,
  type PluginIngressRouteConfigRecord,
} from "../plugin/ingress-store";
import {
  buildPluginInventoryWithLifecycle,
  pluginAdminActionRequiresStepUp,
  pluginLifecycleActionRequiresStepUp,
  type PluginAdminRuntimeHooks,
  runPluginAdminAction,
  runPluginLifecycleAction,
} from "../plugin/lifecycle";
import {
  readPluginSettingsSnapshot,
  updatePluginSettings,
} from "../plugin/settings";
import { listAvailablePluginAccessGroupsFromInventory } from "../plugin/tool-access";
import { resolveRunnableCodexModel } from "./model-catalog";
import {
  createThreadPermissionRegistry,
  normalizeThreadPermissions,
  pluginPermissionDescriptorsFromInventory,
} from "../thread-permissions";
import type { AppRPCSchema, RpcRequestContext } from "../rpc-schema";
import {
  getLocalOperatorProfile,
  getLocalOperatorState,
  requireLocalOperatorCapability,
  requireLocalOperatorUserId,
} from "./local-operator";
import {
  assertWorkspacePathAllowed,
  isProjectPathVisibleToOperator,
  normalizeRequestedWorkspacePath,
  workspacePathScopeForLocalOperator,
} from "./workspace-path-policy";

export {
  pluginAdminActionRequiresStepUp,
  pluginLifecycleActionRequiresStepUp,
} from "../plugin/lifecycle";

export async function getPluginInventoryProcedure(
  _params: AppRPCSchema["requests"]["getPluginInventory"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getPluginInventory"]["response"]> {
  requireLocalOperatorCapability(context, "manage_app");
  return await buildPluginInventoryWithLifecycle();
}

export async function listPluginAccessGroupsProcedure(
  _params: AppRPCSchema["requests"]["listPluginAccessGroups"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listPluginAccessGroups"]["response"]> {
  requireLocalOperatorUserId(context);
  const inventory = await buildPluginInventoryWithLifecycle();
  return listAvailablePluginAccessGroupsFromInventory(inventory);
}

export async function listPluginIngressSourcesProcedure(
  _params: AppRPCSchema["requests"]["listPluginIngressSources"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["listPluginIngressSources"]["response"]> {
  requireLocalOperatorUserId(context);
  const inventory = await buildPluginInventoryWithLifecycle();
  return inventory.plugins
    .filter(
      (plugin) =>
        plugin.status === "active" &&
        plugin.structurallyValid &&
        plugin.pluginId !== null &&
        (plugin.manifest.ingressSources?.length ?? 0) > 0,
    )
    .flatMap((plugin) => {
      const pluginId = plugin.pluginId;
      if (pluginId === null) return [];
      return (plugin.manifest.ingressSources ?? [])
        .filter((source) => source.id !== null)
        .map((source) => ({
          pluginId,
          pluginName: plugin.name,
          source,
        }));
    });
}

async function buildPluginSettingsSnapshotProcedure(input: {
  directoryName: string;
  context?: RpcRequestContext | undefined;
}): Promise<AppRPCSchema["requests"]["getPluginSettings"]["response"]> {
  requireLocalOperatorUserId(input.context);
  const inventory = await buildPluginInventoryWithLifecycle();
  const plugin = inventory.plugins.find(
    (candidate) => candidate.directoryName === input.directoryName,
  );
  if (!plugin) {
    throw new Error(`Plugin ${input.directoryName} was not found.`);
  }
  if (!plugin.structurallyValid) {
    throw new Error(
      `Plugin ${input.directoryName} settings are unavailable until the manifest validates.`,
    );
  }
  return await readPluginSettingsSnapshot({
    declarations: plugin.manifest.settings,
    directoryName: plugin.directoryName,
    pluginId: plugin.pluginId,
    readableSecrets: false,
  });
}

export async function getPluginSettingsProcedure(
  params: AppRPCSchema["requests"]["getPluginSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["getPluginSettings"]["response"]> {
  return await buildPluginSettingsSnapshotProcedure({
    context,
    directoryName: params.directoryName,
  });
}

export async function updatePluginSettingsProcedure(
  params: AppRPCSchema["requests"]["updatePluginSettings"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["updatePluginSettings"]["response"]> {
  requireLocalOperatorCapability(context, "manage_app");
  requireLocalOperatorCapability(context, "recent_step_up");
  const inventory = await buildPluginInventoryWithLifecycle();
  const plugin = inventory.plugins.find(
    (candidate) => candidate.directoryName === params.directoryName,
  );
  if (!plugin?.structurallyValid) {
    throw new Error(`Plugin ${params.directoryName} settings are unavailable.`);
  }
  await updatePluginSettings({
    declarations: plugin.manifest.settings,
    directoryName: plugin.directoryName,
    patch: params.values,
    pluginId: plugin.pluginId,
  });
  return await buildPluginSettingsSnapshotProcedure({
    context,
    directoryName: params.directoryName,
  });
}

function mapPluginIngressBinding(
  binding: PluginIngressExternalBindingRecord,
): AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["response"][number] {
  return {
    id: binding.id,
    pluginId: binding.pluginId,
    sourceId: binding.sourceId,
    externalUserId: binding.externalUserId,
    enabled: binding.enabled,
    createdAt: binding.createdAt,
    updatedAt: binding.updatedAt,
  };
}

function mapPluginIngressRouteConfig(
  route: PluginIngressRouteConfigRecord,
): AppRPCSchema["requests"]["listPluginIngressRouteConfigs"]["response"][number] {
  return {
    id: route.id,
    pluginId: route.pluginId,
    sourceId: route.sourceId,
    projectId: route.projectId,
    worktreePath: route.worktreePath,
    model: route.model,
    permissions: route.permissions,
    enabled: route.enabled,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
  };
}

function assertIngressBindingMutationAllowed(
  binding: PluginIngressExternalBindingRecord | null,
  context?: RpcRequestContext,
): PluginIngressExternalBindingRecord {
  requireLocalOperatorUserId(context);
  if (!binding) {
    throw new Error("Plugin ingress binding was not found.");
  }
  return binding;
}

function listBindingsForContext(
  params:
    | AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["params"]
    | undefined,
  context?: RpcRequestContext,
): AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["response"] {
  requireLocalOperatorUserId(context);
  return listPluginIngressExternalBindings(initAppDatabase(), {
    pluginId: params?.pluginId ?? null,
    sourceId: params?.sourceId ?? null,
  }).map(mapPluginIngressBinding);
}

export async function createPluginIngressLinkCodeProcedure(
  params: AppRPCSchema["requests"]["createPluginIngressLinkCode"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["createPluginIngressLinkCode"]["response"]
> {
  requireLocalOperatorUserId(context);
  const metidosUserId = getLocalOperatorProfile(context).userId;
  const { code, record } = createPluginIngressLinkCode(initAppDatabase(), {
    pluginId: params.pluginId,
    sourceId: params.sourceId,
    metidosUserId,
  });
  return {
    pluginId: record.pluginId,
    sourceId: record.sourceId,
    code,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

export async function listPluginIngressExternalBindingsProcedure(
  params: AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["listPluginIngressExternalBindings"]["response"]
> {
  return listBindingsForContext(params, context);
}

export async function listPluginIngressRouteConfigsProcedure(
  params: AppRPCSchema["requests"]["listPluginIngressRouteConfigs"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["listPluginIngressRouteConfigs"]["response"]
> {
  requireLocalOperatorUserId(context);
  return listPluginIngressRouteConfigs(initAppDatabase(), {
    pluginId: params?.pluginId ?? null,
    sourceId: params?.sourceId ?? null,
  }).map(mapPluginIngressRouteConfig);
}

function normalizeIngressRouteWorktreePath(
  requestedWorktreePath: string,
  context?: RpcRequestContext,
): string {
  const scope = workspacePathScopeForLocalOperator(
    getLocalOperatorState(context),
  );
  const normalizedWorktreePath = normalizeRequestedWorkspacePath(
    requestedWorktreePath,
    scope,
  );
  assertWorkspacePathAllowed(normalizedWorktreePath, scope);
  return normalizedWorktreePath;
}

export async function upsertPluginIngressRouteConfigProcedure(
  params: AppRPCSchema["requests"]["upsertPluginIngressRouteConfig"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["upsertPluginIngressRouteConfig"]["response"]
> {
  requireLocalOperatorUserId(context);
  const database = initAppDatabase();
  const project = getProjectById(database, params.projectId);
  if (
    !project ||
    !isProjectPathVisibleToOperator(
      project.path,
      getLocalOperatorState(context),
    )
  ) {
    throw new AuthServiceError(
      "forbidden",
      "Ingress route project is not available to the current user.",
      403,
    );
  }
  const normalizedWorktreePath = normalizeIngressRouteWorktreePath(
    params.worktreePath,
    context,
  );
  const knownWorktree = listProjectWorktreesMetadata(database, project.id).some(
    (worktree) => worktree.worktreePath === normalizedWorktreePath,
  );
  if (normalizedWorktreePath !== project.path && !knownWorktree) {
    throw new Error("Ingress route worktree is not tracked for this project.");
  }
  const model = params.model?.trim()
    ? resolveRunnableCodexModel(params.model)
    : null;
  const inventory = await buildPluginInventoryWithLifecycle();
  const permissions = normalizeThreadPermissions(
    params.permissions,
    createThreadPermissionRegistry({
      pluginDescriptors: pluginPermissionDescriptorsFromInventory(inventory),
    }),
  );
  if (permissions.includes("metidos:unsafe")) {
    throw new AuthServiceError(
      "forbidden",
      "Ingress route permissions cannot include unsafe access.",
      403,
    );
  }
  const route = upsertPluginIngressRouteConfig(database, {
    pluginId: params.pluginId,
    sourceId: params.sourceId,
    projectId: params.projectId,
    worktreePath: normalizedWorktreePath,
    model,
    permissions,
    enabled: params.enabled,
  });
  return mapPluginIngressRouteConfig(route);
}

export async function setPluginIngressExternalBindingEnabledProcedure(
  params: AppRPCSchema["requests"]["setPluginIngressExternalBindingEnabled"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["setPluginIngressExternalBindingEnabled"]["response"]
> {
  const database = initAppDatabase();
  const binding = assertIngressBindingMutationAllowed(
    getPluginIngressExternalBindingById(database, params.id),
    context,
  );
  const updated = setPluginIngressExternalBindingEnabled(
    database,
    binding.id,
    params.enabled,
  );
  if (!updated) throw new Error("Plugin ingress binding was not found.");
  return {
    binding: mapPluginIngressBinding(updated),
    bindings: listBindingsForContext(undefined, context),
  };
}

export async function deletePluginIngressExternalBindingProcedure(
  params: AppRPCSchema["requests"]["deletePluginIngressExternalBinding"]["params"],
  context?: RpcRequestContext,
): Promise<
  AppRPCSchema["requests"]["deletePluginIngressExternalBinding"]["response"]
> {
  const database = initAppDatabase();
  const binding = assertIngressBindingMutationAllowed(
    getPluginIngressExternalBindingById(database, params.id),
    context,
  );
  const deleted = deletePluginIngressExternalBinding(database, binding.id);
  if (!deleted) throw new Error("Plugin ingress binding was not found.");
  return {
    binding: mapPluginIngressBinding(deleted),
    bindings: listBindingsForContext(undefined, context),
  };
}

export async function runPluginLifecycleActionProcedure(
  params: AppRPCSchema["requests"]["runPluginLifecycleAction"]["params"],
  context?: RpcRequestContext,
): Promise<AppRPCSchema["requests"]["runPluginLifecycleAction"]["response"]> {
  requireLocalOperatorCapability(context, "manage_app");
  if (pluginLifecycleActionRequiresStepUp(params.action)) {
    requireLocalOperatorCapability(context, "recent_step_up");
  }
  return await runPluginLifecycleAction(params, {
    stepUpVerified: true,
    username: getLocalOperatorProfile(context).username,
  });
}

export async function runPluginAdminActionProcedure(
  params: AppRPCSchema["requests"]["runPluginAdminAction"]["params"],
  context?: RpcRequestContext,
  runtimeHooks: PluginAdminRuntimeHooks = {},
): Promise<AppRPCSchema["requests"]["runPluginAdminAction"]["response"]> {
  requireLocalOperatorCapability(context, "manage_app");
  if (pluginAdminActionRequiresStepUp(params.action)) {
    requireLocalOperatorCapability(context, "recent_step_up");
  }
  return await runPluginAdminAction(params, {
    ...runtimeHooks,
    stepUpVerified: true,
    recordPluginDataResetAudit: async (input) => {
      await runtimeHooks.recordPluginDataResetAudit?.(input);
      createSecurityAuditEvent(initAppDatabase(), {
        eventType: "plugin_data_reset",
        payloadJson: JSON.stringify({
          backupPath: input.backupPath,
          dataPath: input.dataPath,
          directoryName: input.directoryName,
          pluginId: input.pluginId,
        }),
        summaryText: `Plugin data reset for ${input.directoryName}`,
      });
    },
    username: getLocalOperatorProfile(context).username,
  });
}
