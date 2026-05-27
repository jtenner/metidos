/**
 * @file src/bun/plugin/log.test.ts
 * @description Tests for Plugin System v1 permissioned file logging.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  executePluginLogBatchOperation,
  executePluginLogOperation,
  PluginLogError,
} from "./log";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("executePluginLogOperation", () => {
  it("requires log:write before validating or writing logs", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-denied-");

    await expect(
      executePluginLogOperation({
        params: { level: "verbose", message: "hidden" },
        permissions: [],
        pluginPath,
        settings: { enabled: true },
      }),
    ).rejects.toThrow(PluginLogError);

    await expect(
      executePluginLogOperation({
        params: { level: "verbose", message: "hidden" },
        permissions: [],
        pluginPath,
        settings: { enabled: true },
      }),
    ).rejects.toMatchObject({ code: "plugin_permission_error" });
    expect(existsSync(join(pluginPath, ".logs"))).toBe(false);
  });

  it("no-ops without creating .logs when local logging is disabled", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-disabled-");

    const result = await executePluginLogOperation({
      params: { level: "info", message: "build started" },
      permissions: ["log:write"],
      pluginPath,
      settings: { enabled: false },
    });

    expect(result).toEqual({ logged: false, path: null, pruning: null });
    expect(existsSync(join(pluginPath, ".logs"))).toBe(false);
  });

  it("writes enabled logs to the exact date file and line format", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-enabled-");
    const now = new Date("2026-04-28T12:34:56.789Z");

    const result = await executePluginLogOperation({
      now,
      params: { level: "warn", message: "line one\nline two" },
      permissions: ["log:write"],
      pluginPath,
      settings: { enabled: true },
    });

    const logPath = join(pluginPath, ".logs", "log-2026-04-28.log");
    expect(result).toMatchObject({ logged: true, path: logPath });
    expect(result.pruning).toMatchObject({
      deletedFiles: 0,
      maxBytes: 25 * 1024 * 1024,
      retainedBytes: 57,
      retentionDays: 14,
    });
    expect(readFileSync(logPath, "utf8")).toBe(
      "[warn] [2026-04-28T12:34:56.789Z] : [line one\\nline two]\n",
    );
  });

  it("writes enabled log batches in one append", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-batch-");
    const now = new Date("2026-04-28T12:34:56.789Z");

    const result = await executePluginLogBatchOperation({
      now,
      params: {
        entries: [
          { level: "info", message: "first" },
          { level: "error", message: "second" },
        ],
      },
      permissions: ["log:write"],
      pluginPath,
      settings: { enabled: true },
    });

    const logPath = join(pluginPath, ".logs", "log-2026-04-28.log");
    expect(result).toMatchObject({ entries: 2, logged: true, path: logPath });
    expect(readFileSync(logPath, "utf8")).toBe(
      "[info] [2026-04-28T12:34:56.789Z] : [first]\n[error] [2026-04-28T12:34:56.789Z] : [second]\n",
    );
  });

  it("prunes logs older than the configured retention window", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-retention-");
    const logsPath = join(pluginPath, ".logs");
    mkdirSync(logsPath);
    writeFileSync(join(logsPath, "log-2026-04-13.log"), "old\n");
    writeFileSync(join(logsPath, "log-2026-04-14.log"), "cutoff\n");
    writeFileSync(join(logsPath, "log-2026-04-20.log"), "recent\n");

    const result = await executePluginLogOperation({
      now: new Date("2026-04-28T00:00:00.000Z"),
      params: { level: "info", message: "today" },
      permissions: ["log:write"],
      pluginPath,
      settings: { enabled: true, maxBytes: 1024, retentionDays: 14 },
    });

    expect(existsSync(join(logsPath, "log-2026-04-13.log"))).toBe(false);
    expect(existsSync(join(logsPath, "log-2026-04-14.log"))).toBe(true);
    expect(existsSync(join(logsPath, "log-2026-04-20.log"))).toBe(true);
    expect(existsSync(join(logsPath, "log-2026-04-28.log"))).toBe(true);
    expect(result.pruning).toMatchObject({
      deletedBytes: 4,
      deletedFiles: 1,
      maxBytes: 1024,
      retentionDays: 14,
    });
  });

  it("prunes oversized logs from oldest to newest until under the configured limit", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-size-");
    const logsPath = join(pluginPath, ".logs");
    mkdirSync(logsPath);
    writeFileSync(join(logsPath, "log-2026-04-26.log"), "a".repeat(50));
    writeFileSync(join(logsPath, "log-2026-04-27.log"), "b".repeat(50));

    const result = await executePluginLogOperation({
      now: new Date("2026-04-28T00:00:00.000Z"),
      params: { level: "info", message: "x" },
      permissions: ["log:write"],
      pluginPath,
      settings: { enabled: true, maxBytes: 100, retentionDays: 14 },
    });

    const currentLogPath = join(logsPath, "log-2026-04-28.log");
    expect(existsSync(join(logsPath, "log-2026-04-26.log"))).toBe(false);
    expect(existsSync(join(logsPath, "log-2026-04-27.log"))).toBe(true);
    expect(existsSync(currentLogPath)).toBe(true);
    expect(
      statSync(join(logsPath, "log-2026-04-27.log")).size +
        statSync(currentLogPath).size,
    ).toBeLessThanOrEqual(100);
    expect(result.pruning).toMatchObject({
      deletedBytes: 50,
      deletedFiles: 1,
      maxBytes: 100,
      retentionDays: 14,
    });
  });

  it("throws for invalid enabled requests without writing logs", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-invalid-");

    await expect(
      executePluginLogOperation({
        params: { level: "verbose", message: "hidden" },
        permissions: ["log:write"],
        pluginPath,
        settings: { enabled: true },
      }),
    ).rejects.toMatchObject({ code: "invalid_plugin_log_request" });

    await expect(
      executePluginLogOperation({
        params: { level: "info", message: 42 },
        permissions: ["log:write"],
        pluginPath,
        settings: { enabled: true },
      }),
    ).rejects.toMatchObject({ code: "invalid_plugin_log_request" });
    expect(existsSync(join(pluginPath, ".logs"))).toBe(false);
  });

  it("accepts debug, info, warn, and error log levels", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-log-levels-");
    const levels = ["debug", "info", "warn", "error"] as const;

    for (const [index, level] of levels.entries()) {
      await executePluginLogOperation({
        now: new Date(`2026-04-28T12:00:0${index}.000Z`),
        params: { level, message: level },
        permissions: ["log:write"],
        pluginPath,
        settings: { enabled: true },
      });
    }

    expect(
      readFileSync(join(pluginPath, ".logs", "log-2026-04-28.log"), "utf8"),
    ).toBe(
      `[debug] [2026-04-28T12:00:00.000Z] : [debug]\n[info] [2026-04-28T12:00:01.000Z] : [info]\n[warn] [2026-04-28T12:00:02.000Z] : [warn]\n[error] [2026-04-28T12:00:03.000Z] : [error]\n`,
    );
  });
});
