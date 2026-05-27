/**
 * @file src/bun/plugin/discovery.ts
 * @description Side-effect-free discovery of local Metidos plugin folders.
 */

import { constants, type Dirent, type FSWatcher, watch } from "node:fs";
import { access, lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

import { type AppDataPathOptions, getAppDataDirectoryPath } from "../db";

export const PLUGINS_DIRECTORY_NAME = "plugins";
export const REQUIRED_PLUGIN_ROOT_FILES = [
  "metidos-plugin.json",
  "AGENTS.md",
] as const;

export type RequiredPluginRootFile =
  (typeof REQUIRED_PLUGIN_ROOT_FILES)[number];

export type PluginDiscoveryIssueCode =
  | "missing_required_file"
  | "unreadable_required_file"
  | "invalid_required_file_type"
  | "forbidden_root_node_modules"
  | "candidate_limit_exceeded"
  | "unreadable_plugins_directory";

export type PluginDiscoveryIssue = {
  code: PluginDiscoveryIssueCode;
  message: string;
  path: string;
  fileName?: string;
};

export type PluginRequiredFileState = {
  fileName: RequiredPluginRootFile;
  path: string;
  exists: boolean;
  isFile: boolean;
  readable: boolean;
};

export type PluginDiscoveryCandidate = {
  directoryName: string;
  pluginPath: string;
  structurallyValid: boolean;
  requiredFiles: Record<RequiredPluginRootFile, PluginRequiredFileState>;
  hasRootNodeModules: boolean;
  issues: PluginDiscoveryIssue[];
};

export type PluginDiscoverySnapshot = {
  pluginsDirectoryPath: string;
  pluginsDirectoryExists: boolean;
  scannedAt: string;
  candidates: PluginDiscoveryCandidate[];
  issues: PluginDiscoveryIssue[];
};

export type PluginDiscoveryOptions = AppDataPathOptions & {
  now?: () => Date;
};

export type PluginDiscoveryServiceOptions = PluginDiscoveryOptions & {
  debounceMs?: number;
};

type PluginDiscoveryListener = (snapshot: PluginDiscoverySnapshot) => void;

const DEFAULT_DEBOUNCE_MS = 50;
export const MAX_PLUGIN_DISCOVERY_CANDIDATES = 256;

function buildMissingRequiredFileIssue(
  path: string,
  fileName: RequiredPluginRootFile,
): PluginDiscoveryIssue {
  return {
    code: "missing_required_file",
    fileName,
    path,
    message: `Missing required plugin root file ${fileName}.`,
  };
}

function buildUnreadableRequiredFileIssue(
  path: string,
  fileName: RequiredPluginRootFile,
): PluginDiscoveryIssue {
  return {
    code: "unreadable_required_file",
    fileName,
    path,
    message: `Required plugin root file ${fileName} is not readable.`,
  };
}

function buildInvalidRequiredFileTypeIssue(
  path: string,
  fileName: RequiredPluginRootFile,
): PluginDiscoveryIssue {
  return {
    code: "invalid_required_file_type",
    fileName,
    path,
    message: `Required plugin root entry ${fileName} must be a file.`,
  };
}

function isMissingFileSystemError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function inspectRequiredFile(
  pluginPath: string,
  fileName: RequiredPluginRootFile,
): Promise<{
  state: PluginRequiredFileState;
  issues: PluginDiscoveryIssue[];
}> {
  const path = join(pluginPath, fileName);
  try {
    const stat = await lstat(path);
    const isFile = stat.isFile();
    let readable = false;
    if (isFile) {
      try {
        await access(path, constants.R_OK);
        readable = true;
      } catch {
        readable = false;
      }
    }
    const state: PluginRequiredFileState = {
      fileName,
      path,
      exists: true,
      isFile,
      readable,
    };
    const issues: PluginDiscoveryIssue[] = [];
    if (!isFile) {
      issues.push(buildInvalidRequiredFileTypeIssue(path, fileName));
    } else if (!readable) {
      issues.push(buildUnreadableRequiredFileIssue(path, fileName));
    }
    return { state, issues };
  } catch (error) {
    if (!isMissingFileSystemError(error)) {
      const state: PluginRequiredFileState = {
        fileName,
        path,
        exists: true,
        isFile: false,
        readable: false,
      };
      return {
        state,
        issues: [buildUnreadableRequiredFileIssue(path, fileName)],
      };
    }
    const state: PluginRequiredFileState = {
      fileName,
      path,
      exists: false,
      isFile: false,
      readable: false,
    };
    return {
      state,
      issues: [buildMissingRequiredFileIssue(path, fileName)],
    };
  }
}

async function hasForbiddenRootNodeModules(
  pluginPath: string,
): Promise<boolean> {
  try {
    await lstat(join(pluginPath, "node_modules"));
    return true;
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return false;
    }
    return true;
  }
}

async function inspectPluginCandidate(
  pluginsDirectoryPath: string,
  directoryName: string,
): Promise<PluginDiscoveryCandidate> {
  const pluginPath = join(pluginsDirectoryPath, directoryName);
  const requiredFileEntries = await Promise.all(
    REQUIRED_PLUGIN_ROOT_FILES.map((fileName) =>
      inspectRequiredFile(pluginPath, fileName),
    ),
  );
  const requiredFiles = Object.fromEntries(
    requiredFileEntries.map(({ state }) => [state.fileName, state]),
  ) as Record<RequiredPluginRootFile, PluginRequiredFileState>;
  const issues = requiredFileEntries.flatMap((entry) => entry.issues);
  const hasRootNodeModules = await hasForbiddenRootNodeModules(pluginPath);
  if (hasRootNodeModules) {
    const path = join(pluginPath, "node_modules");
    issues.push({
      code: "forbidden_root_node_modules",
      path,
      fileName: "node_modules",
      message:
        "Plugin root node_modules/ is forbidden; plugins are built by Metidos after approval and cannot vendor runtime dependencies there.",
    });
  }

  return {
    directoryName,
    pluginPath,
    structurallyValid: issues.length === 0,
    requiredFiles,
    hasRootNodeModules,
    issues,
  };
}

