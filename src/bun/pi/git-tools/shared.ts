/**
 * @file src/bun/pi/git-tools/shared.ts
 * @description Shared Pi-native Git tool types, payload helpers, and telemetry wrappers.
 */

import type {
  AgentToolResult,
  ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import type { Static, TSchema } from "@sinclair/typebox";

import { normalizeGitPath } from "../../git";
import {
  recordGitToolFailed,
  recordGitToolStarted,
  recordGitToolSucceeded,
} from "../../runtime-stats";

export type PiGitToolScope = {
  worktreePathContext: string;
};

export type PiGitToolHost = {
  getStatus: (signal?: AbortSignal) => Promise<string>;
};

function coerceBooleanLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return value;
}

function coercePositiveIntegerLikeInput(value: unknown): unknown {
  if (typeof value === "undefined" || value === null) {
    return value;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  if (!/^\d+$/u.test(normalized)) {
    return value;
  }
  return Number.parseInt(normalized, 10);
}

/**
 * Remove one matching outer quote pair from accidental shell-style path input.
 *
 * Structured tool arguments should be passed as raw strings, but model-generated
 * calls occasionally preserve surrounding single or double quotes from example
 * text. Strip only a single matching pair so the worktree path resolver can still
 * enforce its normal escape checks on the unquoted value.
 */
function stripAccidentalOuterQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const quote = value.charAt(0);
  if (quote !== '"' && quote !== "'") {
    return value;
  }

  if (value.charAt(value.length - 1) !== quote) {
    return value;
  }

  return value.slice(1, -1);
}

export function prepareGitToolArguments<TParams extends TSchema>(
  value: unknown,
  booleanKeys: readonly string[],
  integerKeys: readonly string[] = [],
): Static<TParams> {
  if (!value || typeof value !== "object") {
    return value as Static<TParams>;
  }

  const record = { ...(value as Record<string, unknown>) };
  for (const key of booleanKeys) {
    record[key] = coerceBooleanLikeInput(record[key]);
  }
  for (const key of integerKeys) {
    record[key] = coercePositiveIntegerLikeInput(record[key]);
  }
  return record as Static<TParams>;
}

export function normalizeGitPathArgument(
  worktreePath: string,
  value: string,
): string {
  const normalizedPath = normalizeGitPath(
    worktreePath,
    stripAccidentalOuterQuotes(value),
  );
  return normalizedPath.length > 0 ? normalizedPath : ".";
}

export function normalizeGitPathArguments(
  worktreePath: string,
  values: readonly string[],
): string[] {
  return [
    ...new Set(
      values.map((value) => normalizeGitPathArgument(worktreePath, value)),
    ),
  ];
}

export function textToolResult<TDetails>(
  text: string,
  details: TDetails,
): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function withGitToolTelemetry<
  TParameters extends TSchema = TSchema,
  TDetails = Record<string, unknown>,
>(
  tool: ToolDefinition<TParameters, TDetails>,
): ToolDefinition<TParameters, TDetails> {
  const execute = tool.execute;
  return {
    ...tool,
    execute: async (...args: Parameters<typeof execute>) => {
      const token = recordGitToolStarted(tool.name);
      try {
        const result = await execute(...args);
        recordGitToolSucceeded(token);
        return result;
      } catch (error) {
        recordGitToolFailed(token);
        throw error;
      }
    },
  };
}
