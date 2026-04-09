import { describe, expect, it } from "bun:test";

import {
  createPiAgentsTools,
  defaultPiAgentThinkingLevel,
  type PiAgentsToolHost,
  type PiAgentsToolScope,
} from "./pi-agents-tools";

function createScope(
  overrides: Partial<PiAgentsToolScope> = {},
): PiAgentsToolScope {
  return {
    reasoningEffortContext: "medium",
    threadIdContext: 11,
    ...overrides,
  };
}

function createHost(
  overrides: Partial<PiAgentsToolHost> = {},
): PiAgentsToolHost {
  return {
    runDelegatedTask: async (_request, _signal, _onUpdate) => ({
      activeToolNames: ["read", "ls", "find"],
      model: "openai:gpt-5.4",
      outputText: "Delegated result.",
      reasoningEffort: "medium",
      sessionId: "subagent-1",
    }),
    ...overrides,
  };
}

function getTool(
  scope: PiAgentsToolScope,
  host: PiAgentsToolHost,
  name: string,
) {
  const tool = createPiAgentsTools(scope, host).find(
    (entry) => entry.name === name,
  );
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

async function executeTool(
  scope: PiAgentsToolScope,
  host: PiAgentsToolHost,
  name: string,
  rawArgs: unknown,
) {
  const tool = getTool(scope, host, name);
  const args = tool.prepareArguments ? tool.prepareArguments(rawArgs) : rawArgs;
  return tool.execute("call-1", args as never, undefined, async () => {}, {
    cwd: "/repo/alpha",
  } as never);
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
  const firstContent = result.content[0];
  if (!firstContent || firstContent.type !== "text") {
    throw new Error("Expected a text tool result.");
  }
  return firstContent.text;
}

describe("createPiAgentsTools", () => {
  it("stores plan state and increments revisions", async () => {
    const scope = createScope();
    const host = createHost();
    const tool = getTool(scope, host, "update_plan");

    const firstResult = await tool.execute(
      "call-1",
      {
        explanation: "Working through the migration.",
        plan: [
          { status: "completed", step: "Inspect runtime." },
          { status: "in_progress", step: "Implement agent tools." },
        ],
      },
      undefined,
      async () => {},
      {
        cwd: "/repo/alpha",
      } as never,
    );
    const secondResult = await tool.execute(
      "call-2",
      {
        plan: [
          { status: "completed", step: "Inspect runtime." },
          { status: "completed", step: "Implement agent tools." },
          { status: "pending", step: "Document the slice." },
        ],
      },
      undefined,
      async () => {},
      {
        cwd: "/repo/alpha",
      } as never,
    );

    expect(resultText(firstResult)).toContain("Revision 1");
    expect(firstResult.details).toEqual({
      explanation: "Working through the migration.",
      plan: [
        { status: "completed", step: "Inspect runtime." },
        { status: "in_progress", step: "Implement agent tools." },
      ],
      revision: 1,
      threadId: 11,
      updatedAt: expect.any(String),
    });
    expect(resultText(secondResult)).toContain("Revision 2");
    expect(secondResult.details).toEqual({
      explanation: null,
      plan: [
        { status: "completed", step: "Inspect runtime." },
        { status: "completed", step: "Implement agent tools." },
        { status: "pending", step: "Document the slice." },
      ],
      revision: 2,
      threadId: 11,
      updatedAt: expect.any(String),
    });
  });

  it("rejects invalid plan state with multiple in-progress items", async () => {
    const scope = createScope();
    const host = createHost();
    const tool = getTool(scope, host, "update_plan");

    await expect(
      tool.execute(
        "call-1",
        {
          plan: [
            { status: "in_progress", step: "First" },
            { status: "in_progress", step: "Second" },
          ],
        },
        undefined,
        async () => {},
        {
          cwd: "/repo/alpha",
        } as never,
      ),
    ).rejects.toThrow("At most one plan item may be in_progress.");
  });

  it("delegates a bounded task with default model settings and streams partial updates", async () => {
    const scope = createScope();
    const partialUpdates: unknown[] = [];
    let receivedRequest: Record<string, unknown> | null = null;
    const host = createHost({
      runDelegatedTask: async (request, _signal, onUpdate) => {
        receivedRequest = request;
        onUpdate?.({
          activeToolNames: ["read"],
          model: "openai:gpt-5.4",
          outputText: "Partial delegated output.",
          reasoningEffort: "medium",
          sessionId: "subagent-1",
        });
        return {
          activeToolNames: ["read", "ls"],
          model: "openai:gpt-5.4",
          outputText: "Final delegated output.",
          reasoningEffort: "medium",
          sessionId: "subagent-1",
        };
      },
    });
    const tool = getTool(scope, host, "delegate_task");

    const result = await tool.execute(
      "call-1",
      {
        task: " Inspect the runtime adapter ",
      },
      undefined,
      async (partial) => {
        partialUpdates.push(partial);
      },
      {
        cwd: "/repo/alpha",
      } as never,
    );

    expect(receivedRequest).not.toBeNull();
    if (!receivedRequest) {
      throw new Error("Expected delegated request to be captured.");
    }
    expect(receivedRequest as unknown).toEqual({
      model: null,
      reasoningEffort: "medium",
      task: "Inspect the runtime adapter",
    });
    expect(partialUpdates).toHaveLength(1);
    expect(partialUpdates[0]).toEqual({
      content: [
        {
          type: "text",
          text: "Partial delegated output.",
        },
      ],
      details: {
        activeToolNames: ["read"],
        model: "openai:gpt-5.4",
        outputText: "Partial delegated output.",
        reasoningEffort: "medium",
        sessionId: "subagent-1",
      },
    });
    expect(result.details).toEqual({
      activeToolNames: ["read", "ls"],
      model: "openai:gpt-5.4",
      outputText: "Final delegated output.",
      reasoningEffort: "medium",
      sessionId: "subagent-1",
    });
    expect(resultText(result)).toContain(
      "Delegated task completed with openai:gpt-5.4 (medium).",
    );
    expect(resultText(result)).toContain("Final delegated output.");
  });
});

describe("defaultPiAgentThinkingLevel", () => {
  it("normalizes unsupported values to off", () => {
    expect(defaultPiAgentThinkingLevel("high")).toBe("high");
    expect(defaultPiAgentThinkingLevel("invalid")).toBe("off");
    expect(defaultPiAgentThinkingLevel(null)).toBe("off");
  });
});
