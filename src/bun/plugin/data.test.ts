/**
 * @file src/bun/plugin/data.test.ts
 * @description Tests for Plugin System v1 .data root mapping and first-activation seeding.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  copyPluginDataPath,
  ensurePluginDataRootForActivation,
  makePluginDataDirectory,
  movePluginDataPath,
  PluginDataQuotaError,
  type PluginDataQuotaSettings,
  PluginGcError,
  resetPluginDataRoot,
  resolvePluginDataDirectoryPath,
  resolvePluginDataVirtualPath,
  writePluginDataFile,
} from "./data";

const tempDirectories = new Set<string>();

function createTempDirectory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  tempDirectories.add(path);
  return path;
}

function writeSeedFile(
  pluginPath: string,
  relativePath: string,
  contents: string,
): void {
  const parts = relativePath.split("/");
  const parentPath = join(pluginPath, "seed", ...parts.slice(0, -1));
  mkdirSync(parentPath, { recursive: true });
  writeFileSync(join(parentPath, parts.at(-1) ?? relativePath), contents);
}

const DEFAULT_TEST_QUOTA: PluginDataQuotaSettings = {
  maxDataBytes: 1024,
  maxFileBytes: 512,
  maxFiles: 10,
};

async function expectPluginDataQuotaError(
  operation: Promise<unknown>,
): Promise<PluginDataQuotaError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(PluginDataQuotaError);
    return error as PluginDataQuotaError;
  }
  throw new Error("Expected plugin data quota operation to fail.");
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("plugin data roots", () => {
  it("maps ~/ virtual paths to the plugin .data directory and rejects escapes", () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-map-");

    expect(resolvePluginDataDirectoryPath(pluginPath)).toBe(
      join(pluginPath, ".data"),
    );
    expect(resolvePluginDataVirtualPath(pluginPath, "~/nested/file.txt")).toBe(
      join(pluginPath, ".data", "nested", "file.txt"),
    );
    expect(() =>
      resolvePluginDataVirtualPath(pluginPath, "./file.txt"),
    ).toThrow("Plugin data virtual paths must start with ~/.");
    expect(() =>
      resolvePluginDataVirtualPath(pluginPath, "~/../escape"),
    ).toThrow("Plugin data virtual path escaped the plugin .data root.");
  });

  it("creates .data and copies seed files before first activation", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-seed-");
    writeSeedFile(pluginPath, "config/default.json", '{"enabled":true}\n');
    writeSeedFile(pluginPath, "README.md", "# Seed\n");

    const result = await ensurePluginDataRootForActivation({
      activatedOnce: false,
      pluginPath,
    });

    expect(result).toMatchObject({
      dataPath: join(pluginPath, ".data"),
      seedPath: join(pluginPath, "seed"),
      seeded: true,
      skippedBecauseActivatedOnce: false,
    });
    expect(
      readFileSync(join(pluginPath, ".data", "config", "default.json"), "utf8"),
    ).toBe('{"enabled":true}\n');
    expect(readFileSync(join(pluginPath, ".data", "README.md"), "utf8")).toBe(
      "# Seed\n",
    );
  });

  it("does not recreate or reseed deleted .data after activation happened once", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-no-reseed-");
    writeSeedFile(pluginPath, "config/default.json", '{"enabled":true}\n');

    const result = await ensurePluginDataRootForActivation({
      activatedOnce: true,
      pluginPath,
    });

    expect(result).toMatchObject({
      seeded: false,
      skippedBecauseActivatedOnce: true,
    });
    expect(existsSync(join(pluginPath, ".data"))).toBe(false);
  });

  it("explicit reset backs up existing .data and reseeds deterministically", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-reset-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "user.json"), '{"custom":true}\n');
    writeSeedFile(pluginPath, "config/default.json", '{"enabled":true}\n');

    const result = await resetPluginDataRoot({
      now: () => new Date("2026-04-28T15:30:45.123Z"),
      pluginPath,
    });

    expect(result.backupPath).toBe(
      join(pluginPath, ".data-bak-2026-04-28T15-30-45-123Z"),
    );
    expect(result.seeded).toBe(true);
    expect(
      readFileSync(
        join(pluginPath, ".data-bak-2026-04-28T15-30-45-123Z", "user.json"),
        "utf8",
      ),
    ).toBe('{"custom":true}\n');
    expect(
      readFileSync(join(pluginPath, ".data", "config", "default.json"), "utf8"),
    ).toBe('{"enabled":true}\n');
    expect(existsSync(join(pluginPath, ".data", "user.json"))).toBe(false);
  });

  it("rejects oversized writes before creating data files", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-write-quota-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });

    const error = await expectPluginDataQuotaError(
      writePluginDataFile({
        contents: "too large",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxFileBytes: 4,
        },
        virtualPath: "~/oversized.txt",
      }),
    );

    expect(error.code).toBe("plugin_data_quota_exceeded");
    expect(error.message).toBe(
      "Plugin data operation exceeds the per-file quota.",
    );
    expect(error.message).not.toContain(pluginPath);
    expect(existsSync(join(pluginPath, ".data", "oversized.txt"))).toBe(false);
  });

  it("rejects total-byte and file-count write growth before commit", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-growth-quota-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "existing.txt"), "12345");

    const byteError = await expectPluginDataQuotaError(
      writePluginDataFile({
        contents: "6789",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxDataBytes: 8,
        },
        virtualPath: "~/new.txt",
      }),
    );
    expect(byteError.message).toBe(
      "Plugin data operation exceeds the total storage quota.",
    );
    expect(existsSync(join(pluginPath, ".data", "new.txt"))).toBe(false);

    const fileError = await expectPluginDataQuotaError(
      writePluginDataFile({
        contents: "ok",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxFiles: 1,
        },
        virtualPath: "~/second.txt",
      }),
    );
    expect(fileError.message).toBe(
      "Plugin data operation exceeds the file-count quota.",
    );
    expect(existsSync(join(pluginPath, ".data", "second.txt"))).toBe(false);
  });

  it("runs plugin GC against ~/ data before quota failure and retries preflight", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-gc-quota-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "cache.txt"), "12345");
    const gcRequests: unknown[] = [];

    await writePluginDataFile({
      contents: "6789",
      pluginPath,
      quota: {
        ...DEFAULT_TEST_QUOTA,
        maxDataBytes: 8,
      },
      runGc: async (request) => {
        gcRequests.push(request);
        rmSync(join(pluginPath, ".data", "cache.txt"));
      },
      virtualPath: "~/new.txt",
    });

    expect(gcRequests).toEqual([
      {
        pluginPath,
        reason: "quota_preflight",
        virtualRoot: "~/",
      },
    ]);
    expect(readFileSync(join(pluginPath, ".data", "new.txt"), "utf8")).toBe(
      "6789",
    );
    expect(existsSync(join(pluginPath, ".data", "cache.txt"))).toBe(false);
  });

  it("aborts the original write with PluginGcError when quota-triggered GC fails", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-gc-failure-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "cache.txt"), "12345");

    await expect(
      writePluginDataFile({
        contents: "6789",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxDataBytes: 8,
        },
        runGc: () => {
          throw new Error("gc broke");
        },
        virtualPath: "~/new.txt",
      }),
    ).rejects.toBeInstanceOf(PluginGcError);
    expect(existsSync(join(pluginPath, ".data", "new.txt"))).toBe(false);
    expect(readFileSync(join(pluginPath, ".data", "cache.txt"), "utf8")).toBe(
      "12345",
    );
  });

  it("enforces quota before plugin data copy operations", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-copy-quota-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "source.txt"), "12345");

    const error = await expectPluginDataQuotaError(
      copyPluginDataPath({
        fromVirtualPath: "~/source.txt",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxDataBytes: 9,
        },
        toVirtualPath: "~/copy.txt",
      }),
    );

    expect(error.code).toBe("plugin_data_quota_exceeded");
    expect(error.message).not.toContain(pluginPath);
    expect(existsSync(join(pluginPath, ".data", "copy.txt"))).toBe(false);

    await copyPluginDataPath({
      fromVirtualPath: "~/source.txt",
      pluginPath,
      quota: {
        ...DEFAULT_TEST_QUOTA,
        maxDataBytes: 10,
      },
      toVirtualPath: "~/copy.txt",
    });
    expect(readFileSync(join(pluginPath, ".data", "copy.txt"), "utf8")).toBe(
      "12345",
    );
  });

  it("enforces quota before plugin data move operations", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-move-quota-");
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(join(pluginPath, ".data", "source.txt"), "123456");

    const error = await expectPluginDataQuotaError(
      movePluginDataPath({
        fromVirtualPath: "~/source.txt",
        pluginPath,
        quota: {
          ...DEFAULT_TEST_QUOTA,
          maxDataBytes: 5,
        },
        toVirtualPath: "~/moved.txt",
      }),
    );

    expect(error.code).toBe("plugin_data_quota_exceeded");
    expect(existsSync(join(pluginPath, ".data", "source.txt"))).toBe(true);
    expect(existsSync(join(pluginPath, ".data", "moved.txt"))).toBe(false);

    await movePluginDataPath({
      fromVirtualPath: "~/source.txt",
      pluginPath,
      quota: DEFAULT_TEST_QUOTA,
      toVirtualPath: "~/moved.txt",
    });
    expect(existsSync(join(pluginPath, ".data", "source.txt"))).toBe(false);
    expect(readFileSync(join(pluginPath, ".data", "moved.txt"), "utf8")).toBe(
      "123456",
    );
  });

  it("does not follow plugin data symlinks during legacy writes", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-symlink-");
    const outsidePath = join(
      createTempDirectory("metidos-plugin-data-outside-"),
      "outside.txt",
    );
    mkdirSync(join(pluginPath, ".data"), { recursive: true });
    writeFileSync(outsidePath, "outside");
    symlinkSync(outsidePath, join(pluginPath, ".data", "link.txt"));

    await expect(
      writePluginDataFile({
        contents: "changed",
        pluginPath,
        quota: DEFAULT_TEST_QUOTA,
        virtualPath: "~/link.txt",
      }),
    ).rejects.toMatchObject({ code: "plugin_data_quota_unavailable" });
    expect(readFileSync(outsidePath, "utf8")).toBe("outside");
  });

  it("turns unavailable quota state into a controlled mkdir error", async () => {
    const pluginPath = createTempDirectory("metidos-plugin-data-mkdir-quota-");
    writeFileSync(join(pluginPath, ".data"), "not a directory");

    const error = await expectPluginDataQuotaError(
      makePluginDataDirectory({
        pluginPath,
        quota: DEFAULT_TEST_QUOTA,
        virtualPath: "~/nested",
      }),
    );

    expect(error.code).toBe("plugin_data_quota_unavailable");
    expect(error.message).toBe("Plugin data quota could not be calculated.");
    expect(error.message).not.toContain(pluginPath);
  });
});
