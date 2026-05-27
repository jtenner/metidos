/**
 * @file src/bun/pi/lancedb-tools.test.ts
 * @description Tests for project-scoped LanceDB Pi tools.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiLanceDbTools } from "./lancedb-tools";

const tempDirectories = new Set<string>();

function makeWorktree(): string {
  const directory = mkdtempSync(join(tmpdir(), "metidos-lancedb-tools-"));
  tempDirectories.add(directory);
  return directory;
}

function getTool(worktreePath: string, name: string) {
  const tool = createPiLanceDbTools({
    embed: async (input) => (input === "alpha" ? [1, 0] : [0, 1]),
    worktreePathContext: worktreePath,
  }).find((entry) => entry.name === name);
  if (!tool) throw new Error(`Expected ${name} tool to be registered.`);
  return tool;
}

async function executeTool(
  worktreePath: string,
  name: string,
  rawArgs: Record<string, unknown>,
) {
  const tool = getTool(worktreePath, name);
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  return tool.execute("call-1", args as never, undefined, async () => {}, {
    cwd: worktreePath,
  } as never);
}

afterEach(() => {
  for (const directory of tempDirectories) {
    rmSync(directory, { force: true, recursive: true });
  }
  tempDirectories.clear();
});

describe("createPiLanceDbTools", () => {
  it("upserts, embeds query text, and deletes records", async () => {
    const worktreePath = makeWorktree();

    await expect(
      executeTool(worktreePath, "lancedb_upsert", {
        path: "vectors",
        props: { id: 1, title: "alpha", vector: [1, 0] },
      }),
    ).resolves.toMatchObject({ details: { count: 1, ids: [1] } });
    await executeTool(worktreePath, "lancedb_upsert", {
      path: "vectors",
      props: { id: 2, title: "beta", vector: [0, 1] },
    });

    await expect(
      executeTool(worktreePath, "lancedb_query", {
        path: "vectors",
        query: "alpha",
      }),
    ).resolves.toMatchObject({
      details: [{ id: 1, props: { title: "alpha" } }, { id: 2 }],
    });

    await expect(
      executeTool(worktreePath, "lancedb_delete", {
        id: 1,
        path: "vectors",
      }),
    ).resolves.toMatchObject({ details: { deleted: true, id: 1 } });
  });
});
