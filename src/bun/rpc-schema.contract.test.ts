import { describe, expect, it } from "bun:test";

import {
  MAINVIEW_HTML_BOOTSTRAP_CONTRACT as AGGREGATE_MAINVIEW_HTML_BOOTSTRAP_CONTRACT,
  RPC_PLUGIN_INVENTORY_GROUP_LABELS as AGGREGATE_RPC_PLUGIN_INVENTORY_GROUP_LABELS,
  type RpcContextFocusChanged as AggregateRpcContextFocusChanged,
  type RpcCreateWorktreeResult as AggregateRpcCreateWorktreeResult,
  type RpcDirectorySuggestionsResult as AggregateRpcDirectorySuggestionsResult,
  type RpcGitCommitDiffResult as AggregateRpcGitCommitDiffResult,
  type RpcGitHistoryEntry as AggregateRpcGitHistoryEntry,
  type RpcHomeDirectoryResult as AggregateRpcHomeDirectoryResult,
  type RpcOpenProjectRequest as AggregateRpcOpenProjectRequest,
  type RpcOpenProjectsBatchRequestItem as AggregateRpcOpenProjectsBatchRequestItem,
  type RpcOpenProjectsBatchResultItem as AggregateRpcOpenProjectsBatchResultItem,
  type RpcOpenWorktreeRequest as AggregateRpcOpenWorktreeRequest,
  type RpcOpenWorktreeResult as AggregateRpcOpenWorktreeResult,
  type RpcOpenWorktreesBatchResultItem as AggregateRpcOpenWorktreesBatchResultItem,
  type RpcPluginAccessGroupOption as AggregateRpcPluginAccessGroupOption,
  type RpcPluginAdminAction as AggregateRpcPluginAdminAction,
  type RpcPluginAdminActionAvailability as AggregateRpcPluginAdminActionAvailability,
  type RpcPluginAdminActionResult as AggregateRpcPluginAdminActionResult,
  type RpcPluginDataUsage as AggregateRpcPluginDataUsage,
  type RpcPluginIngressBindingMutationResult as AggregateRpcPluginIngressBindingMutationResult,
  type RpcPluginIngressExternalBinding as AggregateRpcPluginIngressExternalBinding,
  type RpcPluginIngressLinkCode as AggregateRpcPluginIngressLinkCode,
  type RpcPluginIngressRouteConfig as AggregateRpcPluginIngressRouteConfig,
  type RpcPluginIngressSourceDescriptor as AggregateRpcPluginIngressSourceDescriptor,
  type RpcPluginInventory as AggregateRpcPluginInventory,
  type RpcPluginInventoryGroup as AggregateRpcPluginInventoryGroup,
  type RpcPluginInventoryGroupLabel as AggregateRpcPluginInventoryGroupLabel,
  type RpcPluginInventoryIssue as AggregateRpcPluginInventoryIssue,
  type RpcPluginInventoryPlugin as AggregateRpcPluginInventoryPlugin,
  type RpcPluginInventoryStatus as AggregateRpcPluginInventoryStatus,
  type RpcPluginLifecycleAction as AggregateRpcPluginLifecycleAction,
  type RpcPluginLifecycleActionResult as AggregateRpcPluginLifecycleActionResult,
  type RpcPluginLifecycleCrashLoop as AggregateRpcPluginLifecycleCrashLoop,
  type RpcPluginLifecycleMetadata as AggregateRpcPluginLifecycleMetadata,
  type RpcPluginLifecycleSettings as AggregateRpcPluginLifecycleSettings,
  type RpcPluginManifestAccessGroupSummary as AggregateRpcPluginManifestAccessGroupSummary,
  type RpcPluginManifestEnvVarSummary as AggregateRpcPluginManifestEnvVarSummary,
  type RpcPluginManifestFileAccessSummary as AggregateRpcPluginManifestFileAccessSummary,
  type RpcPluginManifestFileSummary as AggregateRpcPluginManifestFileSummary,
  type RpcPluginManifestGcSummary as AggregateRpcPluginManifestGcSummary,
  type RpcPluginManifestIngressSourceSummary as AggregateRpcPluginManifestIngressSourceSummary,
  type RpcPluginManifestNetworkSummary as AggregateRpcPluginManifestNetworkSummary,
  type RpcPluginManifestPiAuthSummary as AggregateRpcPluginManifestPiAuthSummary,
  type RpcPluginManifestProviderSummary as AggregateRpcPluginManifestProviderSummary,
  type RpcPluginManifestReviewSummary as AggregateRpcPluginManifestReviewSummary,
  type RpcPluginManifestSettingDefault as AggregateRpcPluginManifestSettingDefault,
  type RpcPluginManifestSettingItemSummary as AggregateRpcPluginManifestSettingItemSummary,
  type RpcPluginManifestSettingSummary as AggregateRpcPluginManifestSettingSummary,
  type RpcPluginManifestStorageDefaultsSummary as AggregateRpcPluginManifestStorageDefaultsSummary,
  type RpcPluginManifestToolSummary as AggregateRpcPluginManifestToolSummary,
  type RpcPluginSecurityDiagnostics as AggregateRpcPluginSecurityDiagnostics,
  type RpcPluginSettingValueSummary as AggregateRpcPluginSettingValueSummary,
  type RpcPluginSettingsSnapshot as AggregateRpcPluginSettingsSnapshot,
  type RpcPluginSidecarDiagnostics as AggregateRpcPluginSidecarDiagnostics,
  type RpcPluginSidecarFailureDiagnostic as AggregateRpcPluginSidecarFailureDiagnostic,
  type RpcPluginSidecarStderrLine as AggregateRpcPluginSidecarStderrLine,
  type RpcPluginSqliteNativeSecurityDiagnostic as AggregateRpcPluginSqliteNativeSecurityDiagnostic,
  type RpcProject as AggregateRpcProject,
  type RpcProjectSkill as AggregateRpcProjectSkill,
  type RpcProjectWorktreesResult as AggregateRpcProjectWorktreesResult,
  type RpcSetActiveWorktreeResult as AggregateRpcSetActiveWorktreeResult,
  type RpcThreadPermissionDescriptor as AggregateRpcThreadPermissionDescriptor,
  type RpcWorktree as AggregateRpcWorktree,
  type RpcWorktreeChange as AggregateRpcWorktreeChange,
  type RpcWorktreeChangeStatus as AggregateRpcWorktreeChangeStatus,
  type RpcWorktreeFileContentPage as AggregateRpcWorktreeFileContentPage,
  type RpcWorktreeFileDiff as AggregateRpcWorktreeFileDiff,
  type RpcWorktreeGitHistoryChanged as AggregateRpcWorktreeGitHistoryChanged,
  type RpcWorktreeGitHistoryResult as AggregateRpcWorktreeGitHistoryResult,
  type RpcWorktreeGitHistorySummary as AggregateRpcWorktreeGitHistorySummary,
  type RpcWorktreeSnapshot as AggregateRpcWorktreeSnapshot,
} from "./rpc-schema";
import type * as AggregateRpc from "./rpc-schema";
import { MAINVIEW_HTML_BOOTSTRAP_CONTRACT } from "./rpc-schema/app-bootstrap";
import type * as AppBootstrapRpc from "./rpc-schema/app-bootstrap";
import type * as CronRpc from "./rpc-schema/cron";
import type * as ModelCatalogRpc from "./rpc-schema/model-catalog";
import type * as NotificationRpc from "./rpc-schema/notifications";
import type * as SettingsRpc from "./rpc-schema/settings";
import type * as ThreadRpc from "./rpc-schema/thread";
import type * as ThreadExtensionUiRpc from "./rpc-schema/thread-extension-ui";
import type * as TerminalRpc from "./rpc-schema/terminal";
import {
  RPC_PLUGIN_INVENTORY_GROUP_LABELS,
  type RpcPluginAccessGroupOption,
  type RpcPluginAdminAction,
  type RpcPluginAdminActionAvailability,
  type RpcPluginAdminActionResult,
  type RpcPluginDataUsage,
  type RpcPluginIngressBindingMutationResult,
  type RpcPluginIngressExternalBinding,
  type RpcPluginIngressLinkCode,
  type RpcPluginIngressRouteConfig,
  type RpcPluginIngressSourceDescriptor,
  type RpcPluginInventory,
  type RpcPluginInventoryGroup,
  type RpcPluginInventoryGroupLabel,
  type RpcPluginInventoryIssue,
  type RpcPluginInventoryPlugin,
  type RpcPluginInventoryStatus,
  type RpcPluginLifecycleAction,
  type RpcPluginLifecycleActionResult,
  type RpcPluginLifecycleCrashLoop,
  type RpcPluginLifecycleMetadata,
  type RpcPluginLifecycleSettings,
  type RpcPluginManifestAccessGroupSummary,
  type RpcPluginManifestEnvVarSummary,
  type RpcPluginManifestFileAccessSummary,
  type RpcPluginManifestFileSummary,
  type RpcPluginManifestGcSummary,
  type RpcPluginManifestIngressSourceSummary,
  type RpcPluginManifestNetworkSummary,
  type RpcPluginManifestPiAuthSummary,
  type RpcPluginManifestProviderSummary,
  type RpcPluginManifestReviewSummary,
  type RpcPluginManifestSettingDefault,
  type RpcPluginManifestSettingItemSummary,
  type RpcPluginManifestSettingSummary,
  type RpcPluginManifestStorageDefaultsSummary,
  type RpcPluginManifestToolSummary,
  type RpcPluginSecurityDiagnostics,
  type RpcPluginSettingValueSummary,
  type RpcPluginSettingsSnapshot,
  type RpcPluginSidecarDiagnostics,
  type RpcPluginSidecarFailureDiagnostic,
  type RpcPluginSidecarStderrLine,
  type RpcPluginSqliteNativeSecurityDiagnostic,
  type RpcThreadPermissionDescriptor,
} from "./rpc-schema/plugin";
import type {
  RpcContextFocusChanged,
  RpcCreateWorktreeResult,
  RpcDirectorySuggestionsResult,
  RpcGitCommitDiffResult,
  RpcGitHistoryEntry,
  RpcHomeDirectoryResult,
  RpcOpenProjectRequest,
  RpcOpenProjectsBatchRequestItem,
  RpcOpenProjectsBatchResultItem,
  RpcOpenWorktreeRequest,
  RpcOpenWorktreeResult,
  RpcOpenWorktreesBatchResultItem,
  RpcProject,
  RpcProjectSkill,
  RpcProjectWorktreesResult,
  RpcSetActiveWorktreeResult,
  RpcWorktree,
  RpcWorktreeChange,
  RpcWorktreeChangeStatus,
  RpcWorktreeFileContentPage,
  RpcWorktreeFileDiff,
  RpcWorktreeGitHistoryChanged,
  RpcWorktreeGitHistoryResult,
  RpcWorktreeGitHistorySummary,
  RpcWorktreeSnapshot,
} from "./rpc-schema/project-worktree";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <
    Value,
  >() => Value extends Right ? 1 : 2
    ? (<Value>() => Value extends Right ? 1 : 2) extends <
        Value,
      >() => Value extends Left ? 1 : 2
      ? true
      : false
    : false;

