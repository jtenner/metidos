import { describe, expect, it } from "bun:test";

import {
  runUserDataWipeConfirmationFlow,
  type UserDataWipeCliDependencies,
} from "./user-data-wipe-cli";

function createDependencies(
  overrides: Partial<UserDataWipeCliDependencies> = {},
): UserDataWipeCliDependencies & {
  closedQuestionInterfaces: string[];
  deletedAppDatabasePaths: string[];
  deletedSidecarPaths: string[];
  errors: string[];
  logs: string[];
} {
  const closedQuestionInterfaces: string[] = [];
  const deletedAppDatabasePaths: string[] = [];
  const deletedSidecarPaths: string[] = [];
  const errors: string[] = [];
  const logs: string[] = [];

  const dependencies: UserDataWipeCliDependencies & {
    closedQuestionInterfaces: string[];
    deletedAppDatabasePaths: string[];
    deletedSidecarPaths: string[];
    errors: string[];
    logs: string[];
  } = {
    closeAppDatabase: () => {},
    closeQuestionInterface: () => closedQuestionInterfaces.push("closed"),
    consoleError: (message) => errors.push(message),
    consoleLog: (message) => logs.push(message),
    deleteAppDatabaseFiles: () => {
      deletedAppDatabasePaths.push("/tmp/metidos-app/app.sqlite3");
      return ["/tmp/metidos-app/app.sqlite3"];
    },
    deleteRuntimeStatsSidecarDatabaseFiles: () => {
      deletedSidecarPaths.push("/tmp/metidos-app/runtime-stats.sqlite3");
      return ["/tmp/metidos-app/runtime-stats.sqlite3"];
    },
    getAppDatabasePath: () => "/tmp/metidos-app/app.sqlite3",
    hadOpenAppDatabase: () => false,
    isAppDatabaseOpen: () => false,
    question: async () => "no",
    stdinIsTTY: true,
    stdoutIsTTY: true,
    closedQuestionInterfaces,
    deletedAppDatabasePaths,
    deletedSidecarPaths,
    errors,
    logs,
    ...overrides,
  };

  return dependencies;
}

describe("user data wipe cli", () => {
  it("cancels without deleting any app-data files when confirmation does not match", async () => {
    const prompts: string[] = [];
    const dependencies = createDependencies({
      question: async (prompt) => {
        prompts.push(prompt);
        return "cancel";
      },
    });

    await expect(runUserDataWipeConfirmationFlow(dependencies)).resolves.toBe(
      false,
    );

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("/tmp/metidos-app/app.sqlite3");
    expect(prompts[0]).toContain("runtime telemetry sidecar database");
    expect(prompts[0]).toContain('Type "DELETE" to continue');
    expect(dependencies.deletedAppDatabasePaths).toEqual([]);
    expect(dependencies.deletedSidecarPaths).toEqual([]);
    expect(dependencies.errors).toEqual(["User data wipe cancelled."]);
    expect(dependencies.closedQuestionInterfaces).toEqual(["closed"]);
  });

  it("deletes only the documented app database and runtime telemetry sidecar targets after confirmation", async () => {
    const dependencies = createDependencies({
      question: async () => " delete ",
    });

    await expect(runUserDataWipeConfirmationFlow(dependencies)).resolves.toBe(
      true,
    );

    expect(dependencies.deletedAppDatabasePaths).toEqual([
      "/tmp/metidos-app/app.sqlite3",
    ]);
    expect(dependencies.deletedSidecarPaths).toEqual([
      "/tmp/metidos-app/runtime-stats.sqlite3",
    ]);
    expect(dependencies.logs).toEqual([
      "Deleted local data files: /tmp/metidos-app/app.sqlite3, /tmp/metidos-app/runtime-stats.sqlite3",
    ]);
    expect(dependencies.errors).toEqual([]);
    expect(dependencies.closedQuestionInterfaces).toEqual(["closed"]);
  });

  it("refuses non-interactive execution before asking for confirmation", async () => {
    const dependencies = createDependencies({
      question: async () => {
        throw new Error("should not prompt");
      },
      stdinIsTTY: false,
    });

    await expect(runUserDataWipeConfirmationFlow(dependencies)).rejects.toThrow(
      "The --wipe-user-data flag requires an interactive TTY.",
    );

    expect(dependencies.deletedAppDatabasePaths).toEqual([]);
    expect(dependencies.deletedSidecarPaths).toEqual([]);
    expect(dependencies.closedQuestionInterfaces).toEqual([]);
  });
});
