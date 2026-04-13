/**
 * @file src/bun/pi-metidos-tools-sandbox.ts
 * @description Pi-native Metidos sandbox tool definitions.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./pi-metidos-tools-shared";
import { recordMetidosSandboxRun } from "./runtime-stats";
import {
  formatVm2ExecutionReportText,
  runUntrustedJavaScriptInVm2,
} from "./vm2-runner";

export function createPiMetidosSandboxTools(
  scope: PiMetidosToolScope,
): ToolDefinition[] {
  return [
    withMetidosToolTelemetry(
      defineTool({
        description:
          "Execute untrusted JavaScript or TypeScript inside a vm2 NodeVM sandbox. Node fs writes stay inside the current worktree, ambient network access is disabled, and only a reduced Bun helper subset is exposed.",
        execute: async (_toolCallId, params) => {
          const report = await runUntrustedJavaScriptInVm2({
            code: params.code,
            ...(typeof params.timeoutMs === "number"
              ? { timeoutMs: params.timeoutMs }
              : {}),
            worktreePath: scope.worktreePathContext,
          });
          recordMetidosSandboxRun({
            outcome: report.ok
              ? "succeeded"
              : report.timedOut
                ? "timedOut"
                : "failed",
          });
          return textToolResult(formatVm2ExecutionReportText(report), report);
        },
        label: "Run Untrusted JS",
        name: "run_untrusted_js",
        parameters: Type.Object({
          code: Type.String({
            description: "TypeScript or JavaScript source to execute.",
            minLength: 1,
          }),
          timeoutMs: Type.Optional(
            Type.Number({
              description:
                "Sandbox timeout in milliseconds. Defaults to 60000.",
              minimum: 1,
            }),
          ),
        }),
        promptGuidelines: [
          "Use this only when sandboxed computation or scripted analysis is better than a direct edit, grep, or shell command.",
        ],
        promptSnippet: "Run sandboxed JavaScript or TypeScript inside Metidos",
      }),
    ),
  ];
}
