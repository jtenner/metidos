import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let appDataDir = "";
let originalAppDataDir: string | undefined;

beforeAll(() => {
  originalAppDataDir = process.env.METIDOS_APP_DATA_DIR;
  appDataDir = mkdtempSync(join(tmpdir(), "metidos-client-log-test-"));
  process.env.METIDOS_APP_DATA_DIR = appDataDir;
});

afterAll(async () => {
  const { closeAppDatabase, resetResolvedAppDataDirectory } = await import(
    "../db"
  );
  closeAppDatabase();
  resetResolvedAppDataDirectory();
  if (originalAppDataDir === undefined) {
    delete process.env.METIDOS_APP_DATA_DIR;
  } else {
    process.env.METIDOS_APP_DATA_DIR = originalAppDataDir;
  }
  rmSync(appDataDir, { recursive: true, force: true });
});

describe("logClientEventProcedure", () => {
  it("requires an authenticated RPC context", async () => {
    const [
      { AuthServiceError },
      { initAppDatabase },
      { logClientEventProcedure },
    ] = await Promise.all([
      import("../auth/service"),
      import("../db"),
      import("./client-log"),
    ]);

    await expect(
      logClientEventProcedure(initAppDatabase(), {
        severity: "error",
        message: "browser failure",
      }),
    ).rejects.toBeInstanceOf(AuthServiceError);
  });
});
