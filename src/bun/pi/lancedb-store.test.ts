/**
 * @file src/bun/pi/lancedb-store.test.ts
 * @description Tests for the workspace-scoped LanceDB-style vector store.
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  deleteLanceDbRecord,
  queryLanceDbRecords,
  resolveLanceDbStoreFile,
  upsertLanceDbRecords,
} from "./lancedb-store";

const tempDirectories = new Set<string>();

function makeWorktree(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-lancedb-store-"));
  tempDirectories.add(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("LanceDB store", () => {
  it("upserts, updates, queries, and deletes vector records", async () => {
    const worktreePath = makeWorktree();
    const filePath = resolveLanceDbStoreFile({
      path: "vectors/tasks",
      rootPath: worktreePath,
    });

    await expect(
      upsertLanceDbRecords({
        filePath,
        rows: [
          { id: 10, title: "alpha", vector: [1, 0] },
          { title: "beta", vector: [0, 1] },
        ],
      }),
    ).resolves.toEqual({ count: 2, ids: [10, 11] });

    await upsertLanceDbRecords({
      filePath,
      rows: [{ id: 10, title: "alpha updated", vector: [0.9, 0.1] }],
    });

    await expect(
      queryLanceDbRecords({ filePath, vector: [1, 0] }),
    ).resolves.toMatchObject([
      { id: 10, props: { title: "alpha updated" } },
      { id: 11, props: { title: "beta" } },
    ]);

    await expect(deleteLanceDbRecord({ filePath, id: 10 })).resolves.toEqual({
      deleted: true,
      id: 10,
    });
    await expect(
      queryLanceDbRecords({ filePath, vector: [1, 0] }),
    ).resolves.toMatchObject([{ id: 11 }]);
  });

  it("recovers next ids from existing store records", async () => {
    const worktreePath = makeWorktree();
    const filePath = resolveLanceDbStoreFile({
      path: "vectors",
      rootPath: worktreePath,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify({ records: [{ id: 5, props: { id: 5 }, vector: [1] }] })}\n`,
    );

    await expect(
      upsertLanceDbRecords({
        filePath,
        rows: [{ title: "next", vector: [1] }],
      }),
    ).resolves.toEqual({ count: 1, ids: [6] });
  });

  it("rejects invalid store next ids", async () => {
    const worktreePath = makeWorktree();
    const filePath = resolveLanceDbStoreFile({
      path: "vectors",
      rootPath: worktreePath,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(
      filePath,
      `${JSON.stringify({ nextId: "bad", records: [] })}\n`,
    );

    await expect(
      upsertLanceDbRecords({
        filePath,
        rows: [{ title: "next", vector: [1] }],
      }),
    ).rejects.toThrow("Invalid LanceDB store next id");
  });

  it("keeps similarity scores finite for very large vector values", async () => {
    const worktreePath = makeWorktree();
    const filePath = resolveLanceDbStoreFile({
      path: "vectors",
      rootPath: worktreePath,
    });

    await upsertLanceDbRecords({
      filePath,
      rows: [{ id: 1, title: "huge", vector: [Number.MAX_VALUE, 0] }],
    });

    await expect(
      queryLanceDbRecords({ filePath, vector: [Number.MAX_VALUE, 0] }),
    ).resolves.toMatchObject([{ id: 1, score: 1 }]);
  });

  it("rejects symlink escapes", async () => {
    if (process.platform === "win32") {
      return;
    }
    const worktreePath = makeWorktree();
    const outsidePath = makeWorktree();
    symlinkSync(outsidePath, join(worktreePath, "linked"), "dir");

    expect(() =>
      resolveLanceDbStoreFile({
        path: "linked/vectors",
        rootPath: worktreePath,
      }),
    ).toThrow("symbolic links");

    const filePath = resolveLanceDbStoreFile({
      path: "vectors",
      rootPath: worktreePath,
    });
    mkdirSync(dirname(filePath), { recursive: true });
    const outsideFile = join(outsidePath, "metidos-lancedb.json");
    writeFileSync(outsideFile, JSON.stringify({ records: [] }));
    symlinkSync(outsideFile, filePath);

    await expect(
      queryLanceDbRecords({ filePath, vector: [1] }),
    ).rejects.toThrow("symbolic link");
  });

  it("rejects invalid paths and vectors", async () => {
    const worktreePath = makeWorktree();
    expect(() =>
      resolveLanceDbStoreFile({ path: "../outside", rootPath: worktreePath }),
    ).toThrow("inside the current workspace");
    expect(() =>
      resolveLanceDbStoreFile({ path: "/tmp/outside", rootPath: worktreePath }),
    ).toThrow("relative to the current workspace");

    await expect(
      upsertLanceDbRecords({
        filePath: resolveLanceDbStoreFile({
          path: "vectors",
          rootPath: worktreePath,
        }),
        rows: [{ id: 1, vector: [1, Number.NaN] }],
      }),
    ).rejects.toThrow("finite numbers");

    await expect(
      upsertLanceDbRecords({
        filePath: resolveLanceDbStoreFile({
          path: "vectors",
          rootPath: worktreePath,
        }),
        rows: [{ id: Number.MAX_SAFE_INTEGER, vector: [1] }],
      }),
    ).rejects.toThrow("safe positive integers");
  });
});
