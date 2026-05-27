/**
 * @file src/bun/plugin/inventory.ts
 * @description Local-operator-facing Metidos plugin inventory grouping built from safe discovery data.
 */

import { lstat, readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  RPC_PLUGIN_INVENTORY_GROUP_LABELS,
  type RpcPluginAdminAction,
  type RpcPluginAdminActionAvailability,
  type RpcPluginDataUsage,
  type RpcPluginInventory,
  type RpcPluginInventoryGroupLabel,
  type RpcPluginInventoryIssue,
  type RpcPluginInventoryPlugin,
  type RpcPluginInventoryStatus,
  type RpcPluginLifecycleMetadata,
  type RpcPluginManifestAccessGroupSummary,
  type RpcPluginManifestEnvVarSummary,
  type RpcPluginManifestFileSummary,
  type RpcPluginManifestGcSummary,
  type RpcPluginManifestIngressSourceSummary,
  type RpcPluginManifestNetworkSummary,
  type RpcPluginManifestPiAuthSummary,
  type RpcPluginManifestProviderSummary,
  type RpcPluginManifestReviewSummary,
  type RpcPluginManifestSettingDefault,
  type RpcPluginManifestSettingSummary,
  type RpcPluginManifestStorageDefaultsSummary,
  type RpcPluginManifestToolSummary,
} from "../rpc-schema/plugin";
import {
  discoverPluginCandidates,
  type PluginDiscoveryCandidate,
  type PluginDiscoveryIssue,
  type PluginDiscoveryOptions,
  type PluginDiscoverySnapshot,
} from "./discovery";
import { reviewValueForPluginEnvDeclaration } from "./env";
import { type PluginManifestV1, parsePluginManifest } from "./manifest";

const MAX_PLUGIN_MANIFEST_BYTES = 512 * 1024;
const MAX_PLUGIN_DATA_USAGE_SCAN_FILES = 20_000;
const MAX_PLUGIN_DATA_USAGE_SCAN_ENTRIES = 50_000;
const MAX_PLUGIN_DATA_USAGE_SCAN_BYTES = 512 * 1024 * 1024;
const MAX_PLUGIN_DATA_USAGE_SCAN_DEPTH = 64;

export type PluginInventoryLifecycleState =
  | "needs_review"
  | "active"
  | "failed"
  | "degraded"
  | "disabled"
  | "restart_required"
  | "missing"
  | "unavailable";

export type PluginInventoryLifecycleSummary = {
  state: PluginInventoryLifecycleState;
  reason?: string;
  issues?: RpcPluginInventoryIssue[];
};

export type PluginInventoryBuildOptions = PluginDiscoveryOptions & {
  lifecycleByDirectoryName?: ReadonlyMap<
    string,
    PluginInventoryLifecycleSummary
  >;
  lifecycleByPluginId?: ReadonlyMap<string, PluginInventoryLifecycleSummary>;
};

type PluginManifestSummary = {
  pluginId: string | null;
  name: string | null;
  version: string | null;
  description: string | null;
  issues: RpcPluginInventoryIssue[];
  warnings: RpcPluginInventoryIssue[];
  review: RpcPluginManifestReviewSummary;
};

const EMPTY_MANIFEST_REVIEW_SUMMARY: RpcPluginManifestReviewSummary = {
  access: [],
  color: null,
  crons: [],
  env: [],
  files: {
    allow: {
      delete: [],
      read: [],
      write: [],
    },
    deny: {
      delete: [],
      read: [],
      write: [],
    },
  },
  gc: null,
  ingressSources: [],
  limits: {},
  metidosApiVersion: null,
  network: null,
  notificationProviders: [],
  oauthProviders: [],
  piAuth: [],
  permissions: [],
  providers: [],
  settings: [],
  storageDefaults: null,
  telemetry: null,
};

const EMPTY_MANIFEST_SUMMARY: PluginManifestSummary = {
  pluginId: null,
  name: null,
  version: null,
  description: null,
  issues: [],
  review: EMPTY_MANIFEST_REVIEW_SUMMARY,
  warnings: [],
};

