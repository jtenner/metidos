/**
 * @file src/bun/security-audit-cli.ts
 * @description Module for security audit cli.
 */

import { closeAppDatabase, initAppDatabase } from "./db";
import { listSecurityAuditEventsFromDatabase } from "./security-audit";

export type SecurityAuditCliOptions = {
  format: "json" | "text";
  limit: number;
  projectId?: number;
  showHelp: boolean;
  threadId?: number;
};

const DEFAULT_SECURITY_AUDIT_CLI_LIMIT = 50;

export const SECURITY_AUDIT_HELP_TEXT = `Usage:
  bun run audit:log [--json] [--limit <count>] [--project-id <id>] [--thread-id <id>]

Options:
  --json              Print the audit log as formatted JSON.
  --limit <count>     Limit the number of returned events. Default: 50.
  --project-id <id>   Restrict results to a single project id.
  --thread-id <id>    Restrict results to a single thread id.
  --help, -h          Show this help text.
`;
/**
 * Function of parsePositiveIntegerFlag.
 * @param value - The value of `value`.
 * @param flagName - The value of `flagName`.
 */

function parsePositiveIntegerFlag(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Expected ${flagName} to be a positive integer.`);
  }
  return parsed;
}
/**
 * Function of parseSecurityAuditCliArgs.
 * @param args - The value of `args`.
 */

export function parseSecurityAuditCliArgs(
  args: string[],
): SecurityAuditCliOptions {
  let format: SecurityAuditCliOptions["format"] = "text";
  let limit = DEFAULT_SECURITY_AUDIT_CLI_LIMIT;
  let projectId: number | undefined;
  let showHelp = false;
  let threadId: number | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--json") {
      format = "json";
      continue;
    }
    if (arg === "--limit") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(
          `Expected --limit to be followed by a positive integer.`,
        );
      }
      limit = parsePositiveIntegerFlag(nextValue, "--limit");
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      limit = parsePositiveIntegerFlag(arg.slice("--limit=".length), "--limit");
      continue;
    }
    if (arg === "--project-id") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(
          `Expected --project-id to be followed by a positive integer.`,
        );
      }
      projectId = parsePositiveIntegerFlag(nextValue, "--project-id");
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      projectId = parsePositiveIntegerFlag(
        arg.slice("--project-id=".length),
        "--project-id",
      );
      continue;
    }
    if (arg === "--thread-id") {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(
          `Expected --thread-id to be followed by a positive integer.`,
        );
      }
      threadId = parsePositiveIntegerFlag(nextValue, "--thread-id");
      index += 1;
      continue;
    }
    if (arg.startsWith("--thread-id=")) {
      threadId = parsePositiveIntegerFlag(
        arg.slice("--thread-id=".length),
        "--thread-id",
      );
      continue;
    }

    throw new Error(`Unknown security audit flag "${arg}".`);
  }

  return {
    format,
    limit,
    ...(typeof projectId === "number"
      ? {
          projectId,
        }
      : {}),
    showHelp,
    ...(typeof threadId === "number"
      ? {
          threadId,
        }
      : {}),
  };
}
/**
 * Function of formatSecurityAuditEventsForCli.
 * @param events - The value of `events`.
 */

export function formatSecurityAuditEventsForCli(
  events: ReturnType<typeof listSecurityAuditEventsFromDatabase>,
): string {
  if (events.length === 0) {
    return "No security audit events found.";
  }

  return events
    .map((event) => {
      const lines = [
        `[${event.createdAt}] ${event.eventType}`,
        event.summaryText,
      ];
      if (event.projectId !== null) {
        lines.push(`project: ${event.projectId}`);
      }
      if (event.threadId !== null) {
        lines.push(`thread: ${event.threadId}`);
      }
      if (event.worktreePath) {
        lines.push(`worktree: ${event.worktreePath}`);
      }
      if (event.payload) {
        lines.push("payload:");
        lines.push(JSON.stringify(event.payload, null, 2));
      }
      return lines.join("\n");
    })
    .join("\n\n");
}
/**
 * Function of runSecurityAuditCli.
 * @param args - The value of `args`.
 */

export async function runSecurityAuditCli(args: string[]): Promise<void> {
  const options = parseSecurityAuditCliArgs(args);
  if (options.showHelp) {
    console.log(SECURITY_AUDIT_HELP_TEXT);
    return;
  }

  const events = listSecurityAuditEventsFromDatabase(initAppDatabase(), {
    limit: options.limit,
    ...(typeof options.projectId === "number"
      ? {
          projectId: options.projectId,
        }
      : {}),
    ...(typeof options.threadId === "number"
      ? {
          threadId: options.threadId,
        }
      : {}),
  });

  if (options.format === "json") {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  console.log(formatSecurityAuditEventsForCli(events));
}

if (import.meta.main) {
  void runSecurityAuditCli(Bun.argv.slice(2))
    .catch((error) => {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : String(error);
      console.error(message);
      process.exitCode = 1;
    })
    .finally(() => {
      closeAppDatabase();
    });
}
