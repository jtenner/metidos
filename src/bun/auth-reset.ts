/**
 * @file src/bun/auth-reset.ts
 * @description Module for auth reset.
 */

import type { Database } from "bun:sqlite";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import {
  generateRecoveryCodes,
  hashPrimaryFactor,
  hashRecoveryCode,
} from "./auth";
import { AuthServiceError, verifyPrimaryFactorAndTotp } from "./auth-service";
import {
  type AuthPrimaryFactorType,
  createSecurityAuditEvent,
  deleteAllAuthSessions,
  getAuthSettings,
  getUserByUsername,
  initAppDatabase,
  listKnownAuthUsernames,
  replaceAuthRecoveryCodeHashes,
  resetAuthFailureState,
  upsertAuthSettings,
} from "./db";

type TimestampOptions = {
  nowMs?: number;
};

type AuthSecretOptions = {
  appDataDir?: string;
};

type CliAuthProofInput = TimestampOptions &
  AuthSecretOptions & {
    primaryFactor: string;
    totpCode: string;
    username: string;
  };

export type ResetPrimaryFactorInput = CliAuthProofInput & {
  newPrimaryFactor: string;
  newPrimaryFactorType: AuthPrimaryFactorType;
};

type AuthResetCommand = "regenerate-recovery-codes" | "reset-primary-factor";

type ParsedArgs = {
  command: AuthResetCommand;
  newPrimaryFactorType?: AuthPrimaryFactorType;
  username?: string;
};

const HELP_TEXT = `Usage:
  bun run auth:reset reset-primary-factor [--username name] [--new-type pin|password]
  bun run auth:reset regenerate-recovery-codes [--username name]

Commands:
  reset-primary-factor      Verify current factor + TOTP, then replace the PIN/password.
  regenerate-recovery-codes Verify current factor + TOTP, then print a new view-once code set.
`;

class MutedOutput extends Writable {
  muted = false;
  /**
   * Write to stdout only when not currently collecting a secret.
   * @param chunk - Output chunk.
   * @param encoding - Output encoding.
   * @param callback - Completion callback.
   */

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      process.stdout.write(chunk, encoding);
    }
    callback();
  }
}
/**
 * Narrow a string to a supported primary-factor type.
 * @param value - Raw command input.
 */

function isAuthPrimaryFactorType(
  value: string,
): value is AuthPrimaryFactorType {
  return value === "pin" || value === "password";
}
/**
 * Convert primary-factor type into user-facing label text.
 * @param primaryFactorType - "pin" or "password".
 */

function formatPrimaryFactorLabel(
  primaryFactorType: AuthPrimaryFactorType,
): string {
  return primaryFactorType === "pin" ? "PIN" : "password";
}
/**
 * Convert a CLI auth error into a message suitable for terminal output.
 * @param error - Error from CLI flow.
 */

function toCliErrorMessage(error: unknown): string {
  if (error instanceof AuthServiceError) {
    if (
      error.code === "auth_locked" &&
      typeof error.details?.lockedUntil === "string"
    ) {
      return `${error.message} Try again after ${error.details.lockedUntil}.`;
    }
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return String(error);
}
/**
 * Parse and validate CLI command arguments.
 * @param args - CLI argv entries.
 */

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const [command, ...rest] = args;
  if (
    command !== "reset-primary-factor" &&
    command !== "regenerate-recovery-codes"
  ) {
    throw new Error(
      `Unknown or missing command. Expected "reset-primary-factor" or "regenerate-recovery-codes".`,
    );
  }

  let newPrimaryFactorType: AuthPrimaryFactorType | undefined;
  let username: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg) {
      continue;
    }
    if (arg === "--username") {
      const nextValue = rest[index + 1]?.trim();
      if (!nextValue) {
        throw new Error(`Expected "--username" to be followed by a username.`);
      }
      username = nextValue;
      index += 1;
      continue;
    }

    if (arg.startsWith("--username=")) {
      const value = arg.slice("--username=".length).trim();
      if (!value) {
        throw new Error("Username cannot be empty.");
      }
      username = value;
      continue;
    }

    if (arg === "--new-type") {
      const nextValue = rest[index + 1];
      if (!nextValue || !isAuthPrimaryFactorType(nextValue)) {
        throw new Error(
          `Expected "--new-type" to be followed by "pin" or "password".`,
        );
      }
      newPrimaryFactorType = nextValue;
      index += 1;
      continue;
    }

    if (arg.startsWith("--new-type=")) {
      const value = arg.slice("--new-type=".length);
      if (!isAuthPrimaryFactorType(value)) {
        throw new Error(`Invalid primary-factor type "${value}".`);
      }
      newPrimaryFactorType = value;
      continue;
    }

    throw new Error(`Unknown flag "${arg}".`);
  }

  return {
    command,
    ...(newPrimaryFactorType ? { newPrimaryFactorType } : {}),
    ...(username ? { username } : {}),
  };
}
/**
 * Build the minimal proof payload used by auth verification operations.
 * @param input - Parsed input arguments from this CLI.
 */

