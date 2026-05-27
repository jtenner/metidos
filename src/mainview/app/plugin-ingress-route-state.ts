/**
 * @file src/mainview/app/plugin-ingress-route-state.ts
 * @description View-state helpers for Plugin ingress source bindings and user route drafts.
 */

import type {
  RpcPluginAccessGroupOption,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressLinkCode,
  RpcPluginIngressRouteConfig,
  RpcPluginIngressSourceDescriptor,
  RpcPluginInventoryPlugin,
  RpcProject,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import {
  formatDirectoryPathForInput,
  formatPathForDisplay,
} from "./path-display-state";

export type PluginIngressLinkCodeKey = `${string}:${string}`;

export type PluginIngressLinkCodes = Record<
  PluginIngressLinkCodeKey,
  RpcPluginIngressLinkCode
>;

export type PluginIngressRouteDraft = {
  access: ThreadAccessValue;
  model: string;
  projectId: number | null;
  worktreePath: string;
};

export type PluginIngressRouteDrafts = Record<
  PluginIngressLinkCodeKey,
  PluginIngressRouteDraft
>;

export type PendingIngressRouteFolderCreate = {
  draft: PluginIngressRouteDraft;
  pluginId: string;
  sourceId: string;
};

function displayValue(value: string | null | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "Not declared";
}

export function pluginIngressSourcesSummary(
  plugin: RpcPluginInventoryPlugin,
): string {
  const sources = plugin.manifest.ingressSources ?? [];
  if (sources.length === 0) {
    return "No ingress sources declared";
  }
  const namedSources = sources.map((source) =>
    displayValue(source.name ?? source.id),
  );
  const visibleSources = namedSources.slice(0, 3).join(" · ");
  const remaining = sources.length - 3;
  return remaining > 0
    ? `${visibleSources} · +${remaining.toLocaleString()} more`
    : visibleSources;
}

export function pluginIngressIntervalSummary(
  milliseconds: number | null,
): string {
  if (milliseconds === null) {
    return "No poll interval declared";
  }
  if (milliseconds % 60_000 === 0) {
    return `${(milliseconds / 60_000).toLocaleString()} min`;
  }
  if (milliseconds % 1_000 === 0) {
    return `${(milliseconds / 1_000).toLocaleString()} sec`;
  }
  return `${milliseconds.toLocaleString()} ms`;
}

export function pluginIngressLinkCodeKey(
  pluginId: string,
  sourceId: string,
): PluginIngressLinkCodeKey {
  return `${pluginId}:${sourceId}`;
}

export function displayedIngressRouteFolderPath({
  homeDirectory,
  hoveredDirectorySuggestion,
  supportsTildePath,
  worktreePath,
}: {
  homeDirectory: string;
  hoveredDirectorySuggestion: string | null;
  supportsTildePath: boolean;
  worktreePath: string;
}): string {
  return hoveredDirectorySuggestion
    ? formatDirectoryPathForInput(
        hoveredDirectorySuggestion,
        homeDirectory,
        supportsTildePath,
      )
    : formatPathForDisplay(worktreePath, homeDirectory, supportsTildePath);
}

export function defaultIngressRouteAccess(
  permissions: readonly string[] = ["metidos:threads"],
): ThreadAccessValue {
  return {
    agentsAccess: false,
    cronsAccess: false,
    gitAccess: false,
    githubAccess: false,
    metidosAccess: true,
    permissions: [...permissions],
    pluginAccessGroups: [],
    sqliteAccess: false,
    unsafeMode: false,
    webSearchAccess: false,
    webServerAccess: false,
  };
}

function pluginAccessGroupPermissionId(
  group: RpcPluginAccessGroupOption,
): string {
  return `${group.pluginId}:${group.groupId}`;
}

export function sanitizeIngressRoutePermissions(
  permissions: readonly string[],
  availableThreadPermissionDescriptors: readonly RpcThreadPermissionDescriptor[],
  availablePluginAccessGroups: readonly RpcPluginAccessGroupOption[],
): string[] {
  const knownPermissionIds = new Set([
    ...availableThreadPermissionDescriptors.map((descriptor) => descriptor.id),
    ...availablePluginAccessGroups.map(pluginAccessGroupPermissionId),
  ]);
  if (knownPermissionIds.size === 0) {
    return permissions.filter((permission) => permission !== "metidos:unsafe");
  }
  return permissions.filter(
    (permission) =>
      permission !== "metidos:unsafe" && knownPermissionIds.has(permission),
  );
}

export function ingressRouteConfigForSource(
  routes: readonly RpcPluginIngressRouteConfig[],
  pluginId: string,
  sourceId: string,
): RpcPluginIngressRouteConfig | undefined {
  return routes.find(
    (route) => route.pluginId === pluginId && route.sourceId === sourceId,
  );
}

function buildPluginIngressRouteDraft({
  defaultModel,
  fallbackProject,
  route,
}: {
  defaultModel: string;
  fallbackProject: RpcProject | null;
  route: RpcPluginIngressRouteConfig | undefined;
}): PluginIngressRouteDraft {
  return {
    access: defaultIngressRouteAccess(route?.permissions),
    model: route?.model ?? defaultModel,
    projectId: route?.projectId ?? fallbackProject?.id ?? null,
    worktreePath: route?.worktreePath ?? fallbackProject?.path ?? "",
  };
}

export function buildPluginIngressRouteDrafts(
  sources: readonly RpcPluginIngressSourceDescriptor[],
  routes: readonly RpcPluginIngressRouteConfig[],
  projects: readonly RpcProject[],
  defaultModel: string,
): PluginIngressRouteDrafts {
  return reconcilePluginIngressRouteDrafts({
    currentDrafts: {},
    defaultModel,
    preserveCurrentDrafts: false,
    projects,
    routes,
    sources,
  });
}

export function reconcilePluginIngressRouteDrafts({
  currentDrafts,
  defaultModel,
  preserveCurrentDrafts = true,
  projects,
  routes,
  sources,
}: {
  currentDrafts: PluginIngressRouteDrafts;
  defaultModel: string;
  preserveCurrentDrafts?: boolean;
  projects: readonly RpcProject[];
  routes: readonly RpcPluginIngressRouteConfig[];
  sources: readonly RpcPluginIngressSourceDescriptor[];
}): PluginIngressRouteDrafts {
  const nextDrafts: PluginIngressRouteDrafts = {};
  for (const entry of sources) {
    const sourceId = entry.source.id ?? "";
    if (!sourceId) continue;
    const key = pluginIngressLinkCodeKey(entry.pluginId, sourceId);
    const route = ingressRouteConfigForSource(routes, entry.pluginId, sourceId);
    const fallbackProject = projects[0] ?? null;
    nextDrafts[key] =
      preserveCurrentDrafts && currentDrafts[key]
        ? currentDrafts[key]
        : buildPluginIngressRouteDraft({
            defaultModel,
            fallbackProject,
            route,
          });
  }
  return nextDrafts;
}

export function pluginIngressBindingsForSource(
  bindings: readonly RpcPluginIngressExternalBinding[],
  pluginId: string | null,
  sourceId: string | null,
): RpcPluginIngressExternalBinding[] {
  if (!pluginId || !sourceId) return [];
  return bindings.filter(
    (binding) => binding.pluginId === pluginId && binding.sourceId === sourceId,
  );
}

export function pluginIngressBindingStatusText(
  binding: RpcPluginIngressExternalBinding,
): string {
  return binding.enabled ? "Enabled" : "Disabled";
}

export function pluginIngressLinkCodeExpiryText(
  code: Pick<RpcPluginIngressLinkCode, "expiresAt">,
  nowMs = Date.now(),
): string {
  const expiresMs = Date.parse(code.expiresAt);
  if (!Number.isFinite(expiresMs)) return "Expiry unavailable";
  const remainingMs = expiresMs - nowMs;
  if (remainingMs <= 0) return "Expired";
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `Expires in ${minutes} min`;
}
