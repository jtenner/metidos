/**
 * @file src/mainview/project-close.test.ts
 * @description Test file for project close.
 */

import { describe, expect, it } from "bun:test";

import { runRollbackSafeProjectClose } from "./project-close";

describe("rollback-safe project close helper", () => {
  it("commits local close state only after backend close succeeds", async () => {
    const events: string[] = [];
    let releaseClose = (): void => {};
    const closeProjectPromise = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });

    const resultPromise = runRollbackSafeProjectClose({
      closeProject: async () => {
        events.push("close:start");
        await closeProjectPromise;
        events.push("close:done");
      },
      commitLocalClose: () => {
        events.push("commit");
      },
      onCloseError: () => {
        events.push("error");
      },
    });

    expect(events).toEqual(["close:start"]);
    releaseClose();
    await expect(resultPromise).resolves.toBeTrue();
    expect(events).toEqual(["close:start", "close:done", "commit"]);
  });

  it("rolls back local close when backend close fails", async () => {
    const events: string[] = [];
    const failure = new Error("close failed");

    await expect(
      runRollbackSafeProjectClose({
        closeProject: async () => {
          events.push("close:start");
          throw failure;
        },
        commitLocalClose: () => {
          events.push("commit");
        },
        onCloseError: (error) => {
          events.push(
            error instanceof Error ? `error:${error.message}` : "error",
          );
        },
      }),
    ).resolves.toBeFalse();

    expect(events).toEqual(["close:start", "error:close failed"]);
  });
});
