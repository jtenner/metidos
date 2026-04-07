/**
 * @file src/bun/vm2-runner-worktree.test.ts
 * @description vm2 runner worktree write coverage.
 */

import { expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runUntrustedJavaScriptInVm2 } from "./vm2-runner";
import { makeTempDir } from "./vm2-runner-test-utils";

test("blocks writes outside the worktree while allowing in-worktree writes", async () => {
  const sandboxRoot = makeTempDir("jolt-vm2-runner-worktree-");
  const outsideRoot = makeTempDir("jolt-vm2-runner-outside-");
  const outsideFile = join(outsideRoot, "outside.txt");
  const insideFile = join(sandboxRoot, "inside.txt");
  writeFileSync(outsideFile, "secret");

  try {
    const report = await runUntrustedJavaScriptInVm2({
      code: `
          const fs = require("fs");
          try {
            fs.writeFileSync(${JSON.stringify(outsideFile)}, "nope");
          } catch (error) {
            console.error(error.message);
          }
          fs.writeFileSync("inside.txt", "yes");
          module.exports = fs.readFileSync("inside.txt", "utf8");
        `,
      timeoutMs: 1_000,
      worktreePath: sandboxRoot,
    });

    expect(report.ok).toBe(true);
    if (!report.ok) {
      throw new Error("Expected a successful sandbox run.");
    }

    expect(
      report.stderr.some((line) =>
        line.includes("Sandbox writes must stay within the current worktree"),
      ),
    ).toBe(true);
    expect(readFileSync(insideFile, "utf8")).toBe("yes");
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
