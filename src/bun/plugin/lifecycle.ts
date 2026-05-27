/**
 * @file src/bun/plugin/lifecycle.ts
 * @description Local-operator-only Plugin System v1 review and lifecycle state persistence.
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import { type AppDataPathOptions, getAppDataDirectoryPath } from "../db";
import type {
  RpcPluginAdminAction,
  RpcPluginAdminActionResult,
  RpcPluginInventory,
  RpcPluginInventoryIssue,
  RpcPluginInventoryPlugin,
  RpcPluginLifecycleAction,
  RpcPluginLifecycleActionResult,
  RpcPluginLifecycleCrashLoop,
  RpcPluginLifecycleMetadata,
  RpcPluginLifecycleSettings,
} from "../rpc-schema/plugin";
import { RPC_PLUGIN_INVENTORY_GROUP_LABELS } from "../rpc-schema/plugin";
import {
  type PluginDataResetResult,
  PluginGcError,
  resetPluginDataRoot,
} from "./data";
import {
  discoverPluginCandidates,
  type PluginDiscoveryCandidate,
} from "./discovery";
import {
  buildPluginInventoryFromDiscoverySnapshot,
  isPathContainedByDirectory,
  type PluginInventoryLifecycleState,
  type PluginInventoryLifecycleSummary,
  resolvePluginManagedDirectoryPath,
} from "./inventory";

const PLUGIN_LIFECYCLE_STATE_FILE_NAME = "plugin-lifecycle-v1.json";
const REVIEW_HASH_EXCLUDED_ROOT_DIRECTORY_NAMES = new Set([".data", ".logs"]);
const REVIEW_HASH_STATE_VERSION = 1;
const MAX_REVIEW_HASH_FILES = 20_000;
const MAX_REVIEW_HASH_ENTRIES = 50_000;
const MAX_REVIEW_HASH_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REVIEW_HASH_DEPTH = 64;
const DEFAULT_PLUGIN_QUOTA_SETTINGS = {
  maxDataBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 10_000,
};
const DEFAULT_PLUGIN_LOG_SETTINGS = {
  enabled: false,
  maxBytes: 25 * 1024 * 1024,
  retentionDays: 14,
};
const DEFAULT_PLUGIN_NOTIFICATION_SETTINGS = {
  enabled: true,
  perDayLimit: 25,
  perMinuteLimit: 3,
};
// These lifecycle values are persisted for operator review and UI messaging;
// runtime restart suppression lives in the sidecar manager's process-local
// crash timestamps so lifecycle metadata remains portable between processes.
const PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD = 3;
const PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS = 60_000;

type ReviewHashFile = {
  filePath: string;
  reviewPath: string;
  size: number;
};

type ReviewHashScanState = {
  entries: number;
  files: number;
  limitExceeded?: boolean;
  totalBytes: number;
};

type StoredPluginLifecycleState = RpcPluginLifecycleMetadata["state"];

type StoredPluginManifestMetadata = {
  description: string | null;
  metidosApiVersion: string | null;
  name: string | null;
  pluginId: string;
  version: string | null;
};

type StoredPluginLifecycleRecord = {
  activatedOnce: boolean;
  approvedAt?: string;
  approvedBy?: string | null;
  approvedReviewHash?: string;
  crashLoop: RpcPluginLifecycleCrashLoop;
  disabledAt?: string;
  discoveredAt: string;
  enabled: boolean;
  lastActionAt: string;
  lastActionBy?: string | null;
  lastReviewedHash?: string;
  logSettings: RpcPluginLifecycleSettings["log"];
  manifest: StoredPluginManifestMetadata;
  notificationSettings: RpcPluginLifecycleSettings["notifications"];
  pluginId: string;
  quotaSettings: RpcPluginLifecycleSettings["quota"];
  reason?: string;
  restartRequired: boolean;
  state: StoredPluginLifecycleState;
};

type PluginLifecycleStateFile = {
  plugins: Record<string, StoredPluginLifecycleRecord>;
  schema: "metidos.plugin-lifecycle/v1";
  version: number;
};

type PluginReviewHashSuccess = {
  hash: string;
  issues: [];
};

type PluginReviewHashFailure = {
  hash: null;
  issues: RpcPluginInventoryIssue[];
};

type PluginReviewHashResult = PluginReviewHashFailure | PluginReviewHashSuccess;

type LifecycleActionContext = {
  now?: () => Date;
  username?: string | null;
};

export type PluginAdminRuntimeHooks = {
  recordPluginDataResetAudit?: (input: {
    backupPath: string | null;
    dataPath: string;
    directoryName: string;
    pluginId: string | null;
    username: string | null;
  }) => Promise<void> | void;
  restartPluginRuntime?: (directoryName: string) => Promise<void> | void;
  runPluginGc?: (directoryName: string) => Promise<void> | void;
  stopPluginRuntime?: (directoryName: string) => Promise<void> | void;
};

function lifecycleStateFilePath(options?: AppDataPathOptions): string {
  return join(
    getAppDataDirectoryPath(options),
    PLUGIN_LIFECYCLE_STATE_FILE_NAME,
  );
}

function emptyLifecycleStateFile(): PluginLifecycleStateFile {
  return {
    plugins: {},
    schema: "metidos.plugin-lifecycle/v1",
    version: REVIEW_HASH_STATE_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function positiveIntegerValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function nullableStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function lifecycleStateValue(
  value: unknown,
): StoredPluginLifecycleState | undefined {
  return value === "uninitialized" ||
    value === "needs_review" ||
    value === "active" ||
    value === "failed" ||
    value === "degraded" ||
    value === "disabled" ||
    value === "restart_required" ||
    value === "missing" ||
    value === "unavailable"
    ? value
    : undefined;
}

function logSettingsValue(value: unknown): RpcPluginLifecycleSettings["log"] {
  const record = isRecord(value) ? value : {};
  return {
    enabled: booleanValue(record.enabled, DEFAULT_PLUGIN_LOG_SETTINGS.enabled),
    maxBytes: positiveIntegerValue(
      record.maxBytes,
      DEFAULT_PLUGIN_LOG_SETTINGS.maxBytes,
    ),
    retentionDays: positiveIntegerValue(
      record.retentionDays,
      DEFAULT_PLUGIN_LOG_SETTINGS.retentionDays,
    ),
  };
}

function notificationSettingsValue(
  value: unknown,
): RpcPluginLifecycleSettings["notifications"] {
  const record = isRecord(value) ? value : {};
  return {
    enabled: booleanValue(
      record.enabled,
      DEFAULT_PLUGIN_NOTIFICATION_SETTINGS.enabled,
    ),
    perDayLimit: positiveIntegerValue(
      record.perDayLimit,
      DEFAULT_PLUGIN_NOTIFICATION_SETTINGS.perDayLimit,
    ),
    perMinuteLimit: positiveIntegerValue(
      record.perMinuteLimit,
      DEFAULT_PLUGIN_NOTIFICATION_SETTINGS.perMinuteLimit,
    ),
  };
}

function quotaSettingsValue(
  value: unknown,
): RpcPluginLifecycleSettings["quota"] {
  const record = isRecord(value) ? value : {};
  return {
    maxDataBytes: positiveIntegerValue(
      record.maxDataBytes,
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxDataBytes,
    ),
    maxFileBytes: positiveIntegerValue(
      record.maxFileBytes,
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxFileBytes,
    ),
    maxFiles: positiveIntegerValue(
      record.maxFiles,
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxFiles,
    ),
  };
}

function crashLoopValue(value: unknown): RpcPluginLifecycleCrashLoop {
  const record = isRecord(value) ? value : {};
  const crashCount = positiveIntegerValue(record.crashCount, 0);
  return {
    crashCount,
    lastCrashAt: nullableStringValue(record.lastCrashAt),
    threshold: positiveIntegerValue(
      record.threshold,
      PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD,
    ),
    thresholdReached: booleanValue(record.thresholdReached, false),
    windowMs: positiveIntegerValue(
      record.windowMs,
      PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS,
    ),
  };
}

function manifestMetadataValue(
  value: unknown,
  fallbackPluginId: string,
): StoredPluginManifestMetadata {
  const record = isRecord(value) ? value : {};
  return {
    description: nullableStringValue(record.description),
    metidosApiVersion: nullableStringValue(record.metidosApiVersion),
    name: nullableStringValue(record.name),
    pluginId: stringValue(record.pluginId) ?? fallbackPluginId,
    version: nullableStringValue(record.version),
  };
}

function lifecycleRecordValue(
  directoryName: string,
  value: unknown,
): StoredPluginLifecycleRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const state = lifecycleStateValue(value.state);
  const lastActionAt = stringValue(value.lastActionAt);
  const pluginId = stringValue(value.pluginId) ?? directoryName;
  const discoveredAt = stringValue(value.discoveredAt) ?? lastActionAt;
  if (!state || !lastActionAt || !discoveredAt) {
    return null;
  }
  const approvedAt = stringValue(value.approvedAt);
  const approvedReviewHash = stringValue(value.approvedReviewHash);
  const disabledAt = stringValue(value.disabledAt);
  const lastReviewedHash = stringValue(value.lastReviewedHash);
  const reason = stringValue(value.reason);
  return {
    activatedOnce: booleanValue(value.activatedOnce, false),
    ...(approvedAt ? { approvedAt } : {}),
    ...(typeof value.approvedBy === "string" || value.approvedBy === null
      ? { approvedBy: value.approvedBy }
      : {}),
    ...(approvedReviewHash ? { approvedReviewHash } : {}),
    crashLoop: crashLoopValue(value.crashLoop),
    ...(disabledAt ? { disabledAt } : {}),
    discoveredAt,
    enabled: booleanValue(value.enabled, state === "active"),
    lastActionAt,
    ...(typeof value.lastActionBy === "string" || value.lastActionBy === null
      ? { lastActionBy: value.lastActionBy }
      : {}),
    ...(lastReviewedHash ? { lastReviewedHash } : {}),
    logSettings: logSettingsValue(value.logSettings),
    manifest: manifestMetadataValue(value.manifest, pluginId),
    notificationSettings: notificationSettingsValue(value.notificationSettings),
    pluginId,
    quotaSettings: quotaSettingsValue(value.quotaSettings),
    ...(reason ? { reason } : {}),
    restartRequired: booleanValue(
      value.restartRequired,
      state === "restart_required",
    ),
    state,
  };
}

async function readLifecycleStateFile(
  options?: AppDataPathOptions,
): Promise<PluginLifecycleStateFile> {
  const path = lifecycleStateFilePath(options);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return emptyLifecycleStateFile();
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || !isRecord(parsed.plugins)) {
    return emptyLifecycleStateFile();
  }

  const plugins: Record<string, StoredPluginLifecycleRecord> = {};
  for (const [directoryName, value] of Object.entries(parsed.plugins)) {
    const record = lifecycleRecordValue(directoryName, value);
    if (record) {
      plugins[directoryName] = record;
    }
  }

  return {
    plugins,
    schema: "metidos.plugin-lifecycle/v1",
    version: REVIEW_HASH_STATE_VERSION,
  };
}

async function writeLifecycleStateFile(
  stateFile: PluginLifecycleStateFile,
  options?: AppDataPathOptions,
): Promise<void> {
  const path = lifecycleStateFilePath(options);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(
    temporaryPath,
    `${JSON.stringify(
      {
        plugins: Object.fromEntries(
          Object.entries(stateFile.plugins).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
        schema: stateFile.schema,
        version: stateFile.version,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await rename(temporaryPath, path);
}

function isExcludedReviewHashPath(relativePath: string): boolean {
  const [rootName] = relativePath.split("/");
  return (
    rootName === undefined ||
    REVIEW_HASH_EXCLUDED_ROOT_DIRECTORY_NAMES.has(rootName) ||
    rootName.startsWith(".data-bak-")
  );
}

function toReviewHashPath(pluginPath: string, path: string): string {
  return relative(pluginPath, path).split(sep).join("/");
}

function reviewHashIssue(
  code: string,
  path: string,
  message: string,
): RpcPluginInventoryIssue {
  return {
    code,
    message,
    path,
  };
}

// Recursive traversal is bounded by MAX_REVIEW_HASH_DEPTH before following
// child directories, so a malformed plugin tree cannot recurse indefinitely.
async function collectReviewHashFiles(
  pluginPath: string,
  directoryPath: string,
  issues: RpcPluginInventoryIssue[],
  state: ReviewHashScanState = { entries: 0, files: 0, totalBytes: 0 },
  depth = 0,
): Promise<ReviewHashFile[]> {
  if (state.limitExceeded) {
    return [];
  }
  if (depth > MAX_REVIEW_HASH_DEPTH) {
    issues.push(
      reviewHashIssue(
        "review_hash_depth_limit_exceeded",
        directoryPath,
        `Plugin review hashing is limited to ${MAX_REVIEW_HASH_DEPTH} directory levels.`,
      ),
    );
    return [];
  }
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files: ReviewHashFile[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const entryPath = join(directoryPath, entry.name);
    state.entries += 1;
    if (state.entries > MAX_REVIEW_HASH_ENTRIES) {
      state.limitExceeded = true;
      issues.push(
        reviewHashIssue(
          "review_hash_entry_limit_exceeded",
          entryPath,
          `Plugin review hashing is limited to ${MAX_REVIEW_HASH_ENTRIES} file system entries.`,
        ),
      );
      return files;
    }
    const relativePath = toReviewHashPath(pluginPath, entryPath);
    if (isExcludedReviewHashPath(relativePath)) {
      continue;
    }
    if (relativePath === "node_modules") {
      issues.push(
        reviewHashIssue(
          "forbidden_root_node_modules",
          entryPath,
          "Plugin root node_modules/ is forbidden; plugins are built by Metidos after approval and cannot vendor runtime dependencies there.",
        ),
      );
      continue;
    }

    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(entryPath);
    } catch {
      issues.push(
        reviewHashIssue(
          "unreadable_review_hash_entry",
          entryPath,
          "Plugin review hashing could not inspect this file system entry.",
        ),
      );
      continue;
    }
    if (stat.isSymbolicLink()) {
      issues.push(
        reviewHashIssue(
          "unsupported_review_symlink",
          entryPath,
          "Plugin review hashing does not follow symlinks; replace this symlink with a regular file or directory before approval.",
        ),
      );
      continue;
    }
    if (stat.isDirectory()) {
      files.push(
        ...(await collectReviewHashFiles(
          pluginPath,
          entryPath,
          issues,
          state,
          depth + 1,
        )),
      );
      continue;
    }
    if (stat.isFile()) {
      if (state.files >= MAX_REVIEW_HASH_FILES) {
        state.limitExceeded = true;
        issues.push(
          reviewHashIssue(
            "review_hash_file_limit_exceeded",
            entryPath,
            `Plugin review hashing is limited to ${MAX_REVIEW_HASH_FILES} files.`,
          ),
        );
        return files;
      }
      if (state.totalBytes + stat.size > MAX_REVIEW_HASH_TOTAL_BYTES) {
        state.limitExceeded = true;
        issues.push(
          reviewHashIssue(
            "review_hash_byte_limit_exceeded",
            entryPath,
            `Plugin review hashing is limited to ${MAX_REVIEW_HASH_TOTAL_BYTES} bytes.`,
          ),
        );
        return files;
      }
      state.files += 1;
      state.totalBytes += stat.size;
      files.push({
        filePath: entryPath,
        reviewPath: relativePath,
        size: stat.size,
      });
    }
  }
  return files;
}

export async function computePluginReviewHash(
  pluginPath: string,
): Promise<PluginReviewHashResult> {
  const issues: RpcPluginInventoryIssue[] = [];
  let files: ReviewHashFile[];
  try {
    files = await collectReviewHashFiles(pluginPath, pluginPath, issues);
  } catch {
    return {
      hash: null,
      issues: [
        reviewHashIssue(
          "review_hash_failed",
          pluginPath,
          "Plugin review hash could not be computed for approval.",
        ),
      ],
    };
  }

  if (issues.length > 0) {
    return {
      hash: null,
      issues,
    };
  }

  const hash = createHash("sha256");
  for (const file of files.sort((left, right) =>
    left.reviewPath.localeCompare(right.reviewPath),
  )) {
    let contents: Buffer;
    try {
      contents = await readFile(file.filePath);
    } catch {
      issues.push(
        reviewHashIssue(
          "unreadable_review_hash_file",
          file.filePath,
          "Plugin review hashing could not read this file.",
        ),
      );
      continue;
    }
    const fileHash = createHash("sha256");
    fileHash.update(contents);
    hash.update(file.reviewPath);
    hash.update("\0");
    hash.update(fileHash.digest("hex"));
  }

  if (issues.length > 0) {
    return {
      hash: null,
      issues,
    };
  }

  return {
    hash: hash.digest("hex"),
    issues: [],
  };
}

function manifestMetadataFromPlugin(
  plugin: RpcPluginInventoryPlugin,
): StoredPluginManifestMetadata | null {
  if (!plugin.pluginId || plugin.pluginId !== plugin.directoryName) {
    return null;
  }
  return {
    description: plugin.description,
    metidosApiVersion: plugin.manifest.metidosApiVersion,
    name: plugin.name,
    pluginId: plugin.pluginId,
    version: plugin.version,
  };
}

function quotaSettingsFromPlugin(
  plugin: RpcPluginInventoryPlugin,
): RpcPluginLifecycleSettings["quota"] {
  return {
    maxDataBytes:
      plugin.manifest.storageDefaults?.maxDataBytes ??
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxDataBytes,
    maxFileBytes:
      plugin.manifest.storageDefaults?.maxFileBytes ??
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxFileBytes,
    maxFiles:
      plugin.manifest.storageDefaults?.maxFiles ??
      DEFAULT_PLUGIN_QUOTA_SETTINGS.maxFiles,
  };
}

function defaultCrashLoopState(): RpcPluginLifecycleCrashLoop {
  return {
    crashCount: 0,
    lastCrashAt: null,
    threshold: PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD,
    thresholdReached: false,
    windowMs: PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS,
  };
}

function createUninitializedRecord(input: {
  now: string;
  plugin: RpcPluginInventoryPlugin;
}): StoredPluginLifecycleRecord | null {
  const manifest = manifestMetadataFromPlugin(input.plugin);
  if (!manifest || input.plugin.validationErrors.length > 0) {
    return null;
  }
  return {
    activatedOnce: false,
    crashLoop: defaultCrashLoopState(),
    discoveredAt: input.now,
    enabled: false,
    lastActionAt: input.now,
    lastActionBy: null,
    logSettings: { ...DEFAULT_PLUGIN_LOG_SETTINGS },
    manifest,
    notificationSettings: { ...DEFAULT_PLUGIN_NOTIFICATION_SETTINGS },
    pluginId: manifest.pluginId,
    quotaSettings: quotaSettingsFromPlugin(input.plugin),
    restartRequired: false,
    state: "uninitialized",
  };
}

function updateRecordManifestMetadata(input: {
  existingRecord: StoredPluginLifecycleRecord;
  plugin: RpcPluginInventoryPlugin;
}): StoredPluginLifecycleRecord {
  const manifest = manifestMetadataFromPlugin(input.plugin);
  if (!manifest || input.plugin.validationErrors.length > 0) {
    return input.existingRecord;
  }
  return {
    ...input.existingRecord,
    manifest,
    pluginId: manifest.pluginId,
  };
}

function lifecycleMetadataFromRecord(
  record: StoredPluginLifecycleRecord | undefined,
): RpcPluginLifecycleMetadata {
  return {
    activatedOnce: record?.activatedOnce ?? false,
    approvedAt: record?.approvedAt ?? null,
    approvedBy:
      record && "approvedBy" in record ? (record.approvedBy ?? null) : null,
    crashLoop: record?.crashLoop ?? defaultCrashLoopState(),
    disabledAt: record?.disabledAt ?? null,
    discoveredAt: record?.discoveredAt ?? null,
    enabled: record?.enabled ?? false,
    failureReason: record?.reason ?? null,
    lastActionAt: record?.lastActionAt ?? null,
    lastActionBy:
      record && "lastActionBy" in record ? (record.lastActionBy ?? null) : null,
    restartRequired: record?.restartRequired ?? false,
    settings: {
      log: record?.logSettings ?? { ...DEFAULT_PLUGIN_LOG_SETTINGS },
      notifications: record?.notificationSettings ?? {
        ...DEFAULT_PLUGIN_NOTIFICATION_SETTINGS,
      },
      quota: record?.quotaSettings ?? { ...DEFAULT_PLUGIN_QUOTA_SETTINGS },
    },
    state: record?.state ?? "uninitialized",
  };
}

function lifecycleStateToInventoryState(
  state: StoredPluginLifecycleState,
): PluginInventoryLifecycleState | null {
  return state === "uninitialized" ? null : state;
}

function lifecycleSummaryFromRecord(
  record: StoredPluginLifecycleRecord,
): PluginInventoryLifecycleSummary | null {
  const state = lifecycleStateToInventoryState(record.state);
  if (!state) {
    return null;
  }
  return {
    ...(record.reason ? { reason: record.reason } : {}),
    state,
  };
}

function approvalChangedSummary(
  record: StoredPluginLifecycleRecord,
): PluginInventoryLifecycleSummary {
  return {
    reason:
      "Plugin files changed since approval. Review Plugin Changes and Re-approve Plugin before runtime loading resumes.",
    state: "needs_review",
    ...(record.approvedReviewHash
      ? {
          issues: [
            reviewHashIssue(
              "review_hash_changed",
              "metidos-plugin.json",
              "Approved plugin review hash no longer matches the current plugin files.",
            ),
          ],
        }
      : {}),
  };
}

function hashFailureSummary(
  result: PluginReviewHashFailure,
): PluginInventoryLifecycleSummary {
  return {
    issues: result.issues,
    reason: "Plugin review hash could not be computed.",
    state: "failed",
  };
}

function unavailableCandidateSummary(
  candidate: PluginDiscoveryCandidate,
): PluginInventoryLifecycleSummary {
  return {
    issues: candidate.issues.map((issue) => ({
      code: issue.code,
      message: issue.message,
      path: issue.path,
      ...(issue.fileName ? { fileName: issue.fileName } : {}),
    })),
    reason:
      "Plugin folder is present but unavailable for runtime loading until its required files are readable and structurally valid.",
    state: "unavailable",
  };
}

async function buildLifecycleSummaryMap(
  candidates: PluginDiscoveryCandidate[],
  stateFile: PluginLifecycleStateFile,
): Promise<{
  currentReviewHashesByDirectoryName: Map<string, string>;
  lifecycleByDirectoryName: Map<string, PluginInventoryLifecycleSummary>;
}> {
  const currentReviewHashesByDirectoryName = new Map<string, string>();
  const lifecycleByDirectoryName = new Map<
    string,
    PluginInventoryLifecycleSummary
  >();
  for (const candidate of candidates) {
    const record = stateFile.plugins[candidate.directoryName];
    if (!candidate.structurallyValid) {
      if (record) {
        lifecycleByDirectoryName.set(
          candidate.directoryName,
          unavailableCandidateSummary(candidate),
        );
      }
      continue;
    }

    const reviewHash = await computePluginReviewHash(candidate.pluginPath);
    if (reviewHash.hash) {
      currentReviewHashesByDirectoryName.set(
        candidate.directoryName,
        reviewHash.hash,
      );
    }

    if (!record) {
      continue;
    }
    if (reviewHash.hash === null) {
      lifecycleByDirectoryName.set(
        candidate.directoryName,
        hashFailureSummary(reviewHash),
      );
      continue;
    }
    if (
      record.state === "active" &&
      record.approvedReviewHash &&
      record.approvedReviewHash !== reviewHash.hash
    ) {
      lifecycleByDirectoryName.set(
        candidate.directoryName,
        approvalChangedSummary(record),
      );
      continue;
    }
    const summary = lifecycleSummaryFromRecord(record);
    if (summary) {
      lifecycleByDirectoryName.set(candidate.directoryName, summary);
    }
  }
  return {
    currentReviewHashesByDirectoryName,
    lifecycleByDirectoryName,
  };
}

function lifecycleMetadataWithSummary(
  record: StoredPluginLifecycleRecord | undefined,
  summary: PluginInventoryLifecycleSummary | undefined,
): RpcPluginLifecycleMetadata {
  const metadata = lifecycleMetadataFromRecord(record);
  if (!summary) {
    return metadata;
  }
  return {
    ...metadata,
    enabled: summary.state === "active" ? metadata.enabled : false,
    failureReason: summary.reason ?? metadata.failureReason,
    state: summary.state,
  };
}

function pluginLifecycleMessage(
  plugin: RpcPluginInventoryPlugin,
  record: StoredPluginLifecycleRecord | undefined,
  summary: PluginInventoryLifecycleSummary | undefined,
): string | null {
  return summary?.reason ?? plugin.lifecycleMessage ?? record?.reason ?? null;
}

function groupedInventory(
  inventory: RpcPluginInventory,
  plugins: RpcPluginInventoryPlugin[],
): RpcPluginInventory {
  const sortedPlugins = [...plugins].sort((left, right) =>
    left.directoryName.localeCompare(right.directoryName),
  );
  return {
    ...inventory,
    groups: RPC_PLUGIN_INVENTORY_GROUP_LABELS.map((label) => {
      const groupPlugins = sortedPlugins.filter(
        (plugin) => plugin.group === label,
      );
      return {
        count: groupPlugins.length,
        label,
        plugins: groupPlugins,
      };
    }),
    plugins: sortedPlugins,
  };
}

function applyLifecycleMetadata(
  inventory: RpcPluginInventory,
  stateFile: PluginLifecycleStateFile,
  currentReviewHashesByDirectoryName: ReadonlyMap<string, string>,
  lifecycleByDirectoryName: ReadonlyMap<
    string,
    PluginInventoryLifecycleSummary
  >,
): RpcPluginInventory {
  const plugins = inventory.plugins.map((plugin) =>
    applyPluginLifecycleMetadata(
      plugin,
      stateFile,
      currentReviewHashesByDirectoryName,
      lifecycleByDirectoryName,
    ),
  );
  return groupedInventory(inventory, plugins);
}

function applyPluginLifecycleMetadata(
  plugin: RpcPluginInventoryPlugin,
  stateFile: PluginLifecycleStateFile,
  currentReviewHashesByDirectoryName: ReadonlyMap<string, string>,
  lifecycleByDirectoryName: ReadonlyMap<
    string,
    PluginInventoryLifecycleSummary
  >,
): RpcPluginInventoryPlugin {
  const record = stateFile.plugins[plugin.directoryName];
  const summary = lifecycleByDirectoryName.get(plugin.directoryName);
  return {
    ...plugin,
    approvedReviewHash: record?.approvedReviewHash ?? null,
    currentReviewHash:
      currentReviewHashesByDirectoryName.get(plugin.directoryName) ?? null,
    lifecycle: lifecycleMetadataWithSummary(record, summary),
    lifecycleMessage: pluginLifecycleMessage(plugin, record, summary),
  };
}

function disabledPluginAdminActions(input: {
  dataPath: string;
  logsPath: string;
  reason: string;
}): RpcPluginInventoryPlugin["adminActions"] {
  return [
    {
      action: "open_data",
      available: false,
      destructive: false,
      label: "Open .data",
      path: input.dataPath,
      reason: input.reason,
    },
    {
      action: "open_logs",
      available: false,
      destructive: false,
      label: "Open .logs",
      path: input.logsPath,
      reason: input.reason,
    },
    {
      action: "reset_data",
      available: false,
      destructive: true,
      label: "Reset Plugin Data",
      path: input.dataPath,
      reason: input.reason,
    },
    {
      action: "run_gc",
      available: false,
      destructive: false,
      label: "Run Plugin GC",
      path: null,
      reason: input.reason,
    },
  ];
}

function missingLifecycleIssue(input: {
  code: string;
  message: string;
  path: string;
}): RpcPluginInventoryIssue {
  return {
    code: input.code,
    message: input.message,
    path: input.path,
  };
}

function missingPluginInventoryRow(input: {
  directoryName: string;
  pluginsDirectoryUnavailable: boolean;
  pluginsDirectoryPath: string;
  record: StoredPluginLifecycleRecord;
}): RpcPluginInventoryPlugin {
  const folderPath = join(input.pluginsDirectoryPath, input.directoryName);
  const unavailableReason = input.pluginsDirectoryUnavailable
    ? "Plugin directory exists but cannot be read, so persisted plugin lifecycle records are unavailable for runtime loading."
    : "Plugin folder is missing. The persisted lifecycle record is preserved, but runtime loading is unavailable until the folder returns.";
  const state = input.pluginsDirectoryUnavailable ? "unavailable" : "missing";
  const issue = missingLifecycleIssue({
    code: input.pluginsDirectoryUnavailable
      ? "plugins_directory_unavailable"
      : "plugin_folder_missing",
    message: unavailableReason,
    path: folderPath,
  });
  return {
    adminActions: disabledPluginAdminActions({
      dataPath: join(folderPath, ".data"),
      logsPath: join(folderPath, ".logs"),
      reason: unavailableReason,
    }),
    approvedReviewHash: input.record.approvedReviewHash ?? null,
    currentReviewHash: null,
    dataUsage: {
      bytes: 0,
      files: 0,
      scannedAt: new Date(0).toISOString(),
      unavailableReason:
        "Plugin folder is missing, so .data usage cannot be inspected.",
    },
    description: input.record.manifest.description,
    directoryName: input.directoryName,
    folderPath,
    group: "Missing/Unavailable",
    hasRootNodeModules: false,
    lifecycle: lifecycleMetadataWithSummary(input.record, {
      issues: [issue],
      reason: unavailableReason,
      state,
    }),
    lifecycleMessage: unavailableReason,
    manifest: {
      access: [],
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
      limits: {},
      metidosApiVersion: input.record.manifest.metidosApiVersion,
      network: null,
      notificationProviders: [],
      oauthProviders: [],
      piAuth: [],
      permissions: [],
      providers: [],
      settings: [],
      storageDefaults: null,
      telemetry: null,
    },
    name: input.record.manifest.name,
    pluginId: input.record.pluginId,
    reviewWarnings: [],
    status: "missing_unavailable",
    structurallyValid: false,
    validationErrors: [issue],
    version: input.record.manifest.version,
  };
}

function appendMissingLifecyclePlugins(input: {
  inventory: RpcPluginInventory;
  snapshot: Awaited<ReturnType<typeof discoverPluginCandidates>>;
  stateFile: PluginLifecycleStateFile;
}): RpcPluginInventory {
  const discoveredDirectoryNames = new Set(
    input.snapshot.candidates.map((candidate) => candidate.directoryName),
  );
  const snapshotIncomplete = input.snapshot.issues.some(
    (issue) =>
      issue.code === "unreadable_plugins_directory" ||
      issue.code === "candidate_limit_exceeded",
  );
  if (snapshotIncomplete) {
    return input.inventory;
  }
  const pluginsDirectoryUnavailable = input.snapshot.issues.some(
    (issue) => issue.code === "unreadable_plugins_directory",
  );
  const missingPlugins = Object.entries(input.stateFile.plugins)
    .filter(([directoryName]) => !discoveredDirectoryNames.has(directoryName))
    .map(([directoryName, record]) =>
      missingPluginInventoryRow({
        directoryName,
        pluginsDirectoryPath: input.snapshot.pluginsDirectoryPath,
        pluginsDirectoryUnavailable,
        record,
      }),
    );
  if (missingPlugins.length === 0) {
    return input.inventory;
  }
  return groupedInventory(input.inventory, [
    ...input.inventory.plugins,
    ...missingPlugins,
  ]);
}

async function reconcileDiscoveredPluginInstallations(input: {
  inventory: RpcPluginInventory;
  options: AppDataPathOptions & LifecycleActionContext;
  stateFile: PluginLifecycleStateFile;
}): Promise<PluginLifecycleStateFile> {
  let changed = false;
  const now = (input.options.now?.() ?? new Date()).toISOString();
  for (const plugin of input.inventory.plugins) {
    const existingRecord = input.stateFile.plugins[plugin.directoryName];
    if (existingRecord) {
      const updatedRecord = updateRecordManifestMetadata({
        existingRecord,
        plugin,
      });
      if (JSON.stringify(updatedRecord) !== JSON.stringify(existingRecord)) {
        input.stateFile.plugins[plugin.directoryName] = updatedRecord;
        changed = true;
      }
      continue;
    }
    const record = createUninitializedRecord({ now, plugin });
    if (record) {
      input.stateFile.plugins[plugin.directoryName] = record;
      changed = true;
    }
  }
  if (changed) {
    await writeLifecycleStateFile(input.stateFile, input.options);
  }
  return input.stateFile;
}

export async function buildPluginInventoryWithLifecycle(
  options: AppDataPathOptions & LifecycleActionContext = {},
): Promise<RpcPluginInventory> {
  const [snapshot, stateFile] = await Promise.all([
    discoverPluginCandidates(options),
    readLifecycleStateFile(options),
  ]);
  const { currentReviewHashesByDirectoryName, lifecycleByDirectoryName } =
    await buildLifecycleSummaryMap(snapshot.candidates, stateFile);
  const inventory = await buildPluginInventoryFromDiscoverySnapshot(snapshot, {
    lifecycleByDirectoryName,
  });
  const reconciledStateFile = await reconcileDiscoveredPluginInstallations({
    inventory,
    options,
    stateFile,
  });
  const inventoryWithLifecycle = applyLifecycleMetadata(
    inventory,
    reconciledStateFile,
    currentReviewHashesByDirectoryName,
    lifecycleByDirectoryName,
  );
  return appendMissingLifecyclePlugins({
    inventory: inventoryWithLifecycle,
    snapshot,
    stateFile: reconciledStateFile,
  });
}

function assertDirectoryName(directoryName: string): void {
  if (
    directoryName.trim().length === 0 ||
    directoryName.includes("/") ||
    directoryName.includes("\\") ||
    directoryName === "." ||
    directoryName === ".."
  ) {
    throw new Error("Plugin directory name is invalid.");
  }
}

function inventoryIssueDetail(issue: RpcPluginInventoryIssue): string {
  return `${issue.message} (${issue.path}; ${issue.code})`;
}

function validationErrorMessage(plugin: RpcPluginInventoryPlugin): string {
  const firstIssue = plugin.validationErrors[0];
  return firstIssue
    ? `Plugin validation failed: ${inventoryIssueDetail(firstIssue)}`
    : "Plugin validation failed.";
}

function assertPluginValidForLifecycleAction(
  plugin: RpcPluginInventoryPlugin,
): void {
  if (plugin.validationErrors.length > 0 || !plugin.structurallyValid) {
    throw new Error(validationErrorMessage(plugin));
  }
}

async function loadLifecycleActionTarget(
  directoryName: string,
  options?: AppDataPathOptions,
): Promise<{
  plugin: RpcPluginInventoryPlugin;
  reviewHash: string;
  stateFile: PluginLifecycleStateFile;
}> {
  assertDirectoryName(directoryName);
  const [snapshot, stateFile] = await Promise.all([
    discoverPluginCandidates(options),
    readLifecycleStateFile(options),
  ]);
  const candidate = snapshot.candidates.find(
    (item) => item.directoryName === directoryName,
  );
  if (!candidate) {
    throw new Error(`Plugin ${directoryName} was not found.`);
  }
  const inventory = await buildPluginInventoryFromDiscoverySnapshot(snapshot);
  const plugin = inventory.plugins.find(
    (item) => item.directoryName === directoryName,
  );
  if (!plugin) {
    throw new Error(`Plugin ${directoryName} was not found.`);
  }
  assertPluginValidForLifecycleAction(plugin);
  const reviewHash = await computePluginReviewHash(candidate.pluginPath);
  if (!reviewHash.hash) {
    const firstIssue = reviewHash.issues[0];
    throw new Error(
      firstIssue
        ? `Plugin review hash failed: ${inventoryIssueDetail(firstIssue)}`
        : "Plugin hash failed.",
    );
  }
  return {
    plugin,
    reviewHash: reviewHash.hash,
    stateFile,
  };
}

async function loadLifecycleDisableTarget(
  directoryName: string,
  options?: AppDataPathOptions,
): Promise<{
  plugin: RpcPluginInventoryPlugin;
  reviewHash: string;
  stateFile: PluginLifecycleStateFile;
}> {
  assertDirectoryName(directoryName);
  const [snapshot, stateFile] = await Promise.all([
    discoverPluginCandidates(options),
    readLifecycleStateFile(options),
  ]);
  const candidate = snapshot.candidates.find(
    (item) => item.directoryName === directoryName,
  );
  if (!candidate) {
    throw new Error(`Plugin ${directoryName} was not found.`);
  }
  const inventory = await buildPluginInventoryFromDiscoverySnapshot(snapshot);
  const plugin = inventory.plugins.find(
    (item) => item.directoryName === directoryName,
  );
  if (!plugin) {
    throw new Error(`Plugin ${directoryName} was not found.`);
  }
  const reviewHash = await computePluginReviewHash(candidate.pluginPath);
  return {
    plugin,
    reviewHash:
      reviewHash.hash ??
      stateFile.plugins[directoryName]?.approvedReviewHash ??
      "unavailable",
    stateFile,
  };
}

function actionRecord(input: {
  actionContext: LifecycleActionContext;
  existingRecord: StoredPluginLifecycleRecord;
  reason: string;
  reviewHash: string;
  state: StoredPluginLifecycleState;
}): StoredPluginLifecycleRecord {
  const now = input.actionContext.now?.() ?? new Date();
  const timestamp = now.toISOString();
  const username = input.actionContext.username ?? null;
  return {
    ...input.existingRecord,
    ...(input.existingRecord.approvedAt
      ? { approvedAt: input.existingRecord.approvedAt }
      : {}),
    ...("approvedBy" in input.existingRecord
      ? { approvedBy: input.existingRecord.approvedBy }
      : {}),
    ...(input.existingRecord.approvedReviewHash
      ? { approvedReviewHash: input.existingRecord.approvedReviewHash }
      : {}),
    enabled: input.state === "active",
    lastActionAt: timestamp,
    lastActionBy: username,
    reason: input.reason,
    restartRequired: input.state === "restart_required",
    state: input.state,
    ...(input.state === "needs_review"
      ? { lastReviewedHash: input.reviewHash }
      : {}),
  };
}

function approvalRecord(input: {
  actionContext: LifecycleActionContext;
  existingRecord: StoredPluginLifecycleRecord;
  reason: string;
  reviewHash: string;
}): StoredPluginLifecycleRecord {
  const now = input.actionContext.now?.() ?? new Date();
  const timestamp = now.toISOString();
  const username = input.actionContext.username ?? null;
  return {
    ...input.existingRecord,
    approvedAt: timestamp,
    approvedBy: username,
    approvedReviewHash: input.reviewHash,
    crashLoop: defaultCrashLoopState(),
    enabled: true,
    lastActionAt: timestamp,
    lastActionBy: username,
    reason: input.reason,
    restartRequired: false,
    state: "active",
  };
}

function retryRecord(input: {
  actionContext: LifecycleActionContext;
  existingRecord: StoredPluginLifecycleRecord;
  reviewHash: string;
}): { message: string; record: StoredPluginLifecycleRecord } {
  const existingApprovedHash = input.existingRecord?.approvedReviewHash;
  if (!existingApprovedHash || existingApprovedHash !== input.reviewHash) {
    return {
      message:
        "Retry reviewed the plugin without executing code. Plugin changes require re-approval before runtime loading resumes.",
      record: {
        ...actionRecord({
          actionContext: input.actionContext,
          existingRecord: input.existingRecord,
          reason:
            "Retry found plugin files that are not approved. Review Plugin Changes and Re-approve Plugin before retrying runtime loading.",
          reviewHash: input.reviewHash,
          state: "needs_review",
        }),
        crashLoop: defaultCrashLoopState(),
      },
    };
  }
  return {
    message:
      "Retry cleared the failed/degraded state for the approved plugin. Restart or the next lifecycle startup can attempt loading it again.",
    record: {
      ...actionRecord({
        actionContext: input.actionContext,
        existingRecord: input.existingRecord,
        reason:
          "Retry cleared the failed/degraded state for the approved review hash without executing plugin code during the local action.",
        reviewHash: input.reviewHash,
        state: "active",
      }),
      crashLoop: defaultCrashLoopState(),
    },
  };
}

function lifecycleActionRecord(input: {
  action: RpcPluginLifecycleAction;
  actionContext: LifecycleActionContext;
  existingRecord: StoredPluginLifecycleRecord;
  reviewHash: string;
}): { message: string; record: StoredPluginLifecycleRecord } {
  switch (input.action) {
    case "enable":
      return {
        message:
          "Plugin approval was recorded after validation. Runtime loading uses the approved review hash and does not execute during approval.",
        record: approvalRecord({
          actionContext: input.actionContext,
          existingRecord: input.existingRecord,
          reason:
            "Plugin approved for runtime loading with the current review hash.",
          reviewHash: input.reviewHash,
        }),
      };
    case "review_changes":
      return {
        message:
          "Plugin changes were reviewed without executing plugin code. Re-approve Plugin to activate the current files.",
        record: actionRecord({
          actionContext: input.actionContext,
          existingRecord: input.existingRecord,
          reason:
            "Plugin changes have been reviewed. Re-approve Plugin to store the new approved review hash.",
          reviewHash: input.reviewHash,
          state: "needs_review",
        }),
      };
    case "reapprove":
      return {
        message:
          "Plugin re-approval was recorded after validation. Runtime loading resumes for the current review hash.",
        record: approvalRecord({
          actionContext: input.actionContext,
          existingRecord: input.existingRecord,
          reason:
            "Plugin re-approved for runtime loading with the current review hash.",
          reviewHash: input.reviewHash,
        }),
      };
    case "disable":
      return {
        message:
          "Plugin was disabled. Restart Metidos to fully remove already registered runtime capabilities; v1 does not hot-unregister them.",
        record: {
          ...actionRecord({
            actionContext: input.actionContext,
            existingRecord: input.existingRecord,
            reason:
              "Plugin disabled. Restart Metidos to fully remove already registered tools, providers, and crons.",
            reviewHash: input.reviewHash,
            state: "restart_required",
          }),
          disabledAt: (input.actionContext.now?.() ?? new Date()).toISOString(),
        },
      };
    case "retry":
      return retryRecord(input);
  }
}

export async function runPluginLifecycleAction(
  params: {
    action: RpcPluginLifecycleAction;
    directoryName: string;
  },
  options: AppDataPathOptions & LifecycleActionContext = {},
): Promise<RpcPluginLifecycleActionResult> {
  const { plugin, reviewHash, stateFile } = await (params.action === "disable"
    ? loadLifecycleDisableTarget(params.directoryName, options)
    : loadLifecycleActionTarget(params.directoryName, options));
  let existingRecord = stateFile.plugins[params.directoryName];
  if (!existingRecord) {
    const now = (options.now?.() ?? new Date()).toISOString();
    existingRecord = createUninitializedRecord({ now, plugin }) ?? undefined;
  }
  if (!existingRecord) {
    throw new Error(
      "Plugin lifecycle state cannot be persisted until the manifest id matches its plugin folder name.",
    );
  }
  const { message, record } = lifecycleActionRecord({
    action: params.action,
    actionContext: options,
    existingRecord,
    reviewHash,
  });
  stateFile.plugins[params.directoryName] = record;
  await writeLifecycleStateFile(stateFile, options);
  const inventory = await buildPluginInventoryWithLifecycle(options);
  const updatedPlugin =
    inventory.plugins.find(
      (item) => item.directoryName === params.directoryName,
    ) ?? plugin;
  return {
    action: params.action,
    directoryName: params.directoryName,
    inventory,
    message,
    plugin: updatedPlugin,
  };
}

function fallbackRuntimeRecord(input: {
  directoryName: string;
  timestamp: string;
}): StoredPluginLifecycleRecord {
  return {
    activatedOnce: false,
    crashLoop: defaultCrashLoopState(),
    discoveredAt: input.timestamp,
    enabled: false,
    lastActionAt: input.timestamp,
    lastActionBy: null,
    logSettings: { ...DEFAULT_PLUGIN_LOG_SETTINGS },
    manifest: {
      description: null,
      metidosApiVersion: null,
      name: null,
      pluginId: input.directoryName,
      version: null,
    },
    notificationSettings: { ...DEFAULT_PLUGIN_NOTIFICATION_SETTINGS },
    pluginId: input.directoryName,
    quotaSettings: { ...DEFAULT_PLUGIN_QUOTA_SETTINGS },
    restartRequired: false,
    state: "uninitialized",
  };
}

export async function recordPluginRuntimeActivation(
  directoryName: string,
  options: AppDataPathOptions & LifecycleActionContext = {},
): Promise<void> {
  assertDirectoryName(directoryName);
  const stateFile = await readLifecycleStateFile(options);
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const existingRecord =
    stateFile.plugins[directoryName] ??
    fallbackRuntimeRecord({ directoryName, timestamp });
  stateFile.plugins[directoryName] = {
    ...existingRecord,
    activatedOnce: true,
    crashLoop: defaultCrashLoopState(),
    enabled: true,
    lastActionAt: timestamp,
    lastActionBy: options.username ?? null,
    restartRequired: false,
    state: "active",
  };
  await writeLifecycleStateFile(stateFile, options);
}

export async function recordPluginRuntimeFailure(
  directoryName: string,
  reason: string,
  options: AppDataPathOptions &
    LifecycleActionContext & {
      crashCount?: number;
      crashLoopThresholdReached?: boolean;
    } = {},
): Promise<void> {
  assertDirectoryName(directoryName);
  const stateFile = await readLifecycleStateFile(options);
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  const existingRecord =
    stateFile.plugins[directoryName] ??
    fallbackRuntimeRecord({ directoryName, timestamp });
  stateFile.plugins[directoryName] = {
    ...existingRecord,
    crashLoop: {
      crashCount:
        options.crashCount ?? existingRecord.crashLoop.crashCount ?? 0,
      lastCrashAt: timestamp,
      threshold: PLUGIN_SIDECAR_CRASH_LOOP_THRESHOLD,
      thresholdReached: options.crashLoopThresholdReached ?? false,
      windowMs: PLUGIN_SIDECAR_CRASH_LOOP_WINDOW_MS,
    },
    enabled: false,
    lastActionAt: timestamp,
    lastActionBy: options.username ?? null,
    reason,
    restartRequired: false,
    state: "failed",
  };
  await writeLifecycleStateFile(stateFile, options);
}

async function recordPluginDataResetAction(input: {
  directoryName: string;
  options: AppDataPathOptions & LifecycleActionContext;
  plugin: RpcPluginInventoryPlugin;
  resetResult: PluginDataResetResult;
}): Promise<void> {
  const stateFile = await readLifecycleStateFile(input.options);
  const timestamp = (input.options.now?.() ?? new Date()).toISOString();
  const existingRecord =
    stateFile.plugins[input.directoryName] ??
    createUninitializedRecord({ now: timestamp, plugin: input.plugin }) ??
    fallbackRuntimeRecord({
      directoryName: input.directoryName,
      timestamp,
    });
  stateFile.plugins[input.directoryName] = {
    ...existingRecord,
    lastActionAt: timestamp,
    lastActionBy: input.options.username ?? null,
    reason: input.resetResult.backupPath
      ? `Plugin data reset completed. Previous .data was moved to ${input.resetResult.backupPath}.`
      : "Plugin data reset completed. No existing .data directory needed backup.",
  };
  await writeLifecycleStateFile(stateFile, input.options);
}

function pluginAdminActionTargetDirectory(
  action: RpcPluginAdminAction,
): ".data" | ".logs" | null {
  switch (action) {
    case "open_data":
    case "reset_data":
      return ".data";
    case "open_logs":
      return ".logs";
    case "run_gc":
      return null;
  }
}

function pluginAdminActionMessage(input: {
  action: RpcPluginAdminAction;
  path: string | null;
  resetResult?: PluginDataResetResult | null;
}): string {
  switch (input.action) {
    case "open_data":
      return `Plugin data directory is available at ${input.path}.`;
    case "open_logs":
      return `Plugin logs directory is available at ${input.path}.`;
    case "reset_data":
      return input.resetResult?.backupPath
        ? `Plugin data reset completed. Backup preserved at ${input.resetResult.backupPath}.`
        : "Plugin data reset completed. No previous .data directory needed backup.";
    case "run_gc":
      return "Plugin GC completed.";
  }
}

export async function runPluginAdminAction(
  params: {
    action: RpcPluginAdminAction;
    confirmation?: string;
    directoryName: string;
  },
  options: AppDataPathOptions &
    LifecycleActionContext &
    PluginAdminRuntimeHooks = {},
): Promise<RpcPluginAdminActionResult> {
  assertDirectoryName(params.directoryName);
  const snapshot = await discoverPluginCandidates(options);
  const candidate = snapshot.candidates.find(
    (item) => item.directoryName === params.directoryName,
  );
  if (!candidate) {
    throw new Error(`Plugin ${params.directoryName} was not found.`);
  }

  const inventory = await buildPluginInventoryWithLifecycle(options);
  const plugin = inventory.plugins.find(
    (item) => item.directoryName === params.directoryName,
  );
  if (!plugin) {
    throw new Error(`Plugin ${params.directoryName} was not found.`);
  }

  const availability = plugin.adminActions.find(
    (action) => action.action === params.action,
  );
  if (!availability) {
    throw new Error(`Plugin local action ${params.action} is not supported.`);
  }
  if (!availability.available) {
    throw new Error(
      availability.reason ?? `${availability.label} is not available.`,
    );
  }

  const targetDirectoryName = pluginAdminActionTargetDirectory(params.action);
  if (targetDirectoryName) {
    const expectedPath = resolvePluginManagedDirectoryPath(
      candidate.pluginPath,
      targetDirectoryName,
    );
    if (
      !availability.path ||
      availability.path !== expectedPath ||
      !isPathContainedByDirectory(candidate.pluginPath, availability.path)
    ) {
      throw new Error("Plugin local action path escaped its plugin root.");
    }
    if (params.action !== "reset_data") {
      const stat = await lstat(availability.path);
      if (!stat.isDirectory()) {
        throw new Error(`${availability.label} target is not a directory.`);
      }
    }
  }

  let resetResult: PluginDataResetResult | null = null;
  let ranGc = false;
  if (params.action === "run_gc") {
    if (!options.runPluginGc) {
      throw new PluginGcError({
        code: "plugin_gc_unavailable",
        message: "Plugin GC runtime hook is not available.",
      });
    }
    await options.runPluginGc(params.directoryName);
    ranGc = true;
  }

  if (params.action === "reset_data") {
    if (params.confirmation !== params.directoryName) {
      throw new Error(
        "Reset Plugin Data requires typing the plugin folder name to confirm.",
      );
    }
    await options.stopPluginRuntime?.(params.directoryName);
    resetResult = await resetPluginDataRoot({
      ...(options.now ? { now: options.now } : {}),
      pluginPath: candidate.pluginPath,
    });
    await recordPluginDataResetAction({
      directoryName: params.directoryName,
      options,
      plugin,
      resetResult,
    });
    await options.recordPluginDataResetAudit?.({
      backupPath: resetResult.backupPath,
      dataPath: resetResult.dataPath,
      directoryName: params.directoryName,
      pluginId: plugin.pluginId,
      username: options.username ?? null,
    });
    await options.restartPluginRuntime?.(params.directoryName);
  }

  const updatedInventory =
    resetResult || ranGc
      ? await buildPluginInventoryWithLifecycle(options)
      : inventory;
  const updatedPlugin =
    updatedInventory.plugins.find(
      (item) => item.directoryName === params.directoryName,
    ) ?? plugin;

  return {
    action: params.action,
    directoryName: params.directoryName,
    inventory: updatedInventory,
    message: pluginAdminActionMessage({
      action: params.action,
      path: availability.path,
      resetResult,
    }),
    path: availability.path,
    plugin: updatedPlugin,
  };
}
