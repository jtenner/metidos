/**
 * @file src/bun/project-procedures/pi-event-projection.test.ts
 * @description Test file for Pi event projection helpers.
 */

import { describe, expect, it } from "bun:test";
import type { AgentSessionEvent } from "@mariozechner/pi-coding-agent";

import { createPiThreadEventProjector } from "./pi-event-projection";

const STARTED_AT = "2026-04-09T12:00:00.000Z";
const THREAD_ID = 17;

describe("createPiThreadEventProjector", () => {
  it("projects assistant thinking and text deltas into reasoning/chat activity writes", () => {
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
    });

    const thinkingWrites = projector.project({
      assistantMessageEvent: {
        delta: "Plan first. ",
        type: "thinking_delta",
      },
      message: {
        role: "assistant",
        timestamp: 101,
      },
      type: "message_update",
    } as AgentSessionEvent);
    const textWrites = projector.project({
      assistantMessageEvent: {
        delta: "Answer draft. ",
        type: "text_delta",
      },
      message: {
        role: "assistant",
        timestamp: 101,
      },
      type: "message_update",
    } as AgentSessionEvent);
    const completionWrites = projector.project({
      message: {
        content: [{ text: "Answer complete.", type: "text" }],
        role: "assistant",
        timestamp: 101,
        usage: {
          cacheRead: 9,
          input: 11,
          output: 7,
        },
      },
      type: "message_end",
    } as AgentSessionEvent);

    expect(thinkingWrites).toEqual([
      {
        activityId: `${STARTED_AT}:reasoning:101`,
        inputs: [
          expect.objectContaining({
            itemId: `${STARTED_AT}:reasoning:101`,
            kind: "reasoning",
            state: "in_progress",
            text: "Plan first.",
            threadId: THREAD_ID,
          }),
        ],
        signature: "in_progress\u0000Plan first.",
      },
    ]);
    expect(textWrites).toEqual([
      {
        activityId: `${STARTED_AT}:assistant:101`,
        inputs: [
          expect.objectContaining({
            itemId: `${STARTED_AT}:assistant:101`,
            kind: "chat",
            role: "assistant",
            state: "in_progress",
            text: "Answer draft.",
            threadId: THREAD_ID,
          }),
        ],
        signature: "in_progress\u0000Answer draft.",
      },
    ]);
    expect(completionWrites).toEqual([
      {
        activityId: `${STARTED_AT}:assistant:101`,
        force: true,
        inputs: [
          expect.objectContaining({
            itemId: `${STARTED_AT}:assistant:101`,
            kind: "chat",
            role: "assistant",
            state: "completed",
            text: "Answer complete.",
            threadId: THREAD_ID,
          }),
        ],
        signature: "completed\u0000Answer complete.",
        terminal: true,
      },
      {
        activityId: `${STARTED_AT}:reasoning:101`,
        force: true,
        inputs: [
          expect.objectContaining({
            itemId: `${STARTED_AT}:reasoning:101`,
            kind: "reasoning",
            state: "completed",
            text: "Plan first.",
            threadId: THREAD_ID,
          }),
        ],
        signature: "completed\u0000Plan first.",
        terminal: true,
      },
    ]);
    expect(projector.snapshot()).toEqual({
      lastAssistantItemId: `${STARTED_AT}:assistant:101`,
      lastAssistantText: "Answer complete.",
      usage: {
        cachedInputTokens: 9,
        inputTokens: 11,
        outputTokens: 7,
      },
    });
  });

  it("maps bash lifecycle events to command rows and other tools to generic tool-call rows", () => {
    const projector = createPiThreadEventProjector({
      startedAt: STARTED_AT,
      threadId: THREAD_ID,
    });

    const bashStart = projector.project({
      args: {
        command: 'bash -lc "printf \\"hi\\""',
      },
      toolCallId: "bash-1",
      toolName: "bash",
      type: "tool_execution_start",
    } as AgentSessionEvent);
    const bashEnd = projector.project({
      isError: true,
      result: {
        content: [
          {
            text: "stderr line\nCommand exited with code 2",
            type: "text",
          },
        ],
      },
      toolCallId: "bash-1",
      toolName: "bash",
      type: "tool_execution_end",
    } as AgentSessionEvent);
    const writeUpdate = projector.project({
      args: {
        path: "README.md",
        text: "updated",
      },
      partialResult: {
        content: [
          {
            text: "Wrote README.md",
            type: "text",
          },
        ],
      },
      toolCallId: "write-1",
      toolName: "write",
      type: "tool_execution_update",
    } as AgentSessionEvent);
    const writeEnd = projector.project({
      isError: false,
      result: {
        content: [
          {
            text: "Write complete",
            type: "text",
          },
        ],
      },
      toolCallId: "write-1",
      toolName: "write",
      type: "tool_execution_end",
    } as AgentSessionEvent);

    expect(bashStart[0]?.activityId).toBe(`${STARTED_AT}:tool:bash-1`);
    expect(bashStart[0]?.signature).toBe('in_progress\u0000printf "hi"');
    expect(
      JSON.parse(String(bashStart[0]?.inputs[0]?.payloadJson ?? "null")),
    ).toEqual({
      command: 'printf "hi"',
      exitCode: null,
      output: "",
    });

    expect(bashEnd[0]).toEqual(
      expect.objectContaining({
        activityId: `${STARTED_AT}:tool:bash-1`,
        force: true,
        signature:
          'failed\u0000printf "hi"\u0000stderr line\nCommand exited with code 2',
        terminal: true,
      }),
    );
    expect(
      JSON.parse(String(bashEnd[0]?.inputs[0]?.payloadJson ?? "null")),
    ).toEqual({
      command: 'printf "hi"',
      exitCode: 2,
      output: "stderr line\nCommand exited with code 2",
    });

    expect(writeUpdate[0]).toEqual(
      expect.objectContaining({
        activityId: `${STARTED_AT}:tool:write-1`,
        signature: "in_progress\u0000write\u0000Wrote README.md",
      }),
    );
    expect(
      JSON.parse(String(writeUpdate[0]?.inputs[0]?.payloadJson ?? "null")),
    ).toEqual({
      argumentsText: '{\n  "path": "README.md",\n  "text": "updated"\n}',
      output: "Wrote README.md",
      server: "pi",
      tool: "write",
    });

    expect(writeEnd[0]).toEqual(
      expect.objectContaining({
        activityId: `${STARTED_AT}:tool:write-1`,
        force: true,
        signature: "completed\u0000write\u0000Write complete",
        terminal: true,
      }),
    );
    expect(
      JSON.parse(String(writeEnd[0]?.inputs[0]?.payloadJson ?? "null")),
    ).toEqual({
      argumentsText: '{\n  "path": "README.md",\n  "text": "updated"\n}',
      output: "Write complete",
      server: "pi",
      tool: "write",
    });
  });
});
