export const RPC_PLUGIN_INVENTORY_GROUP_LABELS = [
  "Uninitialized",
  "Needs Review",
  "Active",
  "Failed/Degraded",
  "Disabled/Restart Required",
  "Missing/Unavailable",
] as const;

export type RpcPluginInventoryGroupLabel =
  (typeof RPC_PLUGIN_INVENTORY_GROUP_LABELS)[number];

export type RpcPluginInventoryStatus =
  | "uninitialized"
  | "needs_review"
  | "active"
  | "failed_degraded"
  | "disabled_restart_required"
  | "missing_unavailable";

export type RpcPluginInventoryIssue = {
  code: string;
  message: string;
  path: string;
  fileName?: string;
};

export type RpcPluginManifestToolSummary = {
  name: string | null;
  description: string | null;
  timeoutMs: number | null;
};

export type RpcPluginManifestInjectionSummary = {
  name: string | null;
  description: string | null;
  timeoutMs: number | null;
};

export type RpcPluginManifestAccessGroupSummary = {
  id: string | null;
  name: string | null;
  description: string | null;
  color?: string | null;
  tools: RpcPluginManifestToolSummary[];
  injects?: RpcPluginManifestInjectionSummary[];
};

export type RpcThreadPermissionDescriptor = {
  id: string;
  providerId: string;
  providerDescription: string;
  accessId: string;
  label: string;
  description: string;
  category:
    | "agent-runtime"
    | "browser"
    | "coordination"
    | "data"
    | "external"
    | "plugin"
    | "security";
  defaultEnabled: boolean;
  requiresApproval: boolean;
  unsafe: boolean;
  order: number;
};

export type RpcPluginAccessGroupOption = {
  color?: string | null;
  description: string | null;
  groupId: string;
  groupName: string | null;
  key: string;
  pluginDirectoryName: string;
  pluginId: string;
  pluginName: string | null;
  tools: RpcPluginManifestToolSummary[];
  injects?: RpcPluginManifestInjectionSummary[];
};

export type RpcPluginManifestFileAccessSummary = {
  read: string[];
  write: string[];
  delete: string[];
};

export type RpcPluginManifestFileSummary = {
  allow: RpcPluginManifestFileAccessSummary;
  deny: RpcPluginManifestFileAccessSummary;
};

export type RpcPluginManifestNetworkSummary = {
  allow: string[];
  enforceHttps: boolean | null;
  webSocketAllow?: string[];
};

export type RpcPluginManifestEnvVarSummary = {
  key: string | null;
  description: string | null;
  required: boolean | null;
  secret: boolean | null;
  hasDefault: boolean;
  defaultValue: string | null;
  reviewValue: string | null;
};

export type RpcPluginManifestSettingDefault =
  | boolean
  | number
  | string
  | Array<number | string>
  | null;

export type RpcPluginManifestSettingItemSummary = {
  kind: string | null;
};

export type RpcPluginManifestSettingSummary = {
  key: string | null;
  label: string | null;
  kind: string | null;
  description: string | null;
  required: boolean | null;
  hasDefault: boolean;
  defaultValue: RpcPluginManifestSettingDefault;
  options: string[];
  items: RpcPluginManifestSettingItemSummary | null;
};

export type RpcPluginSettingValueSummary = {
  key: string | null;
  kind: string | null;
  secret: boolean;
  readable: boolean;
  hasStoredValue: boolean;
  hasDefault: boolean;
  defaultValue: RpcPluginManifestSettingDefault;
  value: RpcPluginManifestSettingDefault;
};

export type RpcPluginSettingsSnapshot = {
  directoryName: string;
  pluginId: string | null;
  settings: RpcPluginSettingValueSummary[];
};

export type RpcPluginManifestProviderSummary = {
  id: string | null;
  name: string | null;
  description: string | null;
  timeoutMs: number | null;
};

