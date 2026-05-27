/**
 * @file src/bun/plugin/lancedb.test.ts
 * @description Tests for Plugin System v1 LanceDB host operations.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { executePluginLanceDbOperation } from "./lancedb";

const tempDirectories = new Set<string>();

function makePluginRoot(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-plugin-lancedb-"));
  mkdirSync(join(directory, ".data"), { recursive: true });
  tempDirectories.add(directory);
  return directory;
}

const permissions = ["metidos:lancedb", "storage:write"];

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("executePluginLanceDbOperation", () => {
  it("routes plugin upsert, query, and delete inside ~/ plugin data", async () => {
    const pluginPath = makePluginRoot();

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: {
          path: "~/vectors",
          rows: [
            { id: 1, title: "alpha", vector: [1, 0] },
            { id: 2, title: "beta", vector: [0, 1] },
          ],
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ count: 2, ids: [1, 2] });

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.query",
        params: { path: "~/vectors", vector: [1, 0] },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject([{ id: 1 }, { id: 2 }]);

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.delete",
        params: { id: 1, path: "~/vectors" },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ deleted: true, id: 1 });
  });

  it("normalizes surrounding whitespace in store paths", async () => {
    const pluginPath = makePluginRoot();

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: {
          path: " ~/vectors ",
          rows: [{ id: 1, title: "alpha", vector: [1, 0] }],
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ count: 1, ids: [1] });

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.query",
        params: { path: "~/vectors", vector: [1, 0] },
        permissions,
        pluginPath,
      }),
    ).resolves.toMatchObject([{ id: 1 }]);
  });

  it("enforces plugin data quota for writes without leaving oversized state", async () => {
    const pluginPath = makePluginRoot();
    const storePath = join(
      pluginPath,
      ".data",
      "vectors",
      "metidos-lancedb.json",
    );

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: {
          path: "~/vectors",
          rows: [{ id: 1, title: "large", vector: Array(128).fill(1) }],
        },
        permissions,
        pluginPath,
        quota: { maxDataBytes: 400, maxFileBytes: 400, maxFiles: 10 },
      }),
    ).rejects.toThrow("plugin data quota");
    expect(existsSync(storePath)).toBe(false);

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: {
          path: "~/vectors",
          rows: [{ id: 1, title: "small", vector: [1] }],
        },
        permissions,
        pluginPath,
      }),
    ).resolves.toEqual({ count: 1, ids: [1] });
    const previousStore = readFileSync(storePath, "utf8");

    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: {
          path: "~/vectors",
          rows: [{ id: 2, title: "large", vector: Array(128).fill(1) }],
        },
        permissions,
        pluginPath,
        quota: { maxDataBytes: 400, maxFileBytes: 400, maxFiles: 10 },
      }),
    ).rejects.toThrow("plugin data quota");
    expect(readFileSync(storePath, "utf8")).toBe(previousStore);
  });

  it("requires LanceDB permission, storage write, and ~/ paths", async () => {
    const pluginPath = makePluginRoot();
    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: { path: "~/vectors", props: { vector: [1] } },
        permissions: ["storage:write"],
        pluginPath,
      }),
    ).rejects.toThrow("metidos:lancedb");
    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: { path: "~/vectors", props: { vector: [1] } },
        permissions: ["metidos:lancedb"],
        pluginPath,
      }),
    ).rejects.toThrow("storage:write");
    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.upsert",
        params: { path: "./vectors", props: { vector: [1] } },
        permissions,
        pluginPath,
      }),
    ).rejects.toThrow("~/ paths");
    await expect(
      executePluginLanceDbOperation({
        operation: "lancedb.delete",
        params: { id: Number.MAX_SAFE_INTEGER, path: "~/vectors" },
        permissions,
        pluginPath,
      }),
    ).rejects.toThrow("safe positive integer");
  });
});
