/**
 * @file src/bun/vm2-runner-test-utils.ts
 * @description Helpers for vm2 runner tests.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temp directory for a vm2 runner test.
 * @param prefix - Directory name prefix.
 */
export function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