type Expect<Type extends true> = Type;

type PluginContractExportsStayAggregateCompatible = [
  Expect<
    Equal<AggregateRpcPluginInventoryGroupLabel, RpcPluginInventoryGroupLabel>
  >,
  Expect<Equal<AggregateRpcPluginInventoryStatus, RpcPluginInventoryStatus>>,
  Expect<Equal<AggregateRpcPluginInventoryIssue, RpcPluginInventoryIssue>>,
  Expect<
    Equal<AggregateRpcPluginManifestToolSummary, RpcPluginManifestToolSummary>
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestAccessGroupSummary,
      RpcPluginManifestAccessGroupSummary
    >
  >,
  Expect<
    Equal<AggregateRpcThreadPermissionDescriptor, RpcThreadPermissionDescriptor>
  >,
  Expect<
    Equal<AggregateRpcPluginAccessGroupOption, RpcPluginAccessGroupOption>
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestFileAccessSummary,
      RpcPluginManifestFileAccessSummary
    >
  >,
  Expect<
    Equal<AggregateRpcPluginManifestFileSummary, RpcPluginManifestFileSummary>
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestNetworkSummary,
      RpcPluginManifestNetworkSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestEnvVarSummary,
      RpcPluginManifestEnvVarSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestSettingDefault,
      RpcPluginManifestSettingDefault
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestSettingItemSummary,
      RpcPluginManifestSettingItemSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestSettingSummary,
      RpcPluginManifestSettingSummary
    >
  >,
  Expect<
    Equal<AggregateRpcPluginSettingValueSummary, RpcPluginSettingValueSummary>
  >,
  Expect<Equal<AggregateRpcPluginSettingsSnapshot, RpcPluginSettingsSnapshot>>,
  Expect<
    Equal<
      AggregateRpcPluginManifestProviderSummary,
      RpcPluginManifestProviderSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestPiAuthSummary,
      RpcPluginManifestPiAuthSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestIngressSourceSummary,
      RpcPluginManifestIngressSourceSummary
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginIngressSourceDescriptor,
      RpcPluginIngressSourceDescriptor
    >
  >,
  Expect<Equal<AggregateRpcPluginIngressLinkCode, RpcPluginIngressLinkCode>>,
  Expect<
    Equal<
      AggregateRpcPluginIngressExternalBinding,
      RpcPluginIngressExternalBinding
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginIngressBindingMutationResult,
      RpcPluginIngressBindingMutationResult
    >
  >,
  Expect<
    Equal<AggregateRpcPluginIngressRouteConfig, RpcPluginIngressRouteConfig>
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestStorageDefaultsSummary,
      RpcPluginManifestStorageDefaultsSummary
    >
  >,
  Expect<
    Equal<AggregateRpcPluginManifestGcSummary, RpcPluginManifestGcSummary>
  >,
  Expect<
    Equal<
      AggregateRpcPluginManifestReviewSummary,
      RpcPluginManifestReviewSummary
    >
  >,
  Expect<Equal<AggregateRpcPluginAdminAction, RpcPluginAdminAction>>,
  Expect<
    Equal<
      AggregateRpcPluginAdminActionAvailability,
      RpcPluginAdminActionAvailability
    >
  >,
  Expect<Equal<AggregateRpcPluginDataUsage, RpcPluginDataUsage>>,
  Expect<
    Equal<AggregateRpcPluginLifecycleSettings, RpcPluginLifecycleSettings>
  >,
  Expect<
    Equal<AggregateRpcPluginLifecycleCrashLoop, RpcPluginLifecycleCrashLoop>
  >,
  Expect<
    Equal<AggregateRpcPluginLifecycleMetadata, RpcPluginLifecycleMetadata>
  >,
  Expect<Equal<AggregateRpcPluginInventoryPlugin, RpcPluginInventoryPlugin>>,
  Expect<Equal<AggregateRpcPluginLifecycleAction, RpcPluginLifecycleAction>>,
  Expect<
    Equal<
      AggregateRpcPluginLifecycleActionResult,
      RpcPluginLifecycleActionResult
    >
  >,
  Expect<
    Equal<AggregateRpcPluginAdminActionResult, RpcPluginAdminActionResult>
  >,
  Expect<
    Equal<AggregateRpcPluginSidecarStderrLine, RpcPluginSidecarStderrLine>
  >,
  Expect<
    Equal<
      AggregateRpcPluginSidecarFailureDiagnostic,
      RpcPluginSidecarFailureDiagnostic
    >
  >,
  Expect<
    Equal<
      AggregateRpcPluginSqliteNativeSecurityDiagnostic,
      RpcPluginSqliteNativeSecurityDiagnostic
    >
  >,
  Expect<
    Equal<AggregateRpcPluginSecurityDiagnostics, RpcPluginSecurityDiagnostics>
  >,
  Expect<
    Equal<AggregateRpcPluginSidecarDiagnostics, RpcPluginSidecarDiagnostics>
  >,
  Expect<Equal<AggregateRpcPluginInventoryGroup, RpcPluginInventoryGroup>>,
  Expect<Equal<AggregateRpcPluginInventory, RpcPluginInventory>>,
];

