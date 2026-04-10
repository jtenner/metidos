/**
 * @file src/bun/vm2-runner-timeout.test.ts
 * @description vm2 runner timeout coverage.
 */

import { expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("times out long-running code", async () => {
  const worktreePath = makeTempDir("metidos-vm2-runner-timeout-");
  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: "while (true) {}",
      timeoutMs: 50,
      worktreePath,
    });

    expect(report.ok).toBe(false);
    if (report.ok) {
      throw new Error("Expected the sandbox to time out.");
    }

    expect(report.timedOut).toBe(true);
    expect(report.error.name).toBe("TimeoutError");
  } finally {
    rmSync(worktreePath, {
      force: true,
      recursive: true,
    });
  }
});
