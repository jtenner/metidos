import { mkdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { listDirectorySuggestions } from "./directory-suggestions";

const tempRoots: string[] = [];

async function makeTempDirectory(name: string): Promise<string> {
  const root = join(import.meta.dir, `.tmp-${name}-${crypto.randomUUID()}`);
  tempRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("listDirectorySuggestions", () => {
  it("filters symlinked child directories that resolve outside a restricted root", async () => {
    const root = await makeTempDirectory("restricted-root");
    const outside = await makeTempDirectory("outside-root");
    await mkdir(join(root, "local-child"));
    await mkdir(join(outside, "external-child"));
    await symlink(outside, join(root, "outside-link"));

    const suggestions = listDirectorySuggestions(`${root}/`, {
      rootDirectory: root,
    });

    expect(suggestions).toContain(join(root, "local-child"));
    expect(suggestions).not.toContain(join(root, "outside-link"));
  });

  it("rejects a restricted search directory that resolves outside the root", async () => {
    const root = await makeTempDirectory("restricted-search-root");
    const outside = await makeTempDirectory("outside-search-root");
    await mkdir(join(outside, "external-child"));
    await symlink(outside, join(root, "outside-link"));

    const suggestions = listDirectorySuggestions(
      `${join(root, "outside-link")}/`,
      {
        rootDirectory: root,
      },
    );

    expect(suggestions).toEqual([]);
  });
});
