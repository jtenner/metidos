import { createInterface } from "node:readline/promises";

import {
  closeAppDatabase,
  deleteAppDatabaseFiles,
  getAppDatabasePath,
  isAppDatabaseOpen,
} from "./db";
import { deleteRuntimeStatsSidecarDatabaseFiles } from "./runtime-stats-sidecar";

export const WIPE_USER_DATA_CONFIRMATION = "DELETE";

export type UserDataWipeCliDependencies = {
  closeQuestionInterface?: () => void;
  consoleError?: (message: string) => void;
  consoleLog?: (message: string) => void;
  deleteAppDatabaseFiles: () => string[];
  deleteRuntimeStatsSidecarDatabaseFiles: () => string[];
  getAppDatabasePath: () => string;
  hadOpenAppDatabase: () => boolean;
  isAppDatabaseOpen: () => boolean;
  closeAppDatabase: () => void;
  question: (prompt: string) => Promise<string>;
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
};

/**
 * Runs the destructive local database wipe confirmation flow.
 */
export async function runUserDataWipeConfirmationFlow(
  dependencies: UserDataWipeCliDependencies,
): Promise<boolean> {
  // This destructive maintenance command must only run from a real terminal:
  // stdin receives the typed confirmation and stdout shows the exact database
  // path being wiped. Refuse piped/non-interactive execution so automation,
  // redirected logs, or background jobs cannot accidentally confirm the wipe.
  if (!dependencies.stdinIsTTY || !dependencies.stdoutIsTTY) {
    throw new Error("The --wipe-user-data flag requires an interactive TTY.");
  }

  const databasePath = dependencies.getAppDatabasePath();
  const hadOpenAppDatabase = dependencies.hadOpenAppDatabase();

  try {
    const confirmation = (
      await dependencies.question(
        [
          `This will permanently delete all local user data stored in ${databasePath} and the optional runtime telemetry sidecar database in the same app-data directory.`,
          `Type "${WIPE_USER_DATA_CONFIRMATION}" to continue: `,
        ].join("\n"),
      )
    )
      .trim()
      .toUpperCase();

    if (confirmation !== WIPE_USER_DATA_CONFIRMATION) {
      dependencies.consoleError?.("User data wipe cancelled.");
      return false;
    }

    const deletedPaths = [
      ...dependencies.deleteAppDatabaseFiles(),
      ...dependencies.deleteRuntimeStatsSidecarDatabaseFiles(),
    ];
    if (deletedPaths.length === 0) {
      dependencies.consoleLog?.(
        `No local data files were present at ${databasePath} or its telemetry sidecar location.`,
      );
    } else {
      dependencies.consoleLog?.(
        `Deleted local data files: ${deletedPaths.join(", ")}`,
      );
    }

    return true;
  } finally {
    dependencies.closeQuestionInterface?.();
    if (hadOpenAppDatabase && dependencies.isAppDatabaseOpen()) {
      dependencies.closeAppDatabase();
    }
  }
}

export async function runUserDataWipeCli(): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The --wipe-user-data flag requires an interactive TTY.");
  }

  const readlineInterface = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return runUserDataWipeConfirmationFlow({
    closeAppDatabase,
    closeQuestionInterface: () => readlineInterface.close(),
    consoleError: (message) => console.error(message),
    consoleLog: (message) => console.log(message),
    deleteAppDatabaseFiles,
    deleteRuntimeStatsSidecarDatabaseFiles,
    getAppDatabasePath,
    hadOpenAppDatabase: isAppDatabaseOpen,
    isAppDatabaseOpen,
    question: (prompt) => readlineInterface.question(prompt),
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  });
}