const PLUGIN_ADMIN_ACTION_LABELS: Record<RpcPluginAdminAction, string> = {
  open_data: "Open .data",
  open_logs: "Open .logs",
  reset_data: "Reset Plugin Data",
  run_gc: "Run Plugin GC",
};

const DEFAULT_PLUGIN_LIFECYCLE_METADATA: RpcPluginLifecycleMetadata = {
  activatedOnce: false,
  approvedAt: null,
  approvedBy: null,
  crashLoop: {
    crashCount: 0,
    lastCrashAt: null,
    threshold: 3,
    thresholdReached: false,
    windowMs: 60_000,
  },
  disabledAt: null,
  discoveredAt: null,
  enabled: false,
  failureReason: null,
  lastActionAt: null,
  lastActionBy: null,
  restartRequired: false,
  settings: {
    log: {
      enabled: false,
      maxBytes: 25 * 1024 * 1024,
      retentionDays: 14,
    },
    notifications: {
      enabled: true,
      perDayLimit: 25,
      perMinuteLimit: 3,
    },
    quota: {
      maxDataBytes: 100 * 1024 * 1024,
      maxFileBytes: 10 * 1024 * 1024,
      maxFiles: 10_000,
    },
  },
  state: "uninitialized",
};

const PLUGIN_MANAGED_DIRECTORY_NAMES = [".data", ".logs"] as const;

type PluginManagedDirectoryName =
  (typeof PLUGIN_MANAGED_DIRECTORY_NAMES)[number];

type PluginManagedDirectoryState = {
  exists: boolean;
  hasEntries: boolean;
  isDirectory: boolean;
  path: string;
};

function pluginAdminActionAvailability(input: {
  action: RpcPluginAdminAction;
  available: boolean;
  destructive?: boolean;
  path?: string | null;
  reason?: string | null;
}): RpcPluginAdminActionAvailability {
  return {
    action: input.action,
    available: input.available,
    destructive: input.destructive ?? false,
    label: PLUGIN_ADMIN_ACTION_LABELS[input.action],
    path: input.path ?? null,
    reason: input.reason ?? null,
  };
}

export function isPathContainedByDirectory(
  parentDirectoryPath: string,
  candidatePath: string,
): boolean {
  const resolvedParentPath = resolve(parentDirectoryPath);
  const resolvedCandidatePath = resolve(candidatePath);
  const relativePath = relative(resolvedParentPath, resolvedCandidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.includes(`..${sep}`))
  );
}

export function resolvePluginManagedDirectoryPath(
  pluginPath: string,
  directoryName: PluginManagedDirectoryName,
): string {
  const resolvedPluginPath = resolve(pluginPath);
  const targetPath = resolve(resolvedPluginPath, directoryName);
  if (!isPathContainedByDirectory(resolvedPluginPath, targetPath)) {
    throw new Error(
      `Plugin managed directory ${directoryName} escaped its plugin root.`,
    );
  }
  return targetPath;
}

async function inspectPluginManagedDirectory(
  pluginPath: string,
  directoryName: PluginManagedDirectoryName,
): Promise<PluginManagedDirectoryState> {
  const path = resolvePluginManagedDirectoryPath(pluginPath, directoryName);
  try {
    const stat = await lstat(path);
    const isDirectory = stat.isDirectory();
    let hasEntries = false;
    if (isDirectory) {
      try {
        hasEntries = (await readdir(path)).length > 0;
      } catch {
        hasEntries = false;
      }
    }
    return {
      exists: true,
      hasEntries,
      isDirectory,
      path,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        exists: false,
        hasEntries: false,
        isDirectory: false,
        path,
      };
    }
    return {
      exists: true,
      hasEntries: false,
      isDirectory: false,
      path,
    };
  }
}

