/**
 * @file src/bun/dev-mainview-watcher.ts
 * @description Dev-only mainview source watcher with fs.watch/polling fallback.
 */

import {
  type FSWatcher,
  readdirSync,
  realpathSync,
  statSync,
  watch,
} from "node:fs";
import { relative, resolve } from "node:path";
import type { MainviewBuildResult } from "./build-mainview";
import type { LogDescription } from "./logging";

export type DevMainviewWatcherLogger = {
  error: (description: LogDescription | string) => void;
  warning: (description: LogDescription | string) => void;
};

export type DevMainviewWatcher = {
  shutdown: () => void;
  start: () => void;
};

export function createDevMainviewWatcher(options: {
  debounceMs: number;
  invalidateHtmlCache: () => void;
  isDevServer: boolean;
  logger: DevMainviewWatcherLogger;
  mainviewSourceDir: string;
  normalizeErrorDescription: (error: unknown) => LogDescription;
  pollIntervalMs: number;
  queueBundleBuild: () => Promise<MainviewBuildResult>;
  broadcastReload: (reason: string) => void;
}): DevMainviewWatcher {
  const pendingMainviewChanges = new Set<string>();
  const mainviewRealPathCache = new Map<string, string | null>();
  let devMainviewPollTimer: ReturnType<typeof setInterval> | null = null;
  let devMainviewWatcher: FSWatcher | null = null;
  let pendingMainviewReloadTimer: ReturnType<typeof setTimeout> | null = null;
  let mainviewFileStamps = new Map<string, number>();

  function normalizeWatchFilename(filename?: string | Buffer | null): string {
    const raw =
      typeof filename === "string"
        ? filename
        : filename
          ? filename.toString("utf8")
          : "";
    const trimmed = raw.trim();
    return (
      trimmed.includes("\\") ? trimmed.replace(/\\/g, "/") : trimmed
    ).toLowerCase();
  }

  function flushPendingMainviewReloads(): void {
    pendingMainviewReloadTimer = null;
    const changedFiles = [...pendingMainviewChanges];
    pendingMainviewChanges.clear();

    const requiresBuild = changedFiles.some(
      (entry) =>
        !entry ||
        entry === "mainview-source-tree" ||
        entry.endsWith(".ts") ||
        entry.endsWith(".tsx"),
    );
    const requiresReload =
      requiresBuild ||
      changedFiles.some(
        (entry) => !entry || entry === "index.css" || entry === "index.html",
      );
    if (!requiresReload) {
      return;
    }

    void (async () => {
      if (requiresBuild) {
        try {
          await options.queueBundleBuild();
        } catch (error) {
          options.logger.error({
            message:
              "Failed to rebuild the mainview bundle after a source change",
            error: options.normalizeErrorDescription(error),
          });
          return;
        }
      }
      if (changedFiles.some((entry) => !entry || entry === "index.html")) {
        options.invalidateHtmlCache();
      }

      options.broadcastReload(
        requiresBuild ? "mainview-source" : "mainview-asset",
      );
    })();
  }

  function enqueueMainviewReload(filename?: string | Buffer | null): void {
    const normalizedFilename = normalizeWatchFilename(filename);
    pendingMainviewChanges.add(normalizedFilename);

    if (pendingMainviewReloadTimer) {
      clearTimeout(pendingMainviewReloadTimer);
    }
    pendingMainviewReloadTimer = setTimeout(
      flushPendingMainviewReloads,
      options.debounceMs,
    );
  }

  function readMainviewFileStamps(): Map<string, number> {
    const nextStamps = new Map<string, number>();
    const visitedRealPaths = new Set<string>();

    const readDirectory = (directoryPath: string): void => {
      let realPath = mainviewRealPathCache.get(directoryPath);
      if (typeof realPath === "undefined") {
        try {
          realPath = realpathSync(directoryPath);
        } catch {
          realPath = null;
        }
        mainviewRealPathCache.set(directoryPath, realPath);
      }
      if (realPath === null) {
        return;
      }

      if (visitedRealPaths.has(realPath)) {
        return;
      }
      visitedRealPaths.add(realPath);

      let entries: string[];
      try {
        entries = readdirSync(directoryPath);
      } catch {
        return;
      }

      for (const entry of entries) {
        const entryPath = resolve(directoryPath, entry);
        const stats = statSync(entryPath, {
          throwIfNoEntry: false,
        });
        if (!stats) {
          continue;
        }
        if (stats.isDirectory()) {
          readDirectory(entryPath);
          continue;
        }
        if (!stats.isFile()) {
          continue;
        }

        nextStamps.set(
          relative(options.mainviewSourceDir, entryPath).replace(/\\/g, "/"),
          stats.mtimeMs,
        );
      }
    };

    readDirectory(options.mainviewSourceDir);

    return nextStamps;
  }

  function pollMainviewFileChanges(): void {
    const nextStamps = readMainviewFileStamps();
    let changed = false;
    for (const [entry, mtimeMs] of nextStamps) {
      const previousMtimeMs = mainviewFileStamps.get(entry);
      if (previousMtimeMs !== mtimeMs) {
        changed = true;
        break;
      }
    }
    if (!changed) {
      for (const entry of mainviewFileStamps.keys()) {
        if (!nextStamps.has(entry)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      enqueueMainviewReload("mainview-source-tree");
    }
    mainviewFileStamps = nextStamps;
  }

  function startMainviewPollingWatcher(): void {
    mainviewFileStamps = readMainviewFileStamps();
    devMainviewPollTimer = setInterval(
      pollMainviewFileChanges,
      options.pollIntervalMs,
    );
  }

  function start(): void {
    if (!options.isDevServer || devMainviewWatcher || devMainviewPollTimer) {
      return;
    }

    try {
      devMainviewWatcher = watch(
        options.mainviewSourceDir,
        {
          recursive: true,
        },
        (_eventType, filename) => {
          enqueueMainviewReload(filename);
        },
      );
      devMainviewWatcher.on("error", (error) => {
        options.logger.warning({
          message: "Mainview fs.watch failed; falling back to polling",
          error: options.normalizeErrorDescription(error),
        });
        devMainviewWatcher?.close();
        devMainviewWatcher = null;
        if (!devMainviewPollTimer) {
          startMainviewPollingWatcher();
        }
      });
    } catch (error) {
      options.logger.warning({
        message: "Mainview fs.watch unavailable; falling back to polling",
        error: options.normalizeErrorDescription(error),
      });
      startMainviewPollingWatcher();
    }
  }

  function shutdown(): void {
    if (devMainviewPollTimer) {
      clearInterval(devMainviewPollTimer);
      devMainviewPollTimer = null;
    }
    if (devMainviewWatcher) {
      devMainviewWatcher.close();
      devMainviewWatcher = null;
    }
    mainviewFileStamps.clear();
    mainviewRealPathCache.clear();

    if (pendingMainviewReloadTimer) {
      clearTimeout(pendingMainviewReloadTimer);
      pendingMainviewReloadTimer = null;
    }
    pendingMainviewChanges.clear();
  }

  return { shutdown, start };
}