export type RpcPluginManifestPiAuthSummary = {
  kind: string | null;
  provider: string | null;
  source: string | null;
  value: string | null;
};

export type RpcPluginManifestIngressSourceSummary = {
  id: string | null;
  name: string | null;
  description: string | null;
  pollIntervalMs: number | null;
  timeoutMs: number | null;
  supportsReplyToSource: boolean;
};

export type RpcPluginIngressSourceDescriptor = {
  pluginId: string;
  pluginName: string | null;
  source: RpcPluginManifestIngressSourceSummary;
};

export type RpcPluginIngressLinkCode = {
  pluginId: string;
  sourceId: string;
  code: string;
  expiresAt: string;
  createdAt: string;
};

export type RpcPluginIngressExternalBinding = {
  id: number;
  pluginId: string;
  sourceId: string;
  externalUserId: string;
  metidosUserId?: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RpcPluginIngressBindingMutationResult = {
  binding: RpcPluginIngressExternalBinding;
  bindings: RpcPluginIngressExternalBinding[];
};

export type RpcPluginIngressRouteConfig = {
  id: number;
  pluginId: string;
  sourceId: string;
  metidosUserId?: number | null;
  projectId: number;
  worktreePath: string;
  model: string | null;
  permissions: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RpcPluginManifestStorageDefaultsSummary = {
  maxDataBytes: number | null;
  maxFileBytes: number | null;
  maxFiles: number | null;
};

export type RpcPluginManifestGcSummary = {
  enabled: boolean | null;
  timeoutMs: number | null;
};

export type RpcPluginManifestReviewSummary = {
  metidosApiVersion: string | null;
  color?: string | null;
  telemetry: boolean | null;
  permissions: string[];
  access: RpcPluginManifestAccessGroupSummary[];
  files: RpcPluginManifestFileSummary;
  network: RpcPluginManifestNetworkSummary | null;
  env: RpcPluginManifestEnvVarSummary[];
  settings: RpcPluginManifestSettingSummary[];
  providers: RpcPluginManifestProviderSummary[];
  notificationProviders: RpcPluginManifestProviderSummary[];
  oauthProviders: RpcPluginManifestProviderSummary[];
  piAuth: RpcPluginManifestPiAuthSummary[];
  ingressSources?: RpcPluginManifestIngressSourceSummary[];
  crons: string[];
  storageDefaults: RpcPluginManifestStorageDefaultsSummary | null;
  gc: RpcPluginManifestGcSummary | null;
  limits?: Record<string, unknown>;
};

export type RpcPluginAdminAction =
  | "open_data"
  | "open_logs"
  | "reset_data"
  | "run_gc";

export type RpcPluginAdminActionAvailability = {
  action: RpcPluginAdminAction;
  label: string;
  available: boolean;
  destructive: boolean;
  path: string | null;
  reason: string | null;
};

export type RpcPluginDataUsage = {
  bytes: number;
  files: number;
  scannedAt: string;
  unavailableReason: string | null;
};

export type RpcPluginLifecycleSettings = {
  log: {
    enabled: boolean;
    maxBytes: number;
    retentionDays: number;
  };
  notifications: {
    enabled: boolean;
    perDayLimit: number;
    perMinuteLimit: number;
  };
  quota: {
    maxDataBytes: number;
    maxFileBytes: number;
    maxFiles: number;
  };
};

export type RpcPluginLifecycleCrashLoop = {
  crashCount: number;
  lastCrashAt: string | null;
  threshold: number;
  thresholdReached: boolean;
  windowMs: number;
};

export type RpcPluginLifecycleMetadata = {
  activatedOnce: boolean;
  approvedAt: string | null;
  approvedBy: string | null;
  disabledAt: string | null;
  discoveredAt: string | null;
  enabled: boolean;
  failureReason: string | null;
  lastActionAt: string | null;
  lastActionBy: string | null;
  restartRequired: boolean;
  settings: RpcPluginLifecycleSettings;
  state:
    | "uninitialized"
    | "needs_review"
    | "active"
    | "failed"
    | "degraded"
    | "disabled"
    | "restart_required"
    | "missing"
    | "unavailable";
  crashLoop: RpcPluginLifecycleCrashLoop;
};

export type RpcPluginInventoryPlugin = {
  pluginId: string | null;
  name: string | null;
  directoryName: string;
  folderPath: string;
  version: string | null;
  description: string | null;
  status: RpcPluginInventoryStatus;
  group: RpcPluginInventoryGroupLabel;
  structurallyValid: boolean;
  hasRootNodeModules: boolean;
  currentReviewHash: string | null;
  approvedReviewHash: string | null;
  lifecycleMessage: string | null;
  lifecycle: RpcPluginLifecycleMetadata;
  adminActions: RpcPluginAdminActionAvailability[];
  dataUsage: RpcPluginDataUsage;
  validationErrors: RpcPluginInventoryIssue[];
  reviewWarnings: RpcPluginInventoryIssue[];
  manifest: RpcPluginManifestReviewSummary;
};

export type RpcPluginLifecycleAction =
  | "enable"
  | "review_changes"
  | "reapprove"
  | "disable"
  | "retry";

export type RpcPluginLifecycleActionResult = {
  action: RpcPluginLifecycleAction;
  directoryName: string;
  inventory: RpcPluginInventory;
  message: string;
  plugin: RpcPluginInventoryPlugin;
};

export type RpcPluginAdminActionResult = {
  action: RpcPluginAdminAction;
  directoryName: string;
  inventory: RpcPluginInventory;
  message: string;
  path: string | null;
  plugin: RpcPluginInventoryPlugin;
};

export type RpcPluginSidecarStderrLine = {
  line: string;
  observedAt: string;
};

export type RpcPluginSidecarFailureDiagnostic = {
  code: string;
  message: string;
  observedAt: string;
  operation: string;
};

export type RpcPluginSqliteNativeSecurityDiagnostic = {
  action: string | null;
  arch: string;
  checkedAt: string;
  extensionPath: string | null;
  message: string;
  mode: "disabled" | "optional";
  platform: string;
  severity: "info" | "warning";
  status: "disabled" | "failed" | "loaded" | "missing";
  target: string | null;
};

export type RpcPluginSecurityDiagnostics = {
  sqliteNativeSecurity: RpcPluginSqliteNativeSecurityDiagnostic;
};

export type RpcPluginSidecarDiagnostics = {
  directoryName: string;
  pluginId: string | null;
  failures: {
    items: RpcPluginSidecarFailureDiagnostic[];
    limit: number;
    retainedCount: number;
  };
  paths: {
    dataPath: string | null;
    folderPath: string | null;
    logsPath: string | null;
  };
  quota: {
    settings: RpcPluginLifecycleSettings["quota"];
    usage: RpcPluginDataUsage;
  } | null;
  review: {
    approvedReviewHash: string | null;
    currentReviewHash: string | null;
    lifecycleMessage: string | null;
    lifecycleState: RpcPluginLifecycleMetadata["state"] | null;
    status: RpcPluginInventoryStatus | null;
  };
  stderr: {
    lines: RpcPluginSidecarStderrLine[];
    limit: number;
    retainedLineCount: number;
  };
  telemetryEnabled: boolean | null;
};

export type RpcPluginInventoryGroup = {
  label: RpcPluginInventoryGroupLabel;
  count: number;
  plugins: RpcPluginInventoryPlugin[];
};

export type RpcPluginInventory = {
  pluginsDirectoryPath: string;
  pluginsDirectoryExists: boolean;
  scannedAt: string;
  plugins: RpcPluginInventoryPlugin[];
  groups: RpcPluginInventoryGroup[];
  issues: RpcPluginInventoryIssue[];
};
