/**
 * @file src/bun/vm2-runner-sandbox-surface.test.ts
 * @description vm2 runner ambient host-surface regressions.
 */

import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("blocks outside-worktree reads through Bun.file", async () => {
  const sandboxRoot = makeTempDir("metidos-vm2-runner-bun-file-");
  const outsideRoot = makeTempDir("metidos-vm2-runner-bun-file-outside-");
  const outsideFile = join(outsideRoot, "secret.txt");
  writeFileSync(outsideFile, "secret", "utf8");

  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `module.exports = Bun.file(${JSON.stringify(outsideFile)}).text();`,
      timeoutMs: 1_000,
      worktreePath: sandboxRoot,
    });

    expect(report.ok).toBe(false);
    if (report.ok) {
      throw new Error("Expected Bun.file access to be blocked.");
    }

    expect(report.error.message).toContain("Bun.file");
    expect(readFileSync(outsideFile, "utf8")).toBe("secret");
  } finally {
    rmSync(sandboxRoot, {
      force: true,
      recursive: true,
    });
    rmSync(outsideRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blocks outside-worktree writes through Bun.SQLite", async () => {
  const sandboxRoot = makeTempDir("metidos-vm2-runner-bun-sqlite-");
  const outsideRoot = makeTempDir("metidos-vm2-runner-bun-sqlite-outside-");
  const outsideDatabasePath = join(outsideRoot, "outside.sqlite");

  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `
        const db = new Bun.SQLite.Database(${JSON.stringify(outsideDatabasePath)});
        db.run("CREATE TABLE demo (value TEXT)");
        db.run("INSERT INTO demo VALUES ('x')");
        db.close();
        module.exports = "unexpected";
      `,
      timeoutMs: 1_000,
      worktreePath: sandboxRoot,
    });

    expect(report.ok).toBe(false);
    if (report.ok) {
      throw new Error("Expected Bun.SQLite access to be blocked.");
    }

    expect(report.error.message).toContain("SQLite");
    expect(existsSync(outsideDatabasePath)).toBe(false);
  } finally {
    rmSync(sandboxRoot, {
      force: true,
      recursive: true,
    });
    rmSync(outsideRoot, {
      force: true,
      recursive: true,
    });
  }
});

test("blocks ambient network access through fetch", async () => {
  const sandboxRoot = makeTempDir("metidos-vm2-runner-fetch-");
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      requestCount += 1;
      return new Response("network-ok");
    },
  });
  const url = `http://127.0.0.1:${server.port}/probe`;

  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `module.exports = fetch(${JSON.stringify(url)}).then((response) => response.text());`,
      timeoutMs: 1_000,
      worktreePath: sandboxRoot,
    });

    expect(report.ok).toBe(false);
    if (report.ok) {
      throw new Error("Expected fetch access to be blocked.");
    }

    expect(report.error.message).toContain("fetch");
    expect(requestCount).toBe(0);
  } finally {
    server.stop(true);
    rmSync(sandboxRoot, {
      force: true,
      recursive: true,
    });
  }
});