function buildCliAuthProofInput(input: CliAuthProofInput): CliAuthProofInput {
  return {
    primaryFactor: input.primaryFactor,
    totpCode: input.totpCode,
    username: input.username,
    ...(typeof input.appDataDir === "string"
      ? {
          appDataDir: input.appDataDir,
        }
      : {}),
    ...(typeof input.nowMs === "number"
      ? {
          nowMs: input.nowMs,
        }
      : {}),
  };
}
/**
 * Reset the primary factor after successful proof verification.
 * @param database - Database handle.
 * @param input - New credentials plus current proof credentials.
 */

export async function resetPrimaryFactorFromCli(
  database: Database,
  input: ResetPrimaryFactorInput,
): Promise<{
  revokedSessionCount: number;
  primaryFactorType: AuthPrimaryFactorType;
}> {
  const { settings, user } = await verifyPrimaryFactorAndTotp(
    database,
    buildCliAuthProofInput(input),
  );
  const primaryFactorHash = await hashPrimaryFactor(
    input.newPrimaryFactorType,
    input.newPrimaryFactor,
  );

  upsertAuthSettings(database, {
    primaryFactorHash,
    primaryFactorType: input.newPrimaryFactorType,
    sessionLifetimeDays: settings.sessionLifetimeDays,
    totpSecretCiphertext: settings.totpSecretCiphertext,
    userId: user.id,
  });
  resetAuthFailureState(database, user.id);
  const revokedSessionCount = deleteAllAuthSessions(database, user.id);
  createSecurityAuditEvent(database, {
    eventType: "primary_factor_reset",
    payloadJson: JSON.stringify({
      primaryFactorType: input.newPrimaryFactorType,
      revokedSessionCount,
      userId: user.id,
      username: user.username,
    }),
    summaryText: "Primary factor was reset via the authenticated CLI flow.",
  });
  return {
    primaryFactorType: input.newPrimaryFactorType,
    revokedSessionCount,
  };
}
/**
 * Regenerate recovery codes after successful proof verification.
 * @param database - Database handle.
 * @param input - Proof credentials for the current authenticated user.
 */

export async function regenerateRecoveryCodesFromCli(
  database: Database,
  input: CliAuthProofInput,
): Promise<string[]> {
  const { user } = await verifyPrimaryFactorAndTotp(
    database,
    buildCliAuthProofInput(input),
  );
  const recoveryCodes = generateRecoveryCodes();
  const codeHashes = await Promise.all(
    recoveryCodes.map((code) => hashRecoveryCode(code)),
  );
  replaceAuthRecoveryCodeHashes(database, codeHashes, user.id);
  createSecurityAuditEvent(database, {
    eventType: "recovery_codes_regenerated",
    payloadJson: JSON.stringify({
      recoveryCodeCount: recoveryCodes.length,
      userId: user.id,
      username: user.username,
    }),
    summaryText:
      "Recovery codes were regenerated via the authenticated CLI flow.",
  });
  return recoveryCodes;
}
/**
 * Prompt for user input that should stay visible.
 * @param readlineInterface - Active readline interface.
 * @param question - Prompt text to display.
 */

async function promptVisible(
  readlineInterface: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return (await readlineInterface.question(question)).trim();
}
/**
 * Prompt for input while temporarily muting terminal echo.
 * @param readlineInterface - Active readline interface.
 * @param output - Writable wrapper that supports muting.
 * @param question - Prompt text to display.
 */

