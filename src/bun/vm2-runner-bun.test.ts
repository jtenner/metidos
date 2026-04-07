/**
 * @file src/bun/vm2-runner-bun.test.ts
 * @description vm2 runner Bun API coverage.
 */

import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("exposes Bun and safe built-in modules", async () => {
  const worktreePath = makeTempDir("jolt-vm2-runner-bun-");
  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `
        const path = require("path");
        const fs = require("fs");
        fs.mkdirSync("nested", { recursive: true });
        fs.writeFileSync("nested/note.txt", "ok");
        console.log(typeof Bun.sleep);
        module.exports = path.join("a", "b") + ":" + fs.readFileSync("nested/note.txt", "utf8");
      `,
      timeoutMs: 1_000,
      worktreePath,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) {
      throw new Error("Expected a successful sandbox run.");
    }

    expect(report.stdout).toContain("[console.log] function");
    expect(report.resultText).toBe('"a/b:ok"');
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
  }
});
