/**
 * @file src/bun/vm2-runner-console.test.ts
 * @description vm2 runner console coverage.
 */

import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("captures console output and returned values", async () => {
  const worktreePath = makeTempDir("jolt-vm2-runner-console-");
  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `
        console.log("hello");
        console.error("boom");
        module.exports = 42;
      `,
      timeoutMs: 1_000,
      worktreePath,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) {
      throw new Error("Expected a successful sandbox run.");
    }

    expect(report.stdout).toContain("[console.log] hello");
    expect(report.stderr).toContain("[console.error] boom");
    expect(report.resultText).toBe("42");
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
  }
});
