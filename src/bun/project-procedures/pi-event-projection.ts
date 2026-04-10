/**
 * @file src/bun/project-procedures/pi-event-projection.ts
 * @description Pi session event projection into Metidos thread-activity writes.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import type { ThreadActivityInput } from "../db";
import { normalizeGitPath } from "../git";
import type { RpcThreadUsage } from "../rpc-schema";
import { normalizeCommandDisplayText } from "./command-normalization";

type CommandActivityPayload = {
  command: string;
  output: string;
  exitCode: number | null;
};

type FileChangeActivityPayload = {
  path: string;
  changeKind: "add" | "delete" | "update";
  diffText: string;
};

type ToolCallActivityPayload = {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
};

type PiToolFileMutationSnapshot = {
  gitPath: string;
  previousContent: string | null;
};

type TrackedPiToolCallState = {
  args: unknown;
  fileMutation: PiToolFileMutationSnapshot | null;
};

export type ProjectedPiActivityWrite = {
  activityId: string;
  force?: boolean;
  inputs: ThreadActivityInput[];
  signature: string;
  terminal?: boolean;
};

export type PiThreadProjectionSnapshot = {
  lastAssistantItemId: string | null;
  lastAssistantText: string;
  usage: RpcThreadUsage | null;
};

type PiThreadEventProjector = {
  project: (event: AgentSessionEvent) => ProjectedPiActivityWrite[];
  snapshot: () => PiThreadProjectionSnapshot;
};

function buildThreadTurnActivityId(startedAt: string, itemId: string): string {
  return `${startedAt}:${itemId}`;
}

function stringifyActivityValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "undefined") {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2) ?? "";
  } catch {
    return String(value);
  }
}

function extractToolCallTextContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((block) => {
      if (!block || typeof block !== "object") {
        return [];
      }
      const candidate = block as { text?: unknown; type?: unknown };
      if (
        candidate.type !== "text" ||
        typeof candidate.text !== "string" ||
        !candidate.text.trim()
      ) {
        return [];
      }
      return [candidate.text];
    })
    .join("\n\n");
}

export function extractPiAssistantMessageText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }

  const candidate = message as {
    content?: string | unknown[];
  };
  if (typeof candidate.content === "string") {
    return candidate.content;
  }
  return extractToolCallTextContent(candidate.content);
}

export function extractPiAssistantUsage(
  message: unknown,
): RpcThreadUsage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const usage = (message as { usage?: Record<string, unknown> }).usage;
  if (!usage) {
    return null;
  }

  const inputTokens =
    typeof usage.input === "number" && Number.isFinite(usage.input)
      ? usage.input
      : null;
  const cachedInputTokens =
    typeof usage.cacheRead === "number" && Number.isFinite(usage.cacheRead)
      ? usage.cacheRead
      : null;
  const outputTokens =
    typeof usage.output === "number" && Number.isFinite(usage.output)
      ? usage.output
      : null;

  if (
    inputTokens === null &&
    cachedInputTokens === null &&
    outputTokens === null
  ) {
    return null;
  }

  return {
    inputTokens: inputTokens ?? 0,
    cachedInputTokens: cachedInputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
  };
}

function buildPiAssistantActivityId(
  startedAt: string,
  message: unknown,
  prefix: string,
): string {
  const timestamp =
    message && typeof message === "object"
      ? (message as { timestamp?: unknown }).timestamp
      : null;
  const suffix =
    typeof timestamp === "number" && Number.isFinite(timestamp)
      ? String(timestamp)
      : prefix;
  return buildThreadTurnActivityId(startedAt, `${prefix}:${suffix}`);
}

function extractPiToolExecutionOutput(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidate = value as {
    content?: unknown;
  };
  return extractToolCallTextContent(candidate.content);
}

function extractPiBashExitCode(output: string): number | null {
  const match = output.match(/Command exited with code (\d+)\s*$/u);
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildAssistantChatActivityInput(
  threadId: number,
  itemId: string,
  text: string,
  state: "in_progress" | "completed" | "failed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "chat",
    role: "assistant",
    text,
    state,
  };
}

function buildReasoningActivityInputText(
  threadId: number,
  itemId: string,
  text: string,
  state: "in_progress" | "completed" | "stopped",
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "reasoning",
    text: text.trim() || "Thinking",
    state,
  };
}

function buildCommandActivityInputPayload(
  threadId: number,
  itemId: string,
  payload: CommandActivityPayload & {
    state: "in_progress" | "completed" | "failed" | "stopped";
  },
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "command",
    text: payload.command,
    state: payload.state,
    payloadJson: JSON.stringify({
      command: payload.command,
      output: payload.output,
      exitCode: payload.exitCode,
    } satisfies CommandActivityPayload),
  };
}

function buildToolCallActivityInputPayload(
  threadId: number,
  itemId: string,
  payload: ToolCallActivityPayload & {
    state: "in_progress" | "completed" | "failed" | "stopped";
  },
): ThreadActivityInput {
  return {
    threadId,
    itemId,
    kind: "tool_call",
    text: `${payload.server}.${payload.tool}`,
    state: payload.state,
    payloadJson: JSON.stringify({
      server: payload.server,
      tool: payload.tool,
      argumentsText: payload.argumentsText,
      output: payload.output,
    } satisfies ToolCallActivityPayload),
  };
}

function buildProjectedWrite(
  activityId: string,
  signature: string,
  inputs: ThreadActivityInput[],
  options?: {
    force?: boolean;
    terminal?: boolean;
  },
): ProjectedPiActivityWrite {
  return {
    activityId,
    inputs,
    signature,
    ...(options?.force === true ? { force: true } : {}),
    ...(options?.terminal === true ? { terminal: true } : {}),
  };
}

export function createPiThreadEventProjector(input: {
  startedAt: string;
  threadId: number;
  worktreePath: string;
}): PiThreadEventProjector {
  const { startedAt, threadId, worktreePath } = input;
  const thinkingTextByActivityId = new Map<string, string>();
  const assistantTextByActivityId = new Map<string, string>();
  const trackedToolCallsByCallId = new Map<string, TrackedPiToolCallState>();

  let lastAssistantItemId: string | null = null;
  let lastAssistantText = "";
  let usage: RpcThreadUsage | null = null;

  function splitDiffLines(value: string): string[] {
    if (!value) {
      return [];
    }
    const lines = value.replace(/\r\n/g, "\n").split("\n");
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }

  function buildSyntheticAddDiff(path: string, content: string): string {
    const lines = splitDiffLines(content);
    const header = ["--- /dev/null", `+++ b/${path}`];
    if (lines.length === 0) {
      return [...header, "@@ -0,0 +1,0 @@"].join("\n");
    }
    return [
      ...header,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join("\n");
  }

  function formatSyntheticUpdateRange(lineCount: number): string {
    return lineCount === 0 ? "0,0" : `1,${lineCount}`;
  }

  function buildSyntheticUpdateDiff(
    path: string,
    previousContent: string,
    nextContent: string,
  ): string {
    if (previousContent === nextContent) {
      return "";
    }

    const previousLines = splitDiffLines(previousContent);
    const nextLines = splitDiffLines(nextContent);
    return [
      `--- a/${path}`,
      `+++ b/${path}`,
      `@@ -${formatSyntheticUpdateRange(previousLines.length)} +${formatSyntheticUpdateRange(nextLines.length)} @@`,
      ...previousLines.map((line) => `-${line}`),
      ...nextLines.map((line) => `+${line}`),
    ].join("\n");
  }

  function extractPiToolPathArg(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidate = value as {
      file_path?: unknown;
      path?: unknown;
    };
    const rawPath =
      typeof candidate.path === "string"
        ? candidate.path
        : typeof candidate.file_path === "string"
          ? candidate.file_path
          : null;
    if (!rawPath) {
      return null;
    }
    return rawPath;
  }

  function extractPiWriteContentArg(value: unknown): string | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidate = value as {
      content?: unknown;
    };
    return typeof candidate.content === "string" ? candidate.content : null;
  }

  function extractPiToolExecutionDiff(value: unknown): string {
    if (!value || typeof value !== "object") {
      return "";
    }

    const details = (value as { details?: Record<string, unknown> }).details;
    return typeof details?.diff === "string" ? details.diff : "";
  }

  function readPiToolFileMutationSnapshot(
    args: unknown,
  ): PiToolFileMutationSnapshot | null {
    const rawPath = extractPiToolPathArg(args);
    if (!rawPath) {
      return null;
    }

    try {
      const gitPath = normalizeGitPath(worktreePath, rawPath);
      const fullPath = resolve(worktreePath, gitPath);
      let previousContent: string | null = null;
      if (existsSync(fullPath)) {
        try {
          previousContent = readFileSync(fullPath, "utf8");
        } catch {
          previousContent = null;
        }
      }
      return {
        gitPath,
        previousContent,
      };
    } catch {
      return null;
    }
  }

  function buildFileChangeActivityInputPayload(
    itemId: string,
    payload: FileChangeActivityPayload & {
      state: "completed";
    },
  ): ThreadActivityInput {
    return {
      threadId,
      itemId,
      kind: "file_change",
      text: payload.path,
      state: payload.state,
      payloadJson: JSON.stringify({
        path: payload.path,
        changeKind: payload.changeKind,
        diffText: payload.diffText,
      } satisfies FileChangeActivityPayload),
    };
  }

  function buildPiFileChangeWrite(input: {
    changeKind: "add" | "delete" | "update";
    diffText: string;
    gitPath: string;
    toolCallId: string;
  }): ProjectedPiActivityWrite | null {
    const normalizedDiffText = input.diffText.trim();
    if (!normalizedDiffText) {
      return null;
    }

    const activityItemId = buildThreadTurnActivityId(
      startedAt,
      `file:${input.toolCallId}:${input.gitPath}`,
    );
    return buildProjectedWrite(
      activityItemId,
      `completed\u0000${input.changeKind}\u0000${input.gitPath}\u0000${normalizedDiffText}`,
      [
        buildFileChangeActivityInputPayload(activityItemId, {
          changeKind: input.changeKind,
          diffText: normalizedDiffText,
          path: input.gitPath,
          state: "completed",
        }),
      ],
      {
        force: true,
        terminal: true,
      },
    );
  }

  function buildPiToolFileChangeWrite(input: {
    result: unknown;
    toolCallId: string;
    toolName: string;
    trackedToolCallState: TrackedPiToolCallState | null;
  }): ProjectedPiActivityWrite | null {
    const toolArgs = input.trackedToolCallState?.args ?? null;
    const fileMutation = input.trackedToolCallState?.fileMutation ?? null;
    const fallbackRawPath = extractPiToolPathArg(toolArgs);
    let gitPath = fileMutation?.gitPath ?? null;
    if (gitPath === null && fallbackRawPath) {
      try {
        gitPath = normalizeGitPath(worktreePath, fallbackRawPath);
      } catch {
        return null;
      }
    }
    if (!gitPath) {
      return null;
    }

    if (input.toolName === "edit") {
      return buildPiFileChangeWrite({
        changeKind: "update",
        diffText: extractPiToolExecutionDiff(input.result),
        gitPath,
        toolCallId: input.toolCallId,
      });
    }

    if (input.toolName !== "write") {
      return null;
    }

    const nextContent = extractPiWriteContentArg(toolArgs);
    if (nextContent === null) {
      return null;
    }

    const previousContent = fileMutation?.previousContent ?? null;
    return buildPiFileChangeWrite({
      changeKind: previousContent === null ? "add" : "update",
      diffText:
        previousContent === null
          ? buildSyntheticAddDiff(gitPath, nextContent)
          : buildSyntheticUpdateDiff(gitPath, previousContent, nextContent),
      gitPath,
      toolCallId: input.toolCallId,
    });
  }

  function upsertTrackedPiToolCallState(
    toolCallId: string,
    toolName: string,
    args: unknown,
  ): TrackedPiToolCallState {
    const existing = trackedToolCallsByCallId.get(toolCallId);
    const nextState: TrackedPiToolCallState = existing ?? {
      args,
      fileMutation:
        toolName === "edit" || toolName === "write"
          ? readPiToolFileMutationSnapshot(args)
          : null,
    };
    nextState.args = args;
    trackedToolCallsByCallId.set(toolCallId, nextState);
    return nextState;
  }

  return {
    project: (event) => {
      if (
        event.type === "message_update" &&
        (event.message as { role?: unknown }).role === "assistant"
      ) {
        const assistantActivityId = buildPiAssistantActivityId(
          startedAt,
          event.message,
          "assistant",
        );
        const reasoningActivityId = buildPiAssistantActivityId(
          startedAt,
          event.message,
          "reasoning",
        );

        if (event.assistantMessageEvent.type === "thinking_delta") {
          const nextThinkingText = `${
            thinkingTextByActivityId.get(reasoningActivityId) ?? ""
          }${event.assistantMessageEvent.delta ?? ""}`;
          thinkingTextByActivityId.set(reasoningActivityId, nextThinkingText);
          const persistedThinkingText = nextThinkingText.trim();
          if (!persistedThinkingText) {
            return [];
          }

          return [
            buildProjectedWrite(
              reasoningActivityId,
              `in_progress\u0000${persistedThinkingText}`,
              [
                buildReasoningActivityInputText(
                  threadId,
                  reasoningActivityId,
                  persistedThinkingText,
                  "in_progress",
                ),
              ],
            ),
          ];
        }

        if (event.assistantMessageEvent.type === "text_delta") {
          const nextAssistantText = `${
            assistantTextByActivityId.get(assistantActivityId) ?? ""
          }${event.assistantMessageEvent.delta ?? ""}`;
          assistantTextByActivityId.set(assistantActivityId, nextAssistantText);
          const persistedAssistantText = nextAssistantText.trim();
          if (!persistedAssistantText) {
            return [];
          }

          lastAssistantText = persistedAssistantText;
          lastAssistantItemId = assistantActivityId;
          return [
            buildProjectedWrite(
              assistantActivityId,
              `in_progress\u0000${persistedAssistantText}`,
              [
                buildAssistantChatActivityInput(
                  threadId,
                  assistantActivityId,
                  persistedAssistantText,
                  "in_progress",
                ),
              ],
            ),
          ];
        }

        return [];
      }

      if (
        event.type === "message_end" &&
        (event.message as { role?: unknown }).role === "assistant"
      ) {
        const writes: ProjectedPiActivityWrite[] = [];
        const assistantActivityId = buildPiAssistantActivityId(
          startedAt,
          event.message,
          "assistant",
        );
        const finalAssistantText = (
          extractPiAssistantMessageText(event.message).trim() ||
          assistantTextByActivityId.get(assistantActivityId) ||
          ""
        ).trim();
        if (finalAssistantText) {
          assistantTextByActivityId.set(
            assistantActivityId,
            finalAssistantText,
          );
          lastAssistantText = finalAssistantText;
          lastAssistantItemId = assistantActivityId;
          writes.push(
            buildProjectedWrite(
              assistantActivityId,
              `completed\u0000${finalAssistantText}`,
              [
                buildAssistantChatActivityInput(
                  threadId,
                  assistantActivityId,
                  finalAssistantText,
                  "completed",
                ),
              ],
              {
                force: true,
                terminal: true,
              },
            ),
          );
        }

        const reasoningActivityId = buildPiAssistantActivityId(
          startedAt,
          event.message,
          "reasoning",
        );
        const finalThinkingText = (
          thinkingTextByActivityId.get(reasoningActivityId) ?? ""
        ).trim();
        if (finalThinkingText) {
          writes.push(
            buildProjectedWrite(
              reasoningActivityId,
              `completed\u0000${finalThinkingText}`,
              [
                buildReasoningActivityInputText(
                  threadId,
                  reasoningActivityId,
                  finalThinkingText,
                  "completed",
                ),
              ],
              {
                force: true,
                terminal: true,
              },
            ),
          );
        }

        usage = extractPiAssistantUsage(event.message) ?? usage;
        return writes;
      }

      if (event.type === "tool_execution_start") {
        upsertTrackedPiToolCallState(
          event.toolCallId,
          event.toolName,
          event.args,
        );
        const activityItemId = buildThreadTurnActivityId(
          startedAt,
          `tool:${event.toolCallId}`,
        );
        if (event.toolName === "bash") {
          const command = normalizeCommandDisplayText(
            typeof event.args?.command === "string"
              ? event.args.command
              : "bash",
          );
          return [
            buildProjectedWrite(activityItemId, `in_progress\u0000${command}`, [
              buildCommandActivityInputPayload(threadId, activityItemId, {
                command,
                exitCode: null,
                output: "",
                state: "in_progress",
              }),
            ]),
          ];
        }

        return [
          buildProjectedWrite(
            activityItemId,
            `in_progress\u0000${event.toolName}`,
            [
              buildToolCallActivityInputPayload(threadId, activityItemId, {
                server: "pi",
                tool: event.toolName,
                argumentsText: stringifyActivityValue(event.args),
                output: "",
                state: "in_progress",
              }),
            ],
          ),
        ];
      }

      if (event.type === "tool_execution_update") {
        upsertTrackedPiToolCallState(
          event.toolCallId,
          event.toolName,
          event.args,
        );
        const activityItemId = buildThreadTurnActivityId(
          startedAt,
          `tool:${event.toolCallId}`,
        );
        const output = extractPiToolExecutionOutput(event.partialResult);
        if (event.toolName === "bash") {
          const command = normalizeCommandDisplayText(
            typeof event.args?.command === "string"
              ? event.args.command
              : "bash",
          );
          return [
            buildProjectedWrite(
              activityItemId,
              `in_progress\u0000${command}\u0000${output}`,
              [
                buildCommandActivityInputPayload(threadId, activityItemId, {
                  command,
                  exitCode: null,
                  output,
                  state: "in_progress",
                }),
              ],
            ),
          ];
        }

        return [
          buildProjectedWrite(
            activityItemId,
            `in_progress\u0000${event.toolName}\u0000${output}`,
            [
              buildToolCallActivityInputPayload(threadId, activityItemId, {
                server: "pi",
                tool: event.toolName,
                argumentsText: stringifyActivityValue(event.args),
                output,
                state: "in_progress",
              }),
            ],
          ),
        ];
      }

      if (event.type === "tool_execution_end") {
        const trackedToolCallState =
          trackedToolCallsByCallId.get(event.toolCallId) ?? null;
        const toolArgs = trackedToolCallState?.args;
        trackedToolCallsByCallId.delete(event.toolCallId);
        const activityItemId = buildThreadTurnActivityId(
          startedAt,
          `tool:${event.toolCallId}`,
        );
        const output = extractPiToolExecutionOutput(event.result);
        const state = event.isError ? "failed" : "completed";
        if (event.toolName === "bash") {
          const command = normalizeCommandDisplayText(
            typeof (toolArgs as { command?: unknown } | undefined)?.command ===
              "string"
              ? String((toolArgs as { command?: unknown }).command)
              : "bash",
          );
          return [
            buildProjectedWrite(
              activityItemId,
              `${state}\u0000${command}\u0000${output}`,
              [
                buildCommandActivityInputPayload(threadId, activityItemId, {
                  command,
                  exitCode: extractPiBashExitCode(output),
                  output,
                  state,
                }),
              ],
              {
                force: true,
                terminal: true,
              },
            ),
          ];
        }

        const writes = [
          buildProjectedWrite(
            activityItemId,
            `${state}\u0000${event.toolName}\u0000${output}`,
            [
              buildToolCallActivityInputPayload(threadId, activityItemId, {
                server: "pi",
                tool: event.toolName,
                argumentsText: stringifyActivityValue(toolArgs),
                output,
                state,
              }),
            ],
            {
              force: true,
              terminal: true,
            },
          ),
        ];
        if (!event.isError) {
          const fileChangeWrite = buildPiToolFileChangeWrite({
            result: event.result,
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            trackedToolCallState,
          });
          if (fileChangeWrite) {
            writes.push(fileChangeWrite);
          }
        }

        return writes;
      }

      return [];
    },
    snapshot: () => ({
      lastAssistantItemId,
      lastAssistantText,
      usage,
    }),
  };
}