export function getPluginsDirectoryPath(options?: AppDataPathOptions): string {
  return join(getAppDataDirectoryPath(options), PLUGINS_DIRECTORY_NAME);
}

/**
 * Discover immediate plugin candidate folders without building, importing, or
 * otherwise executing plugin code.
 */
export async function discoverPluginCandidates(
  options: PluginDiscoveryOptions = {},
): Promise<PluginDiscoverySnapshot> {
  const pluginsDirectoryPath = getPluginsDirectoryPath(options);
  const now = options.now ?? (() => new Date());
  let entries: Dirent[];
  try {
    entries = await readdir(pluginsDirectoryPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileSystemError(error)) {
      return {
        pluginsDirectoryPath,
        pluginsDirectoryExists: false,
        scannedAt: now().toISOString(),
        candidates: [],
        issues: [],
      };
    }
    return {
      pluginsDirectoryPath,
      pluginsDirectoryExists: true,
      scannedAt: now().toISOString(),
      candidates: [],
      issues: [
        {
          code: "unreadable_plugins_directory",
          path: pluginsDirectoryPath,
          message: "Plugin directory exists but cannot be read.",
        },
      ],
    };
  }

  const allDirectoryNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const directoryNames = allDirectoryNames.slice(
    0,
    MAX_PLUGIN_DISCOVERY_CANDIDATES,
  );
  const issues: PluginDiscoveryIssue[] =
    allDirectoryNames.length > MAX_PLUGIN_DISCOVERY_CANDIDATES
      ? [
          {
            code: "candidate_limit_exceeded",
            path: pluginsDirectoryPath,
            message: `Plugin discovery is limited to ${MAX_PLUGIN_DISCOVERY_CANDIDATES} candidate directories; remaining entries were skipped.`,
          },
        ]
      : [];
  const candidates = await Promise.all(
    directoryNames.map((directoryName) =>
      inspectPluginCandidate(pluginsDirectoryPath, directoryName),
    ),
  );
  return {
    pluginsDirectoryPath,
    pluginsDirectoryExists: true,
    scannedAt: now().toISOString(),
    candidates,
    issues,
  };
}

export class PluginDiscoveryService {
  readonly #options: PluginDiscoveryServiceOptions;
  readonly #listeners = new Set<PluginDiscoveryListener>();
  #snapshot: PluginDiscoverySnapshot | null = null;
  #watchers: FSWatcher[] = [];
  #refreshTimer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #refreshPromise: Promise<PluginDiscoverySnapshot> | null = null;

  constructor(options: PluginDiscoveryServiceOptions = {}) {
    this.#options = options;
  }

  get snapshot(): PluginDiscoverySnapshot | null {
    return this.#snapshot;
  }

  subscribe(listener: PluginDiscoveryListener): () => void {
    this.#listeners.add(listener);
    if (this.#snapshot) {
      listener(this.#snapshot);
    }
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<PluginDiscoverySnapshot> {
    this.#started = true;
    return await this.refresh();
  }

  stop(): void {
    this.#started = false;
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = null;
    }
    this.#closeWatchers();
  }

  async refresh(): Promise<PluginDiscoverySnapshot> {
    if (this.#refreshPromise) {
      return await this.#refreshPromise;
    }
    this.#refreshPromise = this.#refreshNow();
    try {
      return await this.#refreshPromise;
    } finally {
      this.#refreshPromise = null;
    }
  }

  #scheduleRefresh(): void {
    if (!this.#started) {
      return;
    }
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer);
    }
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = null;
      void this.refresh();
    }, this.#options.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  async #refreshNow(): Promise<PluginDiscoverySnapshot> {
    const snapshot = await discoverPluginCandidates(this.#options);
    this.#snapshot = snapshot;
    if (this.#started) {
      this.#resetWatchers(snapshot);
    }
    for (const listener of this.#listeners) {
      listener(snapshot);
    }
    return snapshot;
  }

  #resetWatchers(snapshot: PluginDiscoverySnapshot): void {
    this.#closeWatchers();
    const appDataDirectoryPath = getAppDataDirectoryPath(this.#options);
    this.#addWatcher(appDataDirectoryPath);
    if (!snapshot.pluginsDirectoryExists) {
      return;
    }
    this.#addWatcher(snapshot.pluginsDirectoryPath);
    for (const candidate of snapshot.candidates) {
      this.#addWatcher(candidate.pluginPath);
    }
  }

  #addWatcher(path: string): void {
    try {
      const watcher = watch(path, { persistent: false }, () => {
        this.#scheduleRefresh();
      });
      watcher.on("error", () => {
        this.#scheduleRefresh();
      });
      this.#watchers.push(watcher);
    } catch {
      // Discovery must tolerate missing/unwatchable folders; the next explicit
      // refresh or parent-directory event will rebuild the watcher set.
    }
  }

  #closeWatchers(): void {
    for (const watcher of this.#watchers) {
      watcher.close();
    }
    this.#watchers = [];
  }
}
