/**
 * @file src/mainview/app/use-plugin-administration-controller.ts
 * @description Controller hook for Settings Plugin administration workflow state and commands.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProjectProcedures,
  RpcModelCatalog,
  RpcModelOption,
  RpcPluginAccessGroupOption,
  RpcPluginAdminAction,
  RpcPluginIngressExternalBinding,
  RpcPluginIngressRouteConfig,
  RpcPluginIngressSourceDescriptor,
  RpcPluginInventory,
  RpcPluginInventoryPlugin,
  RpcPluginLifecycleAction,
  RpcPluginSidecarDiagnostics,
  RpcProject,
  RpcRequestPriority,
  RpcThreadPermissionDescriptor,
} from "../../bun/rpc-schema";
import { stepUpAuth } from "../auth-client";
import { logClientError } from "../client-logging";
import type { ThreadAccessValue } from "../controls/thread-access-control";
import { isStepUpRequiredRpcError } from "../rpc-errors";
import {
  buildPluginIngressRouteDrafts,
  defaultIngressRouteAccess,
  pluginIngressLinkCodeKey,
  reconcilePluginIngressRouteDrafts,
  sanitizeIngressRoutePermissions,
  type PendingIngressRouteFolderCreate,
  type PluginIngressLinkCodeKey,
  type PluginIngressLinkCodes,
  type PluginIngressRouteDraft,
  type PluginIngressRouteDrafts,
} from "./plugin-ingress-route-state";
import {
  pluginInventoryAttentionState,
  pluginsWithDeclaredSettings,
  shouldLoadSettingsPluginInventory,
} from "./plugin-inventory-state";
import {
  clearPluginActionKey,
  pluginAdminActionKey,
  pluginLifecycleActionKey as buildPluginLifecycleActionKey,
} from "./plugin-lifecycle-action-state";
import {
  buildPluginSettingsPatchRecords,
  pluginSettingsFormValuesFromSnapshot,
  type PluginSettingFormValue,
  type PluginSettingFormValues,
  type PluginSettingsSnapshots,
} from "./plugin-settings-form-state";
import {
  shouldLoadUserIngressSettings,
  type PluginInventorySectionProps,
  type UserIngressSourcesSectionProps,
} from "./plugin-administration-panel";
import { shouldPromptToCreateProjectFolder } from "./use-add-project-form";

export type PendingPluginStepUpAction =
  | {
      action: RpcPluginLifecycleAction;
      kind: "lifecycle";
      plugin: RpcPluginInventoryPlugin;
    }
  | {
      action: RpcPluginAdminAction;
      confirmation?: string;
      kind: "admin";
      plugin: RpcPluginInventoryPlugin;
    }
  | {
      kind: "settings";
    };

export type PluginSettingsInventoryLoadState = {
  errors: Record<string, string>;
  snapshots: PluginSettingsSnapshots;
  status: string;
  values: PluginSettingFormValues;
};

type PluginAdministrationControllerOptions = {
  active: boolean;
  availablePluginAccessGroups: RpcPluginAccessGroupOption[];
  availableThreadPermissionDescriptors: RpcThreadPermissionDescriptor[];
  codexModels: RpcModelOption[];
  defaultCodexModel: string;
  homeDirectory: string;
  isAdmin: boolean;
  onModelCatalogChange: (modelCatalog: RpcModelCatalog) => void;
  onPluginAccessGroupsChange?:
    | ((groups: RpcPluginAccessGroupOption[]) => void)
    | undefined;
  open: boolean;
  procedures: ProjectProcedures;
  supportsTildePath: boolean;
};

function toDisplayError(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error ?? "Unknown error");
}

export function retryPendingPluginStepUpAction({
  actionToRetry,
  executePluginAdminAction,
  executePluginLifecycleAction,
  savePluginSettings,
}: {
  actionToRetry: PendingPluginStepUpAction;
  executePluginAdminAction: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginAdminAction,
    confirmation?: string,
  ) => void;
  executePluginLifecycleAction: (
    plugin: RpcPluginInventoryPlugin,
    action: RpcPluginLifecycleAction,
  ) => void;
  savePluginSettings: () => void;
}): void {
  if (actionToRetry.kind === "lifecycle") {
    executePluginLifecycleAction(actionToRetry.plugin, actionToRetry.action);
    return;
  }
  if (actionToRetry.kind === "admin") {
    executePluginAdminAction(
      actionToRetry.plugin,
      actionToRetry.action,
      actionToRetry.confirmation,
    );
    return;
  }
  savePluginSettings();
}

export async function loadPluginSettingsStateForInventory({
  inventory,
  priority = "default",
  procedures,
}: {
  inventory: RpcPluginInventory;
  priority?: RpcRequestPriority;
  procedures: ProjectProcedures;
}): Promise<PluginSettingsInventoryLoadState> {
  const plugins = pluginsWithDeclaredSettings(inventory);
  if (plugins.length === 0) {
    return {
      errors: {},
      snapshots: {},
      status: "",
      values: {},
    };
  }

  const entries = await Promise.all(
    plugins.map(async (plugin) => {
      try {
        const snapshot = await procedures.getPluginSettings(
          { directoryName: plugin.directoryName },
          { priority },
        );
        return { plugin, snapshot } as const;
      } catch (error) {
        return { error: toDisplayError(error), plugin } as const;
      }
    }),
  );
  const snapshotEntries = entries.flatMap((entry) =>
    "snapshot" in entry
      ? ([[entry.plugin.directoryName, entry.snapshot]] as const)
      : [],
  );
  const errorEntries = entries.flatMap((entry) =>
    "error" in entry
      ? ([[entry.plugin.directoryName, entry.error]] as const)
      : [],
  );
  const snapshots = Object.fromEntries(snapshotEntries);
  const errors = Object.fromEntries(errorEntries);

  return {
    errors,
    snapshots,
    status:
      errorEntries.length > 0
        ? `Failed to load settings for ${errorEntries.length} plugin${
            errorEntries.length === 1 ? "" : "s"
          }.`
        : "",
    values: Object.fromEntries(
      snapshotEntries.map(([directoryName, snapshot]) => [
        directoryName,
        pluginSettingsFormValuesFromSnapshot(snapshot),
      ]),
    ),
  };
}

export function usePluginAdministrationController({
  active,
  availablePluginAccessGroups,
  availableThreadPermissionDescriptors,
  codexModels,
  defaultCodexModel,
  homeDirectory,
  isAdmin,
  onModelCatalogChange,
  onPluginAccessGroupsChange,
  open,
  procedures,
  supportsTildePath,
}: PluginAdministrationControllerOptions) {
  const [pluginInventory, setPluginInventory] =
    useState<RpcPluginInventory | null>(null);
  const [pluginSidecarDiagnostics, setPluginSidecarDiagnostics] = useState<
    RpcPluginSidecarDiagnostics[]
  >([]);
  const [pluginSettingsSnapshots, setPluginSettingsSnapshots] =
    useState<PluginSettingsSnapshots>({});
  const [pluginSettingsValues, setPluginSettingsValues] =
    useState<PluginSettingFormValues>({});
  const [pluginSettingsErrors, setPluginSettingsErrors] = useState<
    Record<string, string>
  >({});
  const [pluginSettingsStatus, setPluginSettingsStatus] = useState("");
  const [pluginInventoryLoading, setPluginInventoryLoading] = useState(false);
  const [pluginInventoryError, setPluginInventoryError] = useState("");
  const [
    acknowledgedPluginAttentionFingerprint,
    setAcknowledgedPluginAttentionFingerprint,
  ] = useState<string | null>(null);
  const [pluginLifecycleActionKey, setPluginLifecycleActionKey] = useState<
    string | null
  >(null);
  const [pluginLifecycleActionMessage, setPluginLifecycleActionMessage] =
    useState("");
  const [pluginLifecycleActionError, setPluginLifecycleActionError] =
    useState("");
  const [pendingPluginStepUpAction, setPendingPluginStepUpAction] =
    useState<PendingPluginStepUpAction | null>(null);
  const [stepUpPrimaryFactor, setStepUpPrimaryFactor] = useState("");
  const [stepUpTotpCode, setStepUpTotpCode] = useState("");
  const [stepUpError, setStepUpError] = useState("");
  const [stepUpLoading, setStepUpLoading] = useState(false);
  const [pluginIngressBindings, setPluginIngressBindings] = useState<
    RpcPluginIngressExternalBinding[]
  >([]);
  const [pendingIngressBindingDelete, setPendingIngressBindingDelete] =
    useState<RpcPluginIngressExternalBinding | null>(null);
  const [userPluginIngressBindings, setUserPluginIngressBindings] = useState<
    RpcPluginIngressExternalBinding[]
  >([]);
  const [pluginIngressSources, setPluginIngressSources] = useState<
    RpcPluginIngressSourceDescriptor[]
  >([]);
  const [pluginIngressSourcesLoading, setPluginIngressSourcesLoading] =
    useState(false);
  const [pluginIngressLinkCodes, setPluginIngressLinkCodes] =
    useState<PluginIngressLinkCodes>({});
  const [pluginIngressRouteConfigs, setPluginIngressRouteConfigs] = useState<
    RpcPluginIngressRouteConfig[]
  >([]);
  const [ingressRouteProjects, setIngressRouteProjects] = useState<
    RpcProject[]
  >([]);
  const [pluginIngressRouteDrafts, setPluginIngressRouteDrafts] =
    useState<PluginIngressRouteDrafts>({});
  const [pendingIngressRouteFolderCreate, setPendingIngressRouteFolderCreate] =
    useState<PendingIngressRouteFolderCreate | null>(null);
  const [routeDirectorySuggestions, setRouteDirectorySuggestions] = useState<
    string[]
  >([]);
  const [
    routeDirectorySuggestionsLoading,
    setRouteDirectorySuggestionsLoading,
  ] = useState(false);
  const [routeDirectorySuggestionsKey, setRouteDirectorySuggestionsKey] =
    useState<PluginIngressLinkCodeKey | null>(null);
  const [hoveredRouteDirectorySuggestion, setHoveredRouteDirectorySuggestion] =
    useState<string | null>(null);
  const pluginInventorySilentLoadInFlightRef = useRef(false);
  const pluginSettingsLoadGenerationRef = useRef(0);
  const pluginSettingsEditGenerationRef = useRef(0);
  const pluginSettingsSaveInFlightCountRef = useRef(0);

  const loadPluginSidecarDiagnostics = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      if (!isAdmin) {
        setPluginSidecarDiagnostics([]);
        return;
      }
      try {
        const result = await procedures.getPluginSidecarDiagnostics(undefined, {
          priority: options?.priority ?? "default",
        });
        setPluginSidecarDiagnostics(result);
      } catch {
        setPluginSidecarDiagnostics([]);
      }
    },
    [isAdmin, procedures],
  );

  const loadPluginIngressBindings = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      if (!isAdmin) {
        setPluginIngressBindings([]);
        setPluginIngressLinkCodes({});
        return;
      }
      try {
        const bindings = await procedures.listPluginIngressExternalBindings(
          undefined,
          { priority: options?.priority ?? "default" },
        );
        setPluginIngressBindings(bindings);
      } catch (error) {
        setPluginLifecycleActionError(toDisplayError(error));
      }
    },
    [isAdmin, procedures],
  );

  const loadUserIngressSettings = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      setPluginIngressSourcesLoading(true);
      try {
        const [sources, bindings, routeConfigs, projects] = await Promise.all([
          procedures.listPluginIngressSources(undefined, {
            priority: options?.priority ?? "default",
          }),
          procedures.listPluginIngressExternalBindings(
            { currentUserOnly: true },
            { priority: options?.priority ?? "default" },
          ),
          procedures.listPluginIngressRouteConfigs(
            { currentUserOnly: true },
            { priority: options?.priority ?? "default" },
          ),
          procedures.listProjects(
            { includeClosed: false },
            { priority: options?.priority ?? "default" },
          ),
        ]);
        setPluginIngressSources(sources);
        setUserPluginIngressBindings(bindings);
        setPluginIngressRouteConfigs(routeConfigs);
        setIngressRouteProjects(projects);
        setPluginIngressRouteDrafts(
          buildPluginIngressRouteDrafts(
            sources,
            routeConfigs,
            projects,
            defaultCodexModel,
          ),
        );
        setPluginLifecycleActionError("");
      } catch (error) {
        setPluginLifecycleActionError(toDisplayError(error));
      } finally {
        setPluginIngressSourcesLoading(false);
      }
    },
    [defaultCodexModel, procedures],
  );

  useEffect(() => {
    setPluginIngressRouteDrafts((currentDrafts) =>
      reconcilePluginIngressRouteDrafts({
        currentDrafts,
        defaultModel: defaultCodexModel,
        projects: ingressRouteProjects,
        routes: pluginIngressRouteConfigs,
        sources: pluginIngressSources,
      }),
    );
  }, [
    defaultCodexModel,
    ingressRouteProjects,
    pluginIngressRouteConfigs,
    pluginIngressSources,
  ]);

  const loadPluginSettingsForInventory = useCallback(
    async (
      inventory: RpcPluginInventory,
      options?: { priority?: RpcRequestPriority },
    ): Promise<void> => {
      const loadGeneration = ++pluginSettingsLoadGenerationRef.current;
      const editGeneration = pluginSettingsEditGenerationRef.current;
      const plugins = pluginsWithDeclaredSettings(inventory);
      if (plugins.length === 0) {
        setPluginSettingsSnapshots({});
        setPluginSettingsValues({});
        setPluginSettingsErrors({});
        setPluginSettingsStatus("");
        return;
      }
      setPluginSettingsErrors({});
      setPluginSettingsStatus("Loading plugin settings...");
      const settingsState = await loadPluginSettingsStateForInventory({
        inventory,
        priority: options?.priority ?? "default",
        procedures,
      });
      if (
        loadGeneration !== pluginSettingsLoadGenerationRef.current ||
        editGeneration !== pluginSettingsEditGenerationRef.current ||
        pluginSettingsSaveInFlightCountRef.current > 0
      ) {
        return;
      }
      setPluginSettingsSnapshots(settingsState.snapshots);
      setPluginSettingsValues(settingsState.values);
      setPluginSettingsErrors(settingsState.errors);
      setPluginSettingsStatus(settingsState.status);
    },
    [procedures],
  );

  const loadPluginInventory = useCallback(
    async (options?: {
      includeDetails?: boolean;
      priority?: RpcRequestPriority;
      silent?: boolean;
    }): Promise<RpcPluginInventory | null> => {
      if (options?.silent && pluginInventorySilentLoadInFlightRef.current) {
        return null;
      }
      if (options?.silent) {
        pluginInventorySilentLoadInFlightRef.current = true;
      } else {
        setPluginInventoryLoading(true);
      }
      try {
        const result = await procedures.getPluginInventory(undefined, {
          priority: options?.priority ?? "default",
        });
        setPluginInventory(result);
        setPluginInventoryError("");
        if (options?.includeDetails !== false) {
          await loadPluginSidecarDiagnostics({
            priority: options?.priority ?? "default",
          });
          await loadPluginIngressBindings({
            priority: options?.priority ?? "default",
          });
          await loadPluginSettingsForInventory(result, {
            priority: options?.priority ?? "default",
          });
        }
        if (onPluginAccessGroupsChange) {
          const groups = await procedures.listPluginAccessGroups(undefined, {
            priority: options?.priority ?? "default",
          });
          onPluginAccessGroupsChange(groups);
        }
        return result;
      } catch (error) {
        setPluginInventoryError(toDisplayError(error));
        return null;
      } finally {
        if (options?.silent) {
          pluginInventorySilentLoadInFlightRef.current = false;
        } else {
          setPluginInventoryLoading(false);
        }
      }
    },
    [
      loadPluginIngressBindings,
      loadPluginSettingsForInventory,
      loadPluginSidecarDiagnostics,
      onPluginAccessGroupsChange,
      procedures,
    ],
  );

  const updatePluginSettingFormValue = useCallback(
    (
      directoryName: string,
      key: string,
      value: PluginSettingFormValue,
    ): void => {
      pluginSettingsEditGenerationRef.current += 1;
      setPluginSettingsValues((currentValues) => ({
        ...currentValues,
        [directoryName]: {
          ...(currentValues[directoryName] ?? {}),
          [key]: value,
        },
      }));
    },
    [],
  );

  const savePluginSettings = useCallback(
    async (options?: {
      priority?: RpcRequestPriority;
      promptForStepUp?: boolean;
    }): Promise<void> => {
      const plugins = pluginsWithDeclaredSettings(pluginInventory);
      if (plugins.length === 0) {
        return;
      }
      const pluginPatches = buildPluginSettingsPatchRecords({
        plugins,
        snapshots: pluginSettingsSnapshots,
        values: pluginSettingsValues,
      });
      if (pluginPatches.length === 0) {
        setPluginSettingsStatus("");
        return;
      }
      setPluginSettingsStatus("");
      const editGeneration = pluginSettingsEditGenerationRef.current;
      pluginSettingsSaveInFlightCountRef.current += 1;
      try {
        const updatedSnapshots: PluginSettingsSnapshots = {};
        for (const { patch, plugin } of pluginPatches) {
          const snapshot = await procedures.updatePluginSettings(
            {
              directoryName: plugin.directoryName,
              values: patch,
            },
            { priority: options?.priority ?? "foreground" },
          );
          updatedSnapshots[plugin.directoryName] = snapshot;
        }
        setPluginSettingsSnapshots((currentSnapshots) => ({
          ...currentSnapshots,
          ...updatedSnapshots,
        }));
        if (editGeneration === pluginSettingsEditGenerationRef.current) {
          setPluginSettingsValues((currentValues) => ({
            ...currentValues,
            ...Object.fromEntries(
              Object.entries(updatedSnapshots).map(
                ([directoryName, snapshot]) => [
                  directoryName,
                  pluginSettingsFormValuesFromSnapshot(snapshot),
                ],
              ),
            ),
          }));
        }
        setPluginSettingsStatus("");
      } catch (error) {
        if (options?.promptForStepUp && isStepUpRequiredRpcError(error)) {
          setPendingPluginStepUpAction({ kind: "settings" });
          setStepUpError("");
          setStepUpPrimaryFactor("");
          setStepUpTotpCode("");
          setPluginSettingsStatus(
            "Recent authentication is required to save plugin settings.",
          );
          return;
        }
        setPluginSettingsStatus(toDisplayError(error));
        throw error;
      } finally {
        pluginSettingsSaveInFlightCountRef.current = Math.max(
          0,
          pluginSettingsSaveInFlightCountRef.current - 1,
        );
      }
    },
    [
      pluginInventory,
      pluginSettingsSnapshots,
      pluginSettingsValues,
      procedures,
    ],
  );

  const refreshPluginAccessGroups = useCallback(
    async (options?: { priority?: RpcRequestPriority }): Promise<void> => {
      if (!onPluginAccessGroupsChange) {
        return;
      }
      const groups = await procedures.listPluginAccessGroups(undefined, {
        priority: options?.priority ?? "default",
      });
      onPluginAccessGroupsChange(groups);
    },
    [onPluginAccessGroupsChange, procedures],
  );

  const executePluginLifecycleAction = useCallback(
    async (
      plugin: RpcPluginInventoryPlugin,
      action: RpcPluginLifecycleAction,
      options?: { promptForStepUp?: boolean },
    ): Promise<void> => {
      const actionKey = buildPluginLifecycleActionKey(plugin, action);
      setPluginLifecycleActionKey(actionKey);
      setPluginLifecycleActionMessage("");
      setPluginLifecycleActionError("");
      try {
        const result = await procedures.runPluginLifecycleAction(
          {
            action,
            directoryName: plugin.directoryName,
          },
          {
            priority: "foreground",
          },
        );
        setPluginInventory(result.inventory);
        void loadPluginSidecarDiagnostics({ priority: "foreground" });
        const [modelCatalog] = await Promise.all([
          procedures.getModelCatalog(undefined, {
            priority: "foreground",
          }),
          refreshPluginAccessGroups({ priority: "foreground" }),
        ]);
        onModelCatalogChange(modelCatalog);
        if (
          action === "enable" ||
          action === "reapprove" ||
          action === "retry"
        ) {
          void procedures
            .getModelCatalog(
              { refreshProviders: true },
              { priority: "foreground" },
            )
            .then(onModelCatalogChange)
            .catch((error) => {
              logClientError(
                "Failed to refresh plugin model providers",
                error,
                {
                  context: `plugin-lifecycle-model-provider-refresh:${plugin.directoryName}`,
                },
              );
            });
        }
        setPluginLifecycleActionMessage(result.message);
        setPluginLifecycleActionError("");
      } catch (error) {
        if (options?.promptForStepUp && isStepUpRequiredRpcError(error)) {
          setPendingPluginStepUpAction({ action, kind: "lifecycle", plugin });
          setStepUpError("");
          setStepUpPrimaryFactor("");
          setStepUpTotpCode("");
          setPluginLifecycleActionError(
            "Recent authentication is required. Enter your primary factor and TOTP code to continue.",
          );
          setPluginLifecycleActionMessage("");
          return;
        }
        setPluginLifecycleActionError(toDisplayError(error));
        setPluginLifecycleActionMessage("");
      } finally {
        setPluginLifecycleActionKey((currentActionKey) =>
          clearPluginActionKey(currentActionKey, actionKey),
        );
      }
    },
    [
      loadPluginSidecarDiagnostics,
      onModelCatalogChange,
      procedures,
      refreshPluginAccessGroups,
    ],
  );

  const runPluginLifecycleAction = useCallback(
    (
      plugin: RpcPluginInventoryPlugin,
      action: RpcPluginLifecycleAction,
    ): void => {
      void executePluginLifecycleAction(plugin, action, {
        promptForStepUp: true,
      });
    },
    [executePluginLifecycleAction],
  );

  const executePluginAdminAction = useCallback(
    async (
      plugin: RpcPluginInventoryPlugin,
      action: RpcPluginAdminAction,
      confirmation?: string,
      options?: { promptForStepUp?: boolean },
    ): Promise<void> => {
      const actionKey = pluginAdminActionKey(plugin, action);
      setPluginLifecycleActionKey(actionKey);
      setPluginLifecycleActionMessage("");
      setPluginLifecycleActionError("");
      try {
        const result = await procedures.runPluginAdminAction(
          {
            action,
            ...(confirmation === undefined ? {} : { confirmation }),
            directoryName: plugin.directoryName,
          },
          {
            priority: "foreground",
          },
        );
        setPluginInventory(result.inventory);
        void loadPluginSidecarDiagnostics({ priority: "foreground" });
        setPluginLifecycleActionMessage(result.message);
        setPluginLifecycleActionError("");
      } catch (error) {
        if (options?.promptForStepUp && isStepUpRequiredRpcError(error)) {
          setPendingPluginStepUpAction({
            action,
            ...(confirmation === undefined ? {} : { confirmation }),
            kind: "admin",
            plugin,
          });
          setStepUpError("");
          setStepUpPrimaryFactor("");
          setStepUpTotpCode("");
          setPluginLifecycleActionError(
            "Recent authentication is required. Enter your primary factor and TOTP code to continue.",
          );
          setPluginLifecycleActionMessage("");
          return;
        }
        setPluginLifecycleActionError(toDisplayError(error));
        setPluginLifecycleActionMessage("");
      } finally {
        setPluginLifecycleActionKey((currentActionKey) =>
          clearPluginActionKey(currentActionKey, actionKey),
        );
      }
    },
    [loadPluginSidecarDiagnostics, procedures],
  );

  const runPluginAdminAction = useCallback(
    (
      plugin: RpcPluginInventoryPlugin,
      action: RpcPluginAdminAction,
      confirmation?: string,
    ): void => {
      void executePluginAdminAction(plugin, action, confirmation, {
        promptForStepUp: true,
      });
    },
    [executePluginAdminAction],
  );

  const cancelPluginStepUp = useCallback((): void => {
    setPendingPluginStepUpAction(null);
    setStepUpPrimaryFactor("");
    setStepUpTotpCode("");
    setStepUpError("");
    setStepUpLoading(false);
  }, []);

  const submitPluginStepUp = useCallback((): void => {
    if (!pendingPluginStepUpAction) {
      return;
    }
    if (!stepUpPrimaryFactor.trim()) {
      setStepUpError("PIN or password is required.");
      return;
    }
    if (!stepUpTotpCode.trim()) {
      setStepUpError("A TOTP code is required.");
      return;
    }
    const actionToRetry = pendingPluginStepUpAction;
    setStepUpLoading(true);
    setStepUpError("");
    void stepUpAuth({
      primaryFactor: stepUpPrimaryFactor,
      totpCode: stepUpTotpCode,
    })
      .then(() => {
        setPendingPluginStepUpAction(null);
        setStepUpPrimaryFactor("");
        setStepUpTotpCode("");
        setPluginLifecycleActionError("");
        retryPendingPluginStepUpAction({
          actionToRetry,
          executePluginAdminAction: (plugin, action, confirmation) => {
            void executePluginAdminAction(plugin, action, confirmation);
          },
          executePluginLifecycleAction: (plugin, action) => {
            void executePluginLifecycleAction(plugin, action);
          },
          savePluginSettings: () => {
            void savePluginSettings({
              priority: "foreground",
              promptForStepUp: false,
            });
          },
        });
      })
      .catch((error) => {
        setStepUpError(toDisplayError(error));
      })
      .finally(() => {
        setStepUpLoading(false);
      });
  }, [
    executePluginAdminAction,
    executePluginLifecycleAction,
    pendingPluginStepUpAction,
    savePluginSettings,
    stepUpPrimaryFactor,
    stepUpTotpCode,
  ]);

  const createPluginIngressLinkCode = useCallback(
    (pluginId: string, sourceId: string): void => {
      const actionKey = `ingress-link:${pluginId}:${sourceId}`;
      setPluginLifecycleActionKey(actionKey);
      setPluginLifecycleActionMessage("");
      setPluginLifecycleActionError("");
      void procedures
        .createPluginIngressLinkCode(
          { pluginId, sourceId },
          { priority: "foreground" },
        )
        .then((linkCode) => {
          setPluginIngressLinkCodes((currentCodes) => ({
            ...currentCodes,
            [pluginIngressLinkCodeKey(pluginId, sourceId)]: linkCode,
          }));
          setPluginLifecycleActionMessage(
            `Generated a one-time Link Code for ${sourceId}.`,
          );
        })
        .catch((error) => {
          setPluginLifecycleActionError(toDisplayError(error));
        })
        .finally(() => {
          setPluginLifecycleActionKey((currentActionKey) =>
            clearPluginActionKey(currentActionKey, actionKey),
          );
        });
    },
    [procedures],
  );

  const updateIngressRouteDraftPath = useCallback(
    (pluginId: string, sourceId: string, value: string): void => {
      const key = pluginIngressLinkCodeKey(pluginId, sourceId);
      setPluginIngressRouteDrafts((currentDrafts) => ({
        ...currentDrafts,
        [key]: {
          ...(currentDrafts[key] ?? {
            access: defaultIngressRouteAccess(),
            model: defaultCodexModel,
            projectId: null,
            worktreePath: "",
          }),
          worktreePath: value,
        },
      }));
      setRouteDirectorySuggestionsKey(key);
      setHoveredRouteDirectorySuggestion(null);
      if (!value.trim()) {
        setRouteDirectorySuggestions([]);
        return;
      }
      setRouteDirectorySuggestionsLoading(true);
      void procedures
        .listDirectorySuggestions({ query: value }, { priority: "background" })
        .then((suggestions) => {
          setRouteDirectorySuggestionsKey((currentKey) => {
            if (currentKey === key) {
              setRouteDirectorySuggestions(suggestions.directories);
            }
            return currentKey;
          });
        })
        .catch((error) => {
          logClientError(
            "Failed to load ingress route folder suggestions",
            error,
            {
              context: `plugin-ingress-route:${pluginId}:${sourceId}`,
            },
          );
        })
        .finally(() => {
          setRouteDirectorySuggestionsLoading(false);
        });
    },
    [defaultCodexModel, procedures],
  );

  const savePluginIngressRouteConfig = useCallback(
    (
      pluginId: string,
      sourceId: string,
      draftOverride?: PluginIngressRouteDraft,
      createIfMissing = false,
    ): void => {
      const key = pluginIngressLinkCodeKey(pluginId, sourceId);
      const draft = draftOverride ?? pluginIngressRouteDrafts[key];
      const projectPath = draft?.worktreePath.trim() ?? "";
      if (!projectPath) {
        setPluginLifecycleActionError("Ingress route folder is required.");
        return;
      }
      const actionKey = `ingress-route:${pluginId}:${sourceId}`;
      setPluginLifecycleActionKey(actionKey);
      setPluginLifecycleActionMessage("");
      setPluginLifecycleActionError("");
      setPendingIngressRouteFolderCreate(null);
      void procedures
        .openProject(
          { createIfMissing, projectPath },
          { priority: "foreground" },
        )
        .then((result) =>
          procedures.upsertPluginIngressRouteConfig(
            {
              enabled: true,
              model: draft?.model ?? defaultCodexModel,
              permissions: sanitizeIngressRoutePermissions(
                draft?.access.permissions ?? ["metidos:threads"],
                availableThreadPermissionDescriptors,
                availablePluginAccessGroups,
              ),
              pluginId,
              projectId: result.project.id,
              sourceId,
              worktreePath: result.project.path,
            },
            { priority: "foreground" },
          ),
        )
        .then((route) => {
          setPluginIngressRouteConfigs((currentRoutes) => [
            ...currentRoutes.filter(
              (currentRoute) =>
                currentRoute.pluginId !== pluginId ||
                currentRoute.sourceId !== sourceId,
            ),
            route,
          ]);
          setPluginIngressRouteDrafts((currentDrafts) => ({
            ...currentDrafts,
            [key]: {
              access: defaultIngressRouteAccess(route.permissions),
              model: route.model ?? defaultCodexModel,
              projectId: route.projectId,
              worktreePath: route.worktreePath,
            },
          }));
          setPluginLifecycleActionMessage(
            `Saved ingress route for ${pluginId}/${sourceId}.`,
          );
        })
        .catch((error) => {
          if (!createIfMissing && shouldPromptToCreateProjectFolder(error)) {
            setPendingIngressRouteFolderCreate({
              draft: {
                access: draft?.access ?? defaultIngressRouteAccess(),
                model: draft?.model ?? defaultCodexModel,
                projectId: draft?.projectId ?? null,
                worktreePath: projectPath,
              },
              pluginId,
              sourceId,
            });
            return;
          }
          setPluginLifecycleActionError(toDisplayError(error));
        })
        .finally(() => {
          setPluginLifecycleActionKey((currentActionKey) =>
            clearPluginActionKey(currentActionKey, actionKey),
          );
        });
    },
    [
      availablePluginAccessGroups,
      availableThreadPermissionDescriptors,
      defaultCodexModel,
      pluginIngressRouteDrafts,
      procedures,
    ],
  );

  const cancelIngressRouteFolderCreate = useCallback(() => {
    setPendingIngressRouteFolderCreate(null);
  }, []);

  const confirmIngressRouteFolderCreate = useCallback(() => {
    const pending = pendingIngressRouteFolderCreate;
    if (!pending) {
      return;
    }
    savePluginIngressRouteConfig(
      pending.pluginId,
      pending.sourceId,
      pending.draft,
      true,
    );
  }, [pendingIngressRouteFolderCreate, savePluginIngressRouteConfig]);

  const updateIngressRouteDraftAccess = useCallback(
    (pluginId: string, sourceId: string, access: ThreadAccessValue): void => {
      const key = pluginIngressLinkCodeKey(pluginId, sourceId);
      const nextDraft: PluginIngressRouteDraft = {
        ...(pluginIngressRouteDrafts[key] ?? {
          access: defaultIngressRouteAccess(),
          model: defaultCodexModel,
          projectId: null,
          worktreePath: "",
        }),
        access,
      };
      setPluginIngressRouteDrafts((currentDrafts) => ({
        ...currentDrafts,
        [key]: nextDraft,
      }));
      savePluginIngressRouteConfig(pluginId, sourceId, nextDraft);
    },
    [defaultCodexModel, pluginIngressRouteDrafts, savePluginIngressRouteConfig],
  );

  const updateIngressRouteDraftModel = useCallback(
    (pluginId: string, sourceId: string, model: string): void => {
      const key = pluginIngressLinkCodeKey(pluginId, sourceId);
      const nextDraft: PluginIngressRouteDraft = {
        ...(pluginIngressRouteDrafts[key] ?? {
          access: defaultIngressRouteAccess(),
          model: defaultCodexModel,
          projectId: null,
          worktreePath: "",
        }),
        model,
      };
      setPluginIngressRouteDrafts((currentDrafts) => ({
        ...currentDrafts,
        [key]: nextDraft,
      }));
      savePluginIngressRouteConfig(pluginId, sourceId, nextDraft);
    },
    [defaultCodexModel, pluginIngressRouteDrafts, savePluginIngressRouteConfig],
  );

  const setPluginIngressBindingEnabled = useCallback(
    (binding: RpcPluginIngressExternalBinding, enabled: boolean): void => {
      const actionKey = `ingress-binding:${binding.id}`;
      setPluginLifecycleActionKey(actionKey);
      setPluginLifecycleActionMessage("");
      setPluginLifecycleActionError("");
      void procedures
        .setPluginIngressExternalBindingEnabled(
          { enabled, id: binding.id },
          { priority: "foreground" },
        )
        .then((result) => {
          setPluginIngressBindings(result.bindings);
          setUserPluginIngressBindings(result.bindings);
          setPluginLifecycleActionMessage(
            `${enabled ? "Enabled" : "Disabled"} ingress binding ${binding.externalUserId}.`,
          );
        })
        .catch((error) => {
          setPluginLifecycleActionError(toDisplayError(error));
        })
        .finally(() => {
          setPluginLifecycleActionKey((currentActionKey) =>
            clearPluginActionKey(currentActionKey, actionKey),
          );
        });
    },
    [procedures],
  );

  const requestDeletePluginIngressBinding = useCallback(
    (binding: RpcPluginIngressExternalBinding): void => {
      setPendingIngressBindingDelete(binding);
    },
    [],
  );

  const cancelDeletePluginIngressBinding = useCallback(() => {
    setPendingIngressBindingDelete(null);
  }, []);

  const confirmDeletePluginIngressBinding = useCallback((): void => {
    const binding = pendingIngressBindingDelete;
    if (!binding) {
      return;
    }
    setPendingIngressBindingDelete(null);
    const actionKey = `ingress-binding:${binding.id}`;
    setPluginLifecycleActionKey(actionKey);
    setPluginLifecycleActionMessage("");
    setPluginLifecycleActionError("");
    void procedures
      .deletePluginIngressExternalBinding(
        { id: binding.id },
        { priority: "foreground" },
      )
      .then((result) => {
        setPluginIngressBindings(result.bindings);
        setUserPluginIngressBindings(result.bindings);
        setPluginLifecycleActionMessage(
          `Removed ingress binding ${binding.externalUserId}.`,
        );
      })
      .catch((error) => {
        setPluginLifecycleActionError(toDisplayError(error));
      })
      .finally(() => {
        setPluginLifecycleActionKey((currentActionKey) =>
          currentActionKey === actionKey ? null : currentActionKey,
        );
      });
  }, [pendingIngressBindingDelete, procedures]);

  useEffect(() => {
    if (!shouldLoadUserIngressSettings({ active, open })) {
      return;
    }
    void loadUserIngressSettings({
      priority: "foreground",
    });
  }, [active, loadUserIngressSettings, open]);

  useEffect(() => {
    if (!shouldLoadSettingsPluginInventory({ active, isAdmin, open })) {
      return;
    }
    void loadPluginInventory({
      priority: "foreground",
    });
  }, [active, isAdmin, loadPluginInventory, open]);

  useEffect(() => {
    if (!active || !open) {
      return;
    }
    void savePluginSettings({
      priority: "foreground",
      promptForStepUp: true,
    }).catch(() => {
      // The save helper already surfaces the error in the plugin settings status.
    });
  }, [active, open, savePluginSettings]);

  const pluginAttentionState = useMemo(
    () => pluginInventoryAttentionState(pluginInventory),
    [pluginInventory],
  );

  useEffect(() => {
    if (!pluginAttentionState) {
      setAcknowledgedPluginAttentionFingerprint(null);
    }
  }, [pluginAttentionState]);

  const acknowledgePluginAttention = useCallback((): void => {
    if (pluginAttentionState) {
      setAcknowledgedPluginAttentionFingerprint(
        pluginAttentionState.fingerprint,
      );
    }
  }, [pluginAttentionState]);

  const clearActionFeedback = useCallback((): void => {
    setPluginLifecycleActionError("");
    setPluginLifecycleActionMessage("");
  }, []);

  const refreshInventory = useCallback((): void => {
    clearActionFeedback();
    void loadPluginInventory({ priority: "foreground" });
  }, [clearActionFeedback, loadPluginInventory]);

  const refreshUserIngressSettings = useCallback((): void => {
    void loadUserIngressSettings({ priority: "foreground" });
  }, [loadUserIngressSettings]);

  const selectRouteDirectory = useCallback(
    (pluginId: string, sourceId: string, directory: string): void => {
      updateIngressRouteDraftPath(pluginId, sourceId, directory);
      setRouteDirectorySuggestions([]);
    },
    [updateIngressRouteDraftPath],
  );

  const showAttentionIndicator =
    isAdmin &&
    pluginAttentionState !== null &&
    pluginAttentionState.fingerprint !== acknowledgedPluginAttentionFingerprint;
  const attentionIndicatorTone =
    pluginAttentionState?.tone === "danger"
      ? ("danger" as const)
      : ("warning" as const);

  const inventorySectionProps: PluginInventorySectionProps = {
    actionError: pluginLifecycleActionError,
    actionLoadingKey: pluginLifecycleActionKey,
    actionMessage: pluginLifecycleActionMessage,
    error: pluginInventoryError,
    ingressBindings: pluginIngressBindings,
    ingressLinkCodes: pluginIngressLinkCodes,
    inventory: pluginInventory,
    isAdmin,
    loading: pluginInventoryLoading,
    onAdminAction: runPluginAdminAction,
    onCreateIngressLinkCode: createPluginIngressLinkCode,
    onDeleteIngressBinding: requestDeletePluginIngressBinding,
    onLifecycleAction: runPluginLifecycleAction,
    onRefresh: refreshInventory,
    onSetIngressBindingEnabled: setPluginIngressBindingEnabled,
    onSettingValueChange: updatePluginSettingFormValue,
    sidecarDiagnostics: pluginSidecarDiagnostics,
    settingsErrors: pluginSettingsErrors,
    settingsSnapshots: pluginSettingsSnapshots,
    settingsValues: pluginSettingsValues,
  };

  const userIngressSectionProps: UserIngressSourcesSectionProps = {
    actionError: pluginLifecycleActionError,
    actionLoadingKey: pluginLifecycleActionKey,
    availablePluginAccessGroups,
    availableThreadPermissionDescriptors,
    bindings: userPluginIngressBindings,
    codexModels,
    homeDirectory,
    linkCodes: pluginIngressLinkCodes,
    loading: pluginIngressSourcesLoading,
    onCancelRouteFolderCreate: cancelIngressRouteFolderCreate,
    onConfirmRouteFolderCreate: confirmIngressRouteFolderCreate,
    onCreateLinkCode: createPluginIngressLinkCode,
    onDeleteBinding: requestDeletePluginIngressBinding,
    onRefresh: refreshUserIngressSettings,
    onRouteAccessChange: updateIngressRouteDraftAccess,
    onRouteModelChange: updateIngressRouteDraftModel,
    onRoutePathChange: updateIngressRouteDraftPath,
    onSaveRouteConfig: savePluginIngressRouteConfig,
    onSelectRouteDirectory: selectRouteDirectory,
    onSetBindingEnabled: setPluginIngressBindingEnabled,
    routeCreateFolderPrompt: pendingIngressRouteFolderCreate,
    routeDirectorySuggestions,
    routeDirectorySuggestionsKey,
    routeDirectorySuggestionsLoading,
    routeDrafts: pluginIngressRouteDrafts,
    routeHoveredDirectorySuggestion: hoveredRouteDirectorySuggestion,
    setRouteHoveredDirectorySuggestion: setHoveredRouteDirectorySuggestion,
    sources: pluginIngressSources,
    supportsTildePath,
  };

  const deleteBindingDialog = {
    details: pendingIngressBindingDelete
      ? `${pendingIngressBindingDelete.pluginId}/${pendingIngressBindingDelete.sourceId}`
      : undefined,
    message: pendingIngressBindingDelete
      ? `Remove external binding ${pendingIngressBindingDelete.externalUserId}?`
      : "Remove external binding?",
    onCancel: cancelDeletePluginIngressBinding,
    onConfirm: confirmDeletePluginIngressBinding,
    open: Boolean(pendingIngressBindingDelete),
  };

  return {
    actionError: pluginLifecycleActionError,
    actionLoadingKey: pluginLifecycleActionKey,
    actionMessage: pluginLifecycleActionMessage,
    attentionIndicatorTone,
    bindings: pluginIngressBindings,
    cancelDeleteBinding: cancelDeletePluginIngressBinding,
    cancelRouteFolderCreate: cancelIngressRouteFolderCreate,
    codexModels,
    confirmDeleteBinding: confirmDeletePluginIngressBinding,
    confirmRouteFolderCreate: confirmIngressRouteFolderCreate,
    createLinkCode: createPluginIngressLinkCode,
    deleteBindingDialog,
    deleteBindingPrompt: pendingIngressBindingDelete,
    error: pluginInventoryError,
    homeDirectory,
    ingressBindings: userPluginIngressBindings,
    inventory: pluginInventory,
    inventorySectionProps,
    isAdmin,
    linkCodes: pluginIngressLinkCodes,
    loading: pluginInventoryLoading,
    onAcknowledgeAttention: acknowledgePluginAttention,
    onAdminAction: runPluginAdminAction,
    onClearActionFeedback: clearActionFeedback,
    onCreateLinkCode: createPluginIngressLinkCode,
    onDeleteBinding: requestDeletePluginIngressBinding,
    onLifecycleAction: runPluginLifecycleAction,
    onRefresh: refreshInventory,
    onRefreshIngress: refreshUserIngressSettings,
    onRouteAccessChange: updateIngressRouteDraftAccess,
    onRouteModelChange: updateIngressRouteDraftModel,
    onRoutePathChange: updateIngressRouteDraftPath,
    onSaveRouteConfig: savePluginIngressRouteConfig,
    onSelectRouteDirectory: selectRouteDirectory,
    onSetBindingEnabled: setPluginIngressBindingEnabled,
    onSettingValueChange: updatePluginSettingFormValue,
    routeCreateFolderPrompt: pendingIngressRouteFolderCreate,
    routeDirectorySuggestions,
    routeDirectorySuggestionsKey,
    routeDirectorySuggestionsLoading,
    routeDrafts: pluginIngressRouteDrafts,
    routeHoveredDirectorySuggestion: hoveredRouteDirectorySuggestion,
    setRouteHoveredDirectorySuggestion: setHoveredRouteDirectorySuggestion,
    settingsErrors: pluginSettingsErrors,
    settingsSnapshots: pluginSettingsSnapshots,
    settingsStatus: pluginSettingsStatus,
    settingsValues: pluginSettingsValues,
    shouldShowAttentionIndicator: showAttentionIndicator,
    sidecarDiagnostics: pluginSidecarDiagnostics,
    sources: pluginIngressSources,
    sourcesLoading: pluginIngressSourcesLoading,
    stepUp: {
      cancel: cancelPluginStepUp,
      error: stepUpError,
      loading: stepUpLoading,
      onPrimaryFactorChange: setStepUpPrimaryFactor,
      onSubmit: submitPluginStepUp,
      onTotpCodeChange: setStepUpTotpCode,
      open: Boolean(pendingPluginStepUpAction),
      primaryFactor: stepUpPrimaryFactor,
      totpCode: stepUpTotpCode,
    },
    supportsTildePath,
    userIngressSectionProps,
  };
}