async function collectDirectoryUsage(
  directoryPath: string,
  state: { bytes: number; entries: number; files: number } = {
    bytes: 0,
    entries: 0,
    files: 0,
  },
  depth = 0,
): Promise<Pick<RpcPluginDataUsage, "bytes" | "files">> {
  if (depth > MAX_PLUGIN_DATA_USAGE_SCAN_DEPTH) {
    throw new Error("Plugin .data usage scan depth limit exceeded.");
  }
  const entries = await readdir(directoryPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = join(directoryPath, entry.name);
    state.entries += 1;
    if (state.entries > MAX_PLUGIN_DATA_USAGE_SCAN_ENTRIES) {
      throw new Error("Plugin .data usage scan entry limit exceeded.");
    }
    const stat = await lstat(entryPath);
    if (stat.isDirectory()) {
      await collectDirectoryUsage(entryPath, state, depth + 1);
      continue;
    }
    state.files += 1;
    state.bytes += stat.size;
    if (
      state.files > MAX_PLUGIN_DATA_USAGE_SCAN_FILES ||
      state.bytes > MAX_PLUGIN_DATA_USAGE_SCAN_BYTES
    ) {
      throw new Error("Plugin .data usage scan limit exceeded.");
    }
  }
  return { bytes: state.bytes, files: state.files };
}

async function calculatePluginDataUsage(
  pluginPath: string,
): Promise<RpcPluginDataUsage> {
  const scannedAt = new Date().toISOString();
  const dataPath = resolvePluginManagedDirectoryPath(pluginPath, ".data");
  try {
    const stat = await lstat(dataPath);
    if (!stat.isDirectory()) {
      return {
        bytes: 0,
        files: 0,
        scannedAt,
        unavailableReason: "Plugin .data exists but is not a directory.",
      };
    }
    return {
      ...(await collectDirectoryUsage(dataPath)),
      scannedAt,
      unavailableReason: null,
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        bytes: 0,
        files: 0,
        scannedAt,
        unavailableReason: null,
      };
    }
    return {
      bytes: 0,
      files: 0,
      scannedAt,
      unavailableReason: "Plugin .data usage could not be inspected.",
    };
  }
}

async function buildPluginAdminActionAvailability(input: {
  candidate: PluginDiscoveryCandidate;
  manifest: PluginManifestSummary;
  status: RpcPluginInventoryStatus;
}): Promise<RpcPluginAdminActionAvailability[]> {
  const dataDirectory = await inspectPluginManagedDirectory(
    input.candidate.pluginPath,
    ".data",
  );
  const logsDirectory = await inspectPluginManagedDirectory(
    input.candidate.pluginPath,
    ".logs",
  );
  const active = input.status === "active";
  const activationReason =
    "Approve and activate this plugin before using plugin storage, log, reset, or GC local actions.";
  const dataUnavailableReason = dataDirectory.exists
    ? "Plugin .data exists but is not a directory."
    : "Plugin .data is not provisioned yet.";
  const logsUnavailableReason = logsDirectory.exists
    ? logsDirectory.isDirectory
      ? "No plugin logs are available yet."
      : "Plugin .logs exists but is not a directory."
    : "No plugin logs are available yet.";
  const gcEnabled = input.manifest.review.gc?.enabled === true;

  return [
    pluginAdminActionAvailability({
      action: "open_data",
      available: active && dataDirectory.exists && dataDirectory.isDirectory,
      path: dataDirectory.path,
      reason:
        active && dataDirectory.exists && dataDirectory.isDirectory
          ? null
          : active
            ? dataUnavailableReason
            : activationReason,
    }),
    pluginAdminActionAvailability({
      action: "open_logs",
      available:
        active &&
        logsDirectory.exists &&
        logsDirectory.isDirectory &&
        logsDirectory.hasEntries,
      path: logsDirectory.path,
      reason:
        active &&
        logsDirectory.exists &&
        logsDirectory.isDirectory &&
        logsDirectory.hasEntries
          ? null
          : active
            ? logsUnavailableReason
            : activationReason,
    }),
    pluginAdminActionAvailability({
      action: "reset_data",
      available: active,
      destructive: true,
      path: dataDirectory.path,
      reason: active ? null : activationReason,
    }),
    pluginAdminActionAvailability({
      action: "run_gc",
      available: active && gcEnabled,
      path: null,
      reason: active
        ? gcEnabled
          ? null
          : "Plugin does not declare enabled GC."
        : activationReason,
    }),
  ];
}

