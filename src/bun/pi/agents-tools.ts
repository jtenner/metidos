/**
 * @file src/bun/pi/agents-tools.ts
 * @description Pi-native plan and bounded delegation tools for the Metidos runtime.
 */

import {
  type AgentToolResult,
  defineTool,
  type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const PI_AGENT_PLAN_STATUS_VALUES = [
  "pending",
  "in_progress",
  "completed",
] as const;
const PI_AGENT_THINKING_LEVEL_VALUES = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type PiAgentPlanStatus = (typeof PI_AGENT_PLAN_STATUS_VALUES)[number];
export type PiAgentThinkingLevel =
  (typeof PI_AGENT_THINKING_LEVEL_VALUES)[number];
export type PiAgentPlanItem = {
  status: PiAgentPlanStatus;
  step: string;
};

export type PiAgentPlanState = {
  explanation: string | null;
  plan: PiAgentPlanItem[];
  revision: number;
  threadId: number;
  updatedAt: string;
};

export type PiDelegatedTaskRequest = {
  model: string | null;
  reasoningEffort: PiAgentThinkingLevel | null;
  task: string;
};

export type PiDelegatedTaskRun = {
  activeToolNames: string[];
  model: string;
  outputText: string;
  reasoningEffort: PiAgentThinkingLevel;
  sessionId: string | null;
};

export type PiAgentsToolScope = {
  reasoningEffortContext: PiAgentThinkingLevel;
  threadIdContext: number;
};

export type PiAgentsToolHost = {
  runDelegatedTask: (
    request: PiDelegatedTaskRequest,
    signal?: AbortSignal,
    onUpdate?: (partial: PiDelegatedTaskRun) => void,
  ) => Promise<PiDelegatedTaskRun>;
};

const PlanStatus = Type.Union(
  PI_AGENT_PLAN_STATUS_VALUES.map((value) => Type.Literal(value)),
);
const ThinkingLevel = Type.Union(
  PI_AGENT_THINKING_LEVEL_VALUES.map((value) => Type.Literal(value)),
);
const PlanItem = Type.Object({
  status: PlanStatus,
  step: Type.String({
    description: "Concrete step text.",
    minLength: 1,
  }),
});
const UpdatePlanToolParameters = Type.Object({
  explanation: Type.Optional(
    Type.Union([
      Type.String({
        description:
          "Optional short note explaining why the plan changed or what is happening now.",
      }),
      Type.Null(),
    ]),
  ),
  plan: Type.Array(PlanItem, {
    description:
      "Ordered plan items. Exactly zero or one item may be in_progress.",
    minItems: 1,
  }),
});
const DelegateTaskToolParameters = Type.Object({
  model: Type.Optional(
    Type.String({
      description:
        "Optional provider-qualified model id for the delegated helper. Defaults to the current thread model.",
      minLength: 1,
    }),
  ),
  reasoningEffort: Type.Optional(ThinkingLevel),
  task: Type.String({
    description:
      "Bounded task for the delegated helper. Include the exact deliverable you want back.",
    minLength: 1,
  }),
});

function textToolResult<TDetails>(
  text: string,
  details: TDetails,
): AgentToolResult<TDetails> {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
    details,
  };
}

function trimNullableString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePlanItems(input: PiAgentPlanItem[]): PiAgentPlanItem[] {
  const normalized = input.map((item) => {
    const step = item.step.trim();
    if (!step) {
      throw new Error("Plan steps must not be empty.");
    }
    return {
      status: item.status,
      step,
    } satisfies PiAgentPlanItem;
  });
  const inProgressCount = normalized.filter(
    (item) => item.status === "in_progress",
  ).length;
  if (inProgressCount > 1) {
    throw new Error("At most one plan item may be in_progress.");
  }
  return normalized;
}

function formatPlanStatus(status: PiAgentPlanStatus): string {
  switch (status) {
    case "in_progress":
      return "in progress";
    default:
      return status;
  }
}

function formatPlanState(state: PiAgentPlanState): string {
  const lines = [
    `Plan updated for thread ${state.threadId}. Revision ${state.revision}.`,
  ];
  if (state.explanation) {
    lines.push(`Explanation: ${state.explanation}`);
  }
  lines.push(
    ...state.plan.map(
      (item, index) =>
        `${index + 1}. [${formatPlanStatus(item.status)}] ${item.step}`,
    ),
  );
  return lines.join("\n");
}

function formatDelegatedTaskText(result: PiDelegatedTaskRun): string {
  const lines = [
    `Delegated task completed with ${result.model} (${result.reasoningEffort}).`,
  ];
  const outputText = result.outputText.trim();
  lines.push(
    outputText || "The delegated helper did not return assistant text.",
  );
  return lines.join("\n\n");
}

export function createPiAgentsTools(
  scope: PiAgentsToolScope,
  host: PiAgentsToolHost,
): ToolDefinition[] {
  let latestPlan: PiAgentPlanState | null = null;

  return [
    defineTool({
      description:
        "Persist the current execution plan for this thread. Use short ordered steps and keep at most one step in progress.",
      execute: async (_toolCallId, params) => {
        const normalizedPlan = normalizePlanItems(params.plan);
        const nextPlan: PiAgentPlanState = {
          explanation: trimNullableString(params.explanation) ?? null,
          plan: normalizedPlan,
          revision: (latestPlan?.revision ?? 0) + 1,
          threadId: scope.threadIdContext,
          updatedAt: new Date().toISOString(),
        };
        latestPlan = nextPlan;
        return textToolResult(formatPlanState(nextPlan), nextPlan);
      },
      label: "Update Plan",
      name: "update_plan",
      parameters: UpdatePlanToolParameters,
      promptGuidelines: [
        "Use this when the task needs a visible multi-step plan or when the current plan materially changes.",
      ],
      promptSnippet: "Record or revise the current execution plan",
    }),
    defineTool({
      description:
        "Delegate a bounded subtask to an isolated one-shot helper agent that inherits the current thread's workspace, model access, and safety policy. This is not a persistent child-agent lifecycle.",
      execute: async (_toolCallId, params, signal, onUpdate) => {
        const task = params.task.trim();
        if (!task) {
          throw new Error("Task is required.");
        }
        const delegated = await host.runDelegatedTask(
          {
            model: trimNullableString(params.model) ?? null,
            reasoningEffort:
              params.reasoningEffort ?? scope.reasoningEffortContext,
            task,
          },
          signal,
          (partial) => {
            onUpdate?.({
              content: [
                {
                  type: "text",
                  text:
                    partial.outputText.trim() ||
                    "Delegated helper is still running.",
                },
              ],
              details: partial,
            });
          },
        );
        return textToolResult(formatDelegatedTaskText(delegated), delegated);
      },
      label: "Delegate Task",
      name: "delegate_task",
      parameters: DelegateTaskToolParameters,
      promptGuidelines: [
        "Use this only for bounded sidecar work that can be completed independently and summarized back into the current thread.",
        "Do not treat this as a persistent sub-agent. There is no send_input, wait_agent, resume_agent, or close_agent follow-up workflow.",
      ],
      promptSnippet: "Delegate a bounded task to an isolated helper agent",
    }),
  ];
}

export function defaultPiAgentThinkingLevel(
  reasoningEffort: string | null | undefined,
): PiAgentThinkingLevel {
  switch (reasoningEffort) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return reasoningEffort;
    default:
      return "off";
  }
}
