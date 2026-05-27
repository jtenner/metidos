#!/usr/bin/env bun

import { Database } from "bun:sqlite";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = dirname(fileURLToPath(import.meta.url));

function getHostExtensionPath(): string {
  if (process.platform === "linux") {
    return join(
      projectDirectory,
      "dist",
      process.arch === "arm64" ? "aarch64-linux-gnu" : "x86_64-linux-gnu",
      "metidos_sqlite_security.so",
    );
  }
  if (process.platform === "darwin") {
    return join(
      projectDirectory,
      "dist",
      process.arch === "arm64" ? "aarch64-macos" : "x86_64-macos",
      "metidos_sqlite_security.dylib",
    );
  }
  if (process.platform === "win32") {
    return join(
      projectDirectory,
      "dist",
      "x86_64-windows-gnu",
      "metidos_sqlite_security.dll",
    );
  }
  throw new Error(
    `Unsupported host platform: ${process.platform}/${process.arch}`,
  );
}

function expectDenied(db: Database, sql: string): void {
  try {
    db.exec(sql);
  } catch {
    return;
  }
  throw new Error(`Expected SQL to be denied: ${sql}`);
}

const extensionPath = process.argv[2] ?? getHostExtensionPath();
if (!existsSync(extensionPath)) {
  throw new Error(
    `Extension not found at ${extensionPath}. Run: bun run native/sqlite-security-extension/build.ts --target=host`,
  );
}

const vacuumPath = join(projectDirectory, "dist", "smoke-vacuum.sqlite");
rmSync(vacuumPath, { force: true });

const db = new Database(":memory:");
db.loadExtension(extensionPath);

const result = db.query("select 1 as ok").get() as { ok: number } | null;
if (result?.ok !== 1) {
  throw new Error("Expected normal SELECT statements to continue working");
}

expectDenied(db, "attach database ':memory:' as other");
expectDenied(db, `vacuum into '${vacuumPath.replaceAll("'", "''")}'`);
expectDenied(db, "select load_extension('extension')");

console.log(`SQLite security extension smoke test passed: ${extensionPath}`);