function toInventoryIssue(
  issue: PluginDiscoveryIssue,
): RpcPluginInventoryIssue {
  return {
    code: issue.code,
    message: issue.message,
    path: issue.path,
    ...(issue.fileName ? { fileName: issue.fileName } : {}),
  };
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function stringArrayValue(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function booleanValueOrDefault(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function manifestSettingDefaultValue(
  value: unknown,
): RpcPluginManifestSettingDefault {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  return stringArrayValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordArrayValue(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readStringArrayProperty(
  record: Record<string, unknown>,
  propertyName: string,
): string[] {
  return stringArrayValue(record[propertyName]);
}

function manifestToolSummary(
  value: Record<string, unknown>,
): RpcPluginManifestToolSummary {
  return {
    description: stringValue(value.description),
    name: stringValue(value.name),
    timeoutMs: numberValue(value.timeoutMs),
  };
}

const manifestInjectionSummary = manifestToolSummary;

function manifestAccessSummary(
  value: unknown,
  pluginColor: string | null,
): RpcPluginManifestAccessGroupSummary[] {
  return recordArrayValue(value).map((group) => ({
    description: stringValue(group.description),
    id: stringValue(group.id),
    name: stringValue(group.name),
    color: pluginColor,
    tools: recordArrayValue(group.tools).map(manifestToolSummary),
    injects: recordArrayValue(group.injects).map(manifestInjectionSummary),
  }));
}

function manifestFileAccessSummary(value: unknown) {
  if (!isRecord(value)) {
    return { delete: [], read: [], write: [] };
  }
  return {
    delete: readStringArrayProperty(value, "delete"),
    read: readStringArrayProperty(value, "read"),
    write: readStringArrayProperty(value, "write"),
  };
}

function manifestFileSummary(value: unknown): RpcPluginManifestFileSummary {
  if (!isRecord(value)) {
    return EMPTY_MANIFEST_REVIEW_SUMMARY.files;
  }
  return {
    allow: manifestFileAccessSummary(value.allow),
    deny: manifestFileAccessSummary(value.deny),
  };
}

function manifestNetworkSummary(
  value: unknown,
): RpcPluginManifestNetworkSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    allow: readStringArrayProperty(value, "allow"),
    enforceHttps: Object.hasOwn(value, "enforceHttps")
      ? booleanValue(value.enforceHttps)
      : true,
    webSocketAllow: readStringArrayProperty(value, "webSocketAllow"),
  };
}

function manifestEnvSummary(value: unknown): RpcPluginManifestEnvVarSummary[] {
  return recordArrayValue(value).map((envVar) => {
    const declaration = {
      defaultValue: stringValue(envVar.default),
      description: stringValue(envVar.description),
      hasDefault: typeof envVar.default === "string",
      key: stringValue(envVar.key),
      required: booleanValue(envVar.required),
      secret: booleanValue(envVar.secret),
    };
    return {
      ...declaration,
      reviewValue: reviewValueForPluginEnvDeclaration(declaration),
    };
  });
}

function manifestSettingItemSummary(
  value: unknown,
): RpcPluginManifestSettingSummary["items"] {
  if (!isRecord(value)) {
    return null;
  }
  return {
    kind: stringValue(value.kind),
  };
}

function manifestSettingSummaryValue(
  setting: Record<string, unknown>,
): RpcPluginManifestSettingSummary {
  return {
    defaultValue: manifestSettingDefaultValue(setting.defaultValue),
    description: stringValue(setting.description),
    hasDefault: booleanValueOrDefault(setting.hasDefault, false),
    items: manifestSettingItemSummary(setting.items),
    key: stringValue(setting.key),
    kind: stringValue(setting.kind),
    label: stringValue(setting.label),
    options: stringArrayValue(setting.options),
    required: booleanValue(setting.required),
  };
}

function manifestSettingSummary(
  value: unknown,
): RpcPluginManifestSettingSummary[] {
  if (Array.isArray(value)) {
    return recordArrayValue(value).map(manifestSettingSummaryValue);
  }
  if (!isRecord(value)) {
    return [];
  }
  return [
    ...recordArrayValue(value.general),
    ...recordArrayValue(value.global),
    ...recordArrayValue(value.user),
  ].map(manifestSettingSummaryValue);
}

function manifestIngressSourceSummary(
  value: unknown,
): RpcPluginManifestIngressSourceSummary[] {
  return recordArrayValue(value).map((source) => ({
    description: stringValue(source.description),
    id: stringValue(source.id),
    name: stringValue(source.name),
    pollIntervalMs: numberValue(source.pollIntervalMs),
    supportsReplyToSource: source.supportsReplyToSource === true,
    timeoutMs: numberValue(source.timeoutMs),
  }));
}

function manifestProviderSummary(
  value: unknown,
): RpcPluginManifestProviderSummary[] {
  return recordArrayValue(value).map((provider) => ({
    description: stringValue(provider.description),
    id: stringValue(provider.id),
    name: stringValue(provider.name),
    timeoutMs: numberValue(provider.timeoutMs),
  }));
}

function manifestPiAuthSummary(
  value: unknown,
): RpcPluginManifestPiAuthSummary[] {
  return recordArrayValue(value).map((binding) => ({
    kind: stringValue(binding.kind),
    provider: stringValue(binding.provider),
    source: stringValue(binding.source),
    value: stringValue(binding.value),
  }));
}

function manifestStorageDefaultsSummary(
  value: unknown,
): RpcPluginManifestStorageDefaultsSummary | null {
  if (!isRecord(value) || !isRecord(value.defaults)) {
    return null;
  }
  return {
    maxDataBytes: numberValue(value.defaults.maxDataBytes),
    maxFileBytes: numberValue(value.defaults.maxFileBytes),
    maxFiles: numberValue(value.defaults.maxFiles),
  };
}

function manifestGcSummary(value: unknown): RpcPluginManifestGcSummary | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    enabled: booleanValue(value.enabled),
    timeoutMs: numberValue(value.timeoutMs),
  };
}

function manifestCronSummary(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((cron) => {
    if (typeof cron === "string") {
      return [cron];
    }
    if (isRecord(cron)) {
      return [stringValue(cron.key) ?? stringValue(cron.name)].filter(
        (item): item is string => item !== null,
      );
    }
    return [];
  });
}

function manifestReviewSummary(
  manifest: Record<string, unknown>,
): RpcPluginManifestReviewSummary {
  const color = stringValue(manifest.color);
  return {
    access: manifestAccessSummary(manifest.access, color),
    color,
    crons: manifestCronSummary(manifest.crons),
    env: manifestEnvSummary(manifest.env),
    files: manifestFileSummary(manifest.files),
    gc: manifestGcSummary(manifest.gc),
    ingressSources: manifestIngressSourceSummary(manifest.ingressSources),
    limits: isRecord(manifest.limits) ? manifest.limits : {},
    metidosApiVersion: stringValue(manifest.metidosApiVersion),
    network: manifestNetworkSummary(manifest.network),
    notificationProviders: manifestProviderSummary(
      manifest.notificationProviders,
    ),
    oauthProviders: manifestProviderSummary(manifest.oauthProviders),
    piAuth: manifestPiAuthSummary(manifest.piAuth),
    permissions: stringArrayValue(manifest.permissions),
    providers: manifestProviderSummary(manifest.providers),
    settings: manifestSettingSummary(manifest.settings),
    storageDefaults: manifestStorageDefaultsSummary(manifest.storage),
    telemetry: Object.hasOwn(manifest, "telemetry")
      ? booleanValue(manifest.telemetry)
      : true,
  };
}

function normalizedManifestReviewRecord(
  manifest: PluginManifestV1,
): Record<string, unknown> {
  return {
    id: manifest.id,
    main: manifest.main,
    metidosApiVersion: manifest.metidosApiVersion,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    color: manifest.color,
    crons: manifest.raw.crons,
    access: manifest.access,
    env: manifest.env,
    files: manifest.files,
    gc: manifest.gc,
    ingressSources: manifest.ingressSources,
    limits: manifest.limits,
    network: manifest.network,
    notificationProviders: manifest.notificationProviders,
    oauthProviders: manifest.oauthProviders,
    piAuth: manifest.piAuth,
    permissions: manifest.permissions,
    providers: manifest.providers,
    settings: manifest.settings,
    storage: manifest.storage,
    telemetry: manifest.telemetry,
  };
}

function networkPatternHostname(pattern: string): string | null {
  try {
    const normalizedPattern = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//u.test(pattern)
      ? pattern
      : pattern.startsWith("//")
        ? `https:${pattern}`
        : `https://${pattern}`;
    return new URL(normalizedPattern).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function manifestAllowsAllDomains(
  network: RpcPluginManifestNetworkSummary | null,
): boolean {
  const patterns = [
    ...(network?.allow ?? []),
    ...(network?.webSocketAllow ?? []),
  ];
  return patterns.some((pattern) => {
    const hostname = networkPatternHostname(pattern);
    return hostname === "*" || hostname === "**";
  });
}

function manifestAllowsLocalOrPrivateNetwork(
  network: RpcPluginManifestNetworkSummary | null,
): boolean {
  const patterns = [
    ...(network?.allow ?? []),
    ...(network?.webSocketAllow ?? []),
  ];
  return patterns.some((pattern) => {
    try {
      const hostname = networkPatternHostname(pattern);
      if (!hostname) return false;
      return (
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname === "127.0.0.1" ||
        hostname.startsWith("127.") ||
        hostname === "::1" ||
        hostname === "[::1]" ||
        hostname.startsWith("10.") ||
        hostname.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./u.test(hostname)
      );
    } catch {
      return false;
    }
  });
}

async function readManifestSummary(
  candidate: PluginDiscoveryCandidate,
): Promise<PluginManifestSummary> {
  const manifestFile = candidate.requiredFiles["metidos-plugin.json"];
  if (!manifestFile.exists || !manifestFile.isFile || !manifestFile.readable) {
    return EMPTY_MANIFEST_SUMMARY;
  }

  let rawManifest: string;
  try {
    const manifestStat = await lstat(manifestFile.path);
    if (!manifestStat.isFile()) {
      return {
        ...EMPTY_MANIFEST_SUMMARY,
        issues: [
          {
            code: "invalid_required_file_type",
            fileName: "metidos-plugin.json",
            message:
              "Required plugin root entry metidos-plugin.json must be a file.",
            path: manifestFile.path,
          },
        ],
      };
    }
    if (manifestStat.size > MAX_PLUGIN_MANIFEST_BYTES) {
      return {
        ...EMPTY_MANIFEST_SUMMARY,
        issues: [
          {
            code: "manifest_too_large",
            fileName: "metidos-plugin.json",
            message: `Plugin manifest is limited to ${MAX_PLUGIN_MANIFEST_BYTES} bytes.`,
            path: manifestFile.path,
          },
        ],
      };
    }
    rawManifest = await readFile(manifestFile.path, "utf8");
  } catch {
    return {
      ...EMPTY_MANIFEST_SUMMARY,
      issues: [
        {
          code: "unreadable_manifest",
          fileName: "metidos-plugin.json",
          message: "Plugin manifest could not be read for inventory display.",
          path: manifestFile.path,
        },
      ],
    };
  }

  const parsedManifest = parsePluginManifest(rawManifest, manifestFile.path);
  if (!parsedManifest.manifest) {
    return {
      ...EMPTY_MANIFEST_SUMMARY,
      issues: parsedManifest.issues,
    };
  }

  const manifest = parsedManifest.manifest;
  const issues = [...parsedManifest.issues];
  const manifestIdAlreadyInvalid = issues.some((issue) =>
    issue.path.endsWith("#/id"),
  );
  if (!manifestIdAlreadyInvalid && manifest.id !== candidate.directoryName) {
    issues.push({
      code: "plugin_id_directory_mismatch",
      fileName: "metidos-plugin.json",
      message:
        "Plugin manifest id must match its APP_DATA/plugins/{plugin_id} directory name before lifecycle state can be persisted.",
      path: manifestFile.path,
    });
  }
  const review = manifestReviewSummary(
    normalizedManifestReviewRecord(manifest),
  );
  const warnings: RpcPluginInventoryIssue[] = [];
  if (review.permissions.includes("unsafe")) {
    warnings.push({
      code: "unsafe_permission_declared",
      fileName: "metidos-plugin.json",
      message:
        "Plugin declares the unsafe permission and requires elevated local-operator review before activation.",
      path: manifestFile.path,
    });
  }
  if (manifestAllowsLocalOrPrivateNetwork(review.network)) {
    warnings.push({
      code: "private_network_allow_declared",
      fileName: "metidos-plugin.json",
      message:
        "Plugin network allowlists include localhost or private LAN targets. Safe runtime defaults still block those targets; reaching them requires listing this plugin in METIDOS_PLUGIN_UNSAFE_PRIVATE_NETWORK_PLUGINS and plugin unsafe approval.",
      path: manifestFile.path,
    });
  }
  if (manifestAllowsAllDomains(review.network)) {
    warnings.push({
      code: "unsafe_all_domain_network_declared",
      fileName: "metidos-plugin.json",
      message:
        "Plugin network allowlists include all-domain host access. This requires the unsafe permission and allows outbound requests to arbitrary public hosts covered by the URL path pattern.",
      path: manifestFile.path,
    });
  }

  return {
    pluginId: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    issues,
    review,
    warnings,
  };
}

function lifecycleToStatus(
  lifecycle: PluginInventoryLifecycleSummary | undefined,
): RpcPluginInventoryStatus | null {
  switch (lifecycle?.state) {
    case "needs_review":
      return "needs_review";
    case "active":
      return "active";
    case "failed":
    case "degraded":
      return "failed_degraded";
    case "disabled":
    case "restart_required":
      return "disabled_restart_required";
    case "missing":
    case "unavailable":
      return "missing_unavailable";
    default:
      return null;
  }
}

export function pluginInventoryGroupLabelForStatus(
  status: RpcPluginInventoryStatus,
): RpcPluginInventoryGroupLabel {
  switch (status) {
    case "needs_review":
      return "Needs Review";
    case "active":
      return "Active";
    case "failed_degraded":
      return "Failed/Degraded";
    case "disabled_restart_required":
      return "Disabled/Restart Required";
    case "missing_unavailable":
      return "Missing/Unavailable";
    case "uninitialized":
      return "Uninitialized";
  }
}

function resolveLifecycleSummary(
  candidate: PluginDiscoveryCandidate,
  manifest: PluginManifestSummary,
  options: Pick<
    PluginInventoryBuildOptions,
    "lifecycleByDirectoryName" | "lifecycleByPluginId"
  >,
): PluginInventoryLifecycleSummary | undefined {
  if (manifest.pluginId) {
    const byPluginId = options.lifecycleByPluginId?.get(manifest.pluginId);
    if (byPluginId) {
      return byPluginId;
    }
  }
  return options.lifecycleByDirectoryName?.get(candidate.directoryName);
}

async function buildInventoryPlugin(
  candidate: PluginDiscoveryCandidate,
  options: Pick<
    PluginInventoryBuildOptions,
    "lifecycleByDirectoryName" | "lifecycleByPluginId"
  >,
): Promise<RpcPluginInventoryPlugin> {
  const manifest = await readManifestSummary(candidate);
  const lifecycle = resolveLifecycleSummary(candidate, manifest, options);
  const status = lifecycleToStatus(lifecycle) ?? "uninitialized";
  const validationErrors = [
    ...candidate.issues.map(toInventoryIssue),
    ...manifest.issues,
    ...(lifecycle?.issues ?? []),
  ];
  const reviewWarnings = [...manifest.warnings];
  if (lifecycle?.reason) {
    reviewWarnings.push({
      code: "lifecycle_state_reason",
      message: lifecycle.reason,
      path: candidate.pluginPath,
    });
  }

  const [adminActions, dataUsage] = await Promise.all([
    buildPluginAdminActionAvailability({
      candidate,
      manifest,
      status,
    }),
    calculatePluginDataUsage(candidate.pluginPath),
  ]);

  return {
    adminActions,
    approvedReviewHash: null,
    currentReviewHash: null,
    dataUsage,
    description: manifest.description,
    directoryName: candidate.directoryName,
    folderPath: candidate.pluginPath,
    group: pluginInventoryGroupLabelForStatus(status),
    hasRootNodeModules: candidate.hasRootNodeModules,
    lifecycle: DEFAULT_PLUGIN_LIFECYCLE_METADATA,
    lifecycleMessage: lifecycle?.reason ?? null,
    manifest: manifest.review,
    name: manifest.name,
    pluginId: manifest.pluginId,
    reviewWarnings,
    status,
    structurallyValid: candidate.structurallyValid,
    validationErrors,
    version: manifest.version,
  };
}

function duplicatePluginIdIssue(
  plugin: RpcPluginInventoryPlugin,
): RpcPluginInventoryIssue {
  return {
    code: "duplicate_plugin_id",
    fileName: "metidos-plugin.json",
    message: `Plugin id ${plugin.pluginId} must be unique across APP_DATA/plugins before lifecycle state can be persisted or runtime loading can start.`,
    path: join(plugin.folderPath, "metidos-plugin.json"),
  };
}

function withUniquePluginIdValidation(
  plugins: RpcPluginInventoryPlugin[],
): RpcPluginInventoryPlugin[] {
  const counts = new Map<string, number>();
  for (const plugin of plugins) {
    if (!plugin.pluginId) {
      continue;
    }
    counts.set(plugin.pluginId, (counts.get(plugin.pluginId) ?? 0) + 1);
  }

  return plugins.map((plugin) => {
    if (!plugin.pluginId || (counts.get(plugin.pluginId) ?? 0) <= 1) {
      return plugin;
    }
    return {
      ...plugin,
      validationErrors: [
        ...plugin.validationErrors,
        duplicatePluginIdIssue(plugin),
      ],
    };
  });
}

export async function buildPluginInventoryFromDiscoverySnapshot(
  snapshot: PluginDiscoverySnapshot,
  options: Pick<
    PluginInventoryBuildOptions,
    "lifecycleByDirectoryName" | "lifecycleByPluginId"
  > = {},
): Promise<RpcPluginInventory> {
  const builtPlugins: RpcPluginInventoryPlugin[] = [];
  for (const candidate of snapshot.candidates) {
    builtPlugins.push(await buildInventoryPlugin(candidate, options));
  }
  const plugins = withUniquePluginIdValidation(builtPlugins);
  const groups = RPC_PLUGIN_INVENTORY_GROUP_LABELS.map((label) => {
    const groupPlugins = plugins.filter((plugin) => plugin.group === label);
    return {
      count: groupPlugins.length,
      label,
      plugins: groupPlugins,
    };
  });

  return {
    groups,
    issues: snapshot.issues.map(toInventoryIssue),
    plugins,
    pluginsDirectoryExists: snapshot.pluginsDirectoryExists,
    pluginsDirectoryPath: snapshot.pluginsDirectoryPath,
    scannedAt: snapshot.scannedAt,
  };
}

export async function buildPluginInventory(
  options: PluginInventoryBuildOptions = {},
): Promise<RpcPluginInventory> {
  const snapshot = await discoverPluginCandidates(options);
  return await buildPluginInventoryFromDiscoverySnapshot(snapshot, options);
}
