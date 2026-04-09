/**
 * @file src/bun/project-procedures/pi-event-projection.ts
 * @description Pi session event projection into Jolt thread-activity writes.
 */

import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import type { ThreadActivityInput } from "../db";
import type { RpcThreadUsage } from "../rpc-schema";
import { normalizeCommandDisplayText } from "./command-normalization";

type CommandActivityPayload = {
  command: string;
  output: string;
  exitCode: number | null;
};

type ToolCallActivityPayload = {
  server: string;
  tool: string;
  argumentsText: string;
  output: string;
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
}): PiThreadEventProjector {
  const { startedAt, threadId } = input;
  const thinkingTextByActivityId = new Map<string, string>();
  const assistantTextByActivityId = new Map<string, string>();
  const toolArgsByCallId = new Map<string, unknown>();

  let lastAssistantItemId: string | null = null;
  let lastAssistantText = "";
  let usage: RpcThreadUsage | null = null;

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
        toolArgsByCallId.set(event.toolCallId, event.args);
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
        toolArgsByCallId.set(event.toolCallId, event.args);
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
        const toolArgs = toolArgsByCallId.get(event.toolCallId);
        toolArgsByCallId.delete(event.toolCallId);
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

        return [
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