async function promptSecret(
  readlineInterface: ReturnType<typeof createInterface>,
  output: MutedOutput,
  question: string,
): Promise<string> {
  process.stdout.write(question);
  output.muted = true;
  try {
    const answer = await readlineInterface.question("");
    return answer.trim();
  } finally {
    output.muted = false;
    process.stdout.write("\n");
  }
}
/**
 * Prompt until the user selects a supported primary-factor type.
 * @param readlineInterface - Active readline interface.
 */

async function promptPrimaryFactorType(
  readlineInterface: ReturnType<typeof createInterface>,
): Promise<AuthPrimaryFactorType> {
  while (true) {
    const value = (
      await promptVisible(
        readlineInterface,
        'Choose new primary factor type ("pin" or "password"): ',
      )
    ).toLowerCase();
    if (isAuthPrimaryFactorType(value)) {
      return value;
    }
    console.error('Please enter either "pin" or "password".');
  }
}

async function promptUsername(
  readlineInterface: ReturnType<typeof createInterface>,
  knownUsernames: readonly string[],
): Promise<string> {
  while (true) {
    const value = await promptVisible(
      readlineInterface,
      `Enter username${knownUsernames.length ? ` (${knownUsernames.join(", ")})` : ""}: `,
    );
    if (value) {
      return value;
    }
    console.error("Username is required.");
  }
}
/**
 * Run the interactive reset flow from command line prompts.
 * @param args - Process argv arguments.
 */

async function runInteractiveCli(args: string[]): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The auth reset CLI requires an interactive TTY.");
  }

  const parsedArgs = parseArgs(args);
  const database = initAppDatabase();
  const knownUsernames = listKnownAuthUsernames(database);
  if (knownUsernames.length === 0) {
    throw new Error("Authentication is not configured yet.");
  }

  const output = new MutedOutput();
  const readlineInterface = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });

  try {
    const username =
      parsedArgs.username ??
      (knownUsernames.length === 1
        ? (knownUsernames[0] ?? "")
        : await promptUsername(readlineInterface, knownUsernames));
    const user = getUserByUsername(database, username);
    const settings = user ? getAuthSettings(database, user.id) : null;
    if (!user || !settings) {
      throw new Error(`No configured user found for "${username}".`);
    }
    const currentPrimaryFactor = await promptSecret(
      readlineInterface,
      output,
      `Enter current ${formatPrimaryFactorLabel(settings.primaryFactorType)}: `,
    );
    const totpCode = await promptSecret(
      readlineInterface,
      output,
      "Enter current TOTP code: ",
    );

    if (parsedArgs.command === "reset-primary-factor") {
      const newPrimaryFactorType =
        parsedArgs.newPrimaryFactorType ??
        (await promptPrimaryFactorType(readlineInterface));
      const newPrimaryFactor = await promptSecret(
        readlineInterface,
        output,
        `Enter new ${formatPrimaryFactorLabel(newPrimaryFactorType)}: `,
      );
      const confirmation = await promptSecret(
        readlineInterface,
        output,
        `Re-enter new ${formatPrimaryFactorLabel(newPrimaryFactorType)}: `,
      );
      if (newPrimaryFactor !== confirmation) {
        throw new Error("New primary-factor entries did not match.");
      }

      const result = await resetPrimaryFactorFromCli(database, {
        newPrimaryFactor,
        newPrimaryFactorType,
        primaryFactor: currentPrimaryFactor,
        totpCode,
        username,
      });
      console.log(
        `Primary factor updated to ${result.primaryFactorType}. Revoked ${result.revokedSessionCount} existing session(s).`,
      );
      return;
    }

    const recoveryCodes = await regenerateRecoveryCodesFromCli(database, {
      primaryFactor: currentPrimaryFactor,
      totpCode,
      username,
    });
    console.log(
      "New recovery codes generated. They are shown once below; store them before closing this terminal.",
    );
    for (const code of recoveryCodes) {
      console.log(code);
    }
  } finally {
    readlineInterface.close();
  }
}

if (import.meta.main) {
  void runInteractiveCli(Bun.argv.slice(2)).catch((error) => {
    console.error(toCliErrorMessage(error));
    process.exitCode = 1;
  });
}