type DomainContractExportsStayAggregateCompatible = [
  Expect<
    Equal<AggregateRpc.RpcAppBootstrapHint, AppBootstrapRpc.RpcAppBootstrapHint>
  >,
  Expect<
    Equal<
      AggregateRpc.RpcMainviewHtmlBootstrapContract,
      AppBootstrapRpc.RpcMainviewHtmlBootstrapContract
    >
  >,
  Expect<
    Equal<
      AggregateRpc.RpcAppBootstrapResult,
      AppBootstrapRpc.RpcAppBootstrapResult
    >
  >,
  Expect<Equal<AggregateRpc.RpcCronJob, CronRpc.RpcCronJob>>,
  Expect<Equal<AggregateRpc.RpcCronJobRunStatus, CronRpc.RpcCronJobRunStatus>>,
  Expect<Equal<AggregateRpc.RpcModelCatalog, ModelCatalogRpc.RpcModelCatalog>>,
  Expect<Equal<AggregateRpc.RpcModelOption, ModelCatalogRpc.RpcModelOption>>,
  Expect<
    Equal<AggregateRpc.RpcReasoningEffort, ModelCatalogRpc.RpcReasoningEffort>
  >,
  Expect<
    Equal<
      AggregateRpc.RpcUserNotificationDelivery,
      NotificationRpc.RpcUserNotificationDelivery
    >
  >,
  Expect<
    Equal<
      AggregateRpc.RpcUserNotificationDeliveryResult,
      NotificationRpc.RpcUserNotificationDeliveryResult
    >
  >,
  Expect<
    Equal<AggregateRpc.RpcTimezoneSettings, SettingsRpc.RpcTimezoneSettings>
  >,
  Expect<
    Equal<
      AggregateRpc.RpcUserRuntimeSettings,
      SettingsRpc.RpcUserRuntimeSettings
    >
  >,
  Expect<Equal<AggregateRpc.RpcThread, ThreadRpc.RpcThread>>,
  Expect<Equal<AggregateRpc.RpcThreadDetail, ThreadRpc.RpcThreadDetail>>,
  Expect<Equal<AggregateRpc.RpcThreadMessage, ThreadRpc.RpcThreadMessage>>,
  Expect<
    Equal<AggregateRpc.RpcThreadStartRequest, ThreadRpc.RpcThreadStartRequest>
  >,
  Expect<
    Equal<
      AggregateRpc.RpcThreadExtensionUiRequest,
      ThreadExtensionUiRpc.RpcThreadExtensionUiRequest
    >
  >,
  Expect<
    Equal<
      AggregateRpc.RpcThreadExtensionUiResponse,
      ThreadExtensionUiRpc.RpcThreadExtensionUiResponse
    >
  >,
  Expect<Equal<AggregateRpc.RpcTerminal, TerminalRpc.RpcTerminal>>,
  Expect<
    Equal<
      AggregateRpc.RpcCreateTerminalRequest,
      TerminalRpc.RpcCreateTerminalRequest
    >
  >,
  Expect<
    Equal<
      AggregateRpc.RpcCreateTerminalResult,
      TerminalRpc.RpcCreateTerminalResult
    >
  >,
];

