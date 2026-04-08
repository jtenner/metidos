/**
 * @file src/bun/project-procedures/codex-session-telemetry.ts
 * @description Reads Codex CLI session telemetry for live context usage data.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RpcThread, RpcThreadUsage } from "../rpc-schema";

type JsonRecord = Record<string, unknown>;

export type CodexSessionUsageTelemetry = {
  contextWindowTokens: number | null;
  usage: RpcThreadUsage | null;
};

type SessionTelemetryCacheEntry = {
  mtimeMs: number;
  size: number;
  telemetry: CodexSessionUsageTelemetry | null;
};

const codexSessionPathCache = new Map<string, string>();
const codexSessionTelemetryCache = new Map<
  string,
  SessionTelemetryCacheEntry
>();

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function readFiniteNumber(record: JsonRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveCodexSessionsDirectory(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return join(codexHome ? codexHome : join(homedir(), ".codex"), "sessions");
}

function findCodexSessionFilePath(codexThreadId: string): string | null {
  const cachedPath = codexSessionPathCache.get(codexThreadId);
  if (cachedPath && existsSync(cachedPath)) {
    return cachedPath;
  }

  const sessionsDirectory = resolveCodexSessionsDirectory();
  if (!existsSync(sessionsDirectory)) {
    return null;
  }

  const expectedSuffix = `${codexThreadId}.jsonl`;
  const pendingDirectories = [sessionsDirectory];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory, {
      withFileTypes: true,
    })) {
      const entryPath = join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(expectedSuffix)) {
        codexSessionPathCache.set(codexThreadId, entryPath);
        return entryPath;
      }
    }
  }

  return null;
}

export function parseCodexSessionUsageTelemetry(
  jsonlText: string,
): CodexSessionUsageTelemetry | null {
  let contextWindowTokens: number | null = null;
  let usage: RpcThreadUsage | null = null;

  for (const line of jsonlText.split(/\r?\n/u)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmedLine);
    } catch {
      continue;
    }

    if (!isJsonRecord(parsed) || parsed.type !== "event_msg") {
      continue;
    }

    const payload = parsed.payload;
    if (!isJsonRecord(payload) || typeof payload.type !== "string") {
      continue;
    }

    if (payload.type === "task_started") {
      contextWindowTokens =
        readFiniteNumber(payload, "model_context_window") ??
        contextWindowTokens;
      continue;
    }

    if (payload.type !== "token_count") {
      continue;
    }

    const info = payload.info;
    if (!isJsonRecord(info)) {
      continue;
    }

    contextWindowTokens =
      readFiniteNumber(info, "model_context_window") ?? contextWindowTokens;

    const lastTokenUsage = info.last_token_usage;
    if (!isJsonRecord(lastTokenUsage)) {
      continue;
    }

    usage = {
      inputTokens: readFiniteNumber(lastTokenUsage, "input_tokens") ?? 0,
      cachedInputTokens:
        readFiniteNumber(lastTokenUsage, "cached_input_tokens") ?? 0,
      outputTokens: readFiniteNumber(lastTokenUsage, "output_tokens") ?? 0,
      ...(contextWindowTokens === null ? {} : { contextWindowTokens }),
    };
  }

  if (usage !== null) {
    return {
      contextWindowTokens,
      usage,
    };
  }

  if (contextWindowTokens === null) {
    return null;
  }

  return {
    contextWindowTokens,
    usage: null,
  };
}

export function readCodexSessionUsageTelemetry(
  codexThreadId: string | null | undefined,
): CodexSessionUsageTelemetry | null {
  const normalizedThreadId = codexThreadId?.trim();
  if (!normalizedThreadId) {
    return null;
  }

  const sessionFilePath = findCodexSessionFilePath(normalizedThreadId);
  if (!sessionFilePath || !existsSync(sessionFilePath)) {
    return null;
  }

  const sessionFileStat = statSync(sessionFilePath);
  const cachedTelemetry = codexSessionTelemetryCache.get(sessionFilePath);
  if (
    cachedTelemetry &&
    cachedTelemetry.size === sessionFileStat.size &&
    cachedTelemetry.mtimeMs === sessionFileStat.mtimeMs
  ) {
    return cachedTelemetry.telemetry;
  }

  const telemetry = parseCodexSessionUsageTelemetry(
    readFileSync(sessionFilePath, "utf8"),
  );
  codexSessionTelemetryCache.set(sessionFilePath, {
    mtimeMs: sessionFileStat.mtimeMs,
    size: sessionFileStat.size,
    telemetry,
  });
  return telemetry;
}

export function applyCodexSessionUsageTelemetry(thread: RpcThread): RpcThread {
  const telemetry = readCodexSessionUsageTelemetry(thread.codexThreadId);
  if (!telemetry) {
    return thread;
  }

  const nextUsage =
    telemetry.usage !== null
      ? telemetry.usage
      : telemetry.contextWindowTokens !== null
        ? {
            inputTokens: thread.usage?.inputTokens ?? 0,
            cachedInputTokens: thread.usage?.cachedInputTokens ?? 0,
            outputTokens: thread.usage?.outputTokens ?? 0,
            contextWindowTokens: telemetry.contextWindowTokens,
          }
        : thread.usage;

  if (nextUsage === thread.usage) {
    return thread;
  }

  return {
    ...thread,
    usage: nextUsage,
  };
}

export function clearCodexSessionTelemetryCache(): void {
  codexSessionPathCache.clear();
  codexSessionTelemetryCache.clear();
}
