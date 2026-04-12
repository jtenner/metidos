/**
 * @file src/bun/vm2-runner-bun.test.ts
 * @description vm2 runner Bun API coverage.
 */

import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("exposes only the reduced Bun helper subset alongside safe built-in modules", async () => {
  const worktreePath = makeTempDir("metidos-vm2-runner-bun-");
  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `
        const path = require("path");
        const fs = require("fs");
        fs.mkdirSync("nested", { recursive: true });
        fs.writeFileSync("nested/note.txt", "ok");
        module.exports = [
          typeof Bun.sleep,
          typeof Bun.TOML,
          typeof Bun.file,
          typeof Bun.SQLite,
          typeof Bun.Glob,
          typeof fetch,
          path.join("a", "b"),
          fs.readFileSync("nested/note.txt", "utf8"),
        ].join("|");
      `,
      timeoutMs: 1_000,
      worktreePath,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) {
      throw new Error("Expected a successful sandbox run.");
    }

    expect(report.resultText).toBe(
      '"function|object|undefined|undefined|undefined|undefined|a/b|ok"',
    );
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
  }
});