type ProjectWorktreeContractExportsStayAggregateCompatible = [
  Expect<Equal<AggregateRpcProject, RpcProject>>,
  Expect<Equal<AggregateRpcWorktree, RpcWorktree>>,
  Expect<Equal<AggregateRpcWorktreeChangeStatus, RpcWorktreeChangeStatus>>,
  Expect<Equal<AggregateRpcWorktreeChange, RpcWorktreeChange>>,
  Expect<Equal<AggregateRpcWorktreeSnapshot, RpcWorktreeSnapshot>>,
  Expect<Equal<AggregateRpcWorktreeFileDiff, RpcWorktreeFileDiff>>,
  Expect<Equal<AggregateRpcProjectWorktreesResult, RpcProjectWorktreesResult>>,
  Expect<Equal<AggregateRpcOpenProjectRequest, RpcOpenProjectRequest>>,
  Expect<
    Equal<
      AggregateRpcOpenProjectsBatchRequestItem,
      RpcOpenProjectsBatchRequestItem
    >
  >,
  Expect<
    Equal<
      AggregateRpcOpenProjectsBatchResultItem,
      RpcOpenProjectsBatchResultItem
    >
  >,
  Expect<Equal<AggregateRpcOpenWorktreeRequest, RpcOpenWorktreeRequest>>,
  Expect<
    Equal<
      AggregateRpcOpenWorktreesBatchResultItem,
      RpcOpenWorktreesBatchResultItem
    >
  >,
  Expect<Equal<AggregateRpcOpenWorktreeResult, RpcOpenWorktreeResult>>,
  Expect<
    Equal<AggregateRpcSetActiveWorktreeResult, RpcSetActiveWorktreeResult>
  >,
  Expect<Equal<AggregateRpcHomeDirectoryResult, RpcHomeDirectoryResult>>,
  Expect<
    Equal<AggregateRpcDirectorySuggestionsResult, RpcDirectorySuggestionsResult>
  >,
  Expect<Equal<AggregateRpcProjectSkill, RpcProjectSkill>>,
  Expect<Equal<AggregateRpcCreateWorktreeResult, RpcCreateWorktreeResult>>,
  Expect<
    Equal<AggregateRpcWorktreeGitHistoryChanged, RpcWorktreeGitHistoryChanged>
  >,
  Expect<Equal<AggregateRpcContextFocusChanged, RpcContextFocusChanged>>,
  Expect<Equal<AggregateRpcGitHistoryEntry, RpcGitHistoryEntry>>,
  Expect<
    Equal<AggregateRpcWorktreeGitHistorySummary, RpcWorktreeGitHistorySummary>
  >,
  Expect<
    Equal<AggregateRpcWorktreeGitHistoryResult, RpcWorktreeGitHistoryResult>
  >,
  Expect<Equal<AggregateRpcGitCommitDiffResult, RpcGitCommitDiffResult>>,
  Expect<
    Equal<AggregateRpcWorktreeFileContentPage, RpcWorktreeFileContentPage>
  >,
];

void (undefined as unknown as PluginContractExportsStayAggregateCompatible);
void (undefined as unknown as DomainContractExportsStayAggregateCompatible);
void (undefined as unknown as ProjectWorktreeContractExportsStayAggregateCompatible);

describe("RPC contract organization", () => {
  it("keeps aggregate plugin values aligned with the domain module", () => {
    expect(AGGREGATE_RPC_PLUGIN_INVENTORY_GROUP_LABELS).toBe(
      RPC_PLUGIN_INVENTORY_GROUP_LABELS,
    );
  });

  it("keeps aggregate bootstrap values aligned with the domain module", () => {
    expect(AGGREGATE_MAINVIEW_HTML_BOOTSTRAP_CONTRACT).toBe(
      MAINVIEW_HTML_BOOTSTRAP_CONTRACT,
    );
  });
});
