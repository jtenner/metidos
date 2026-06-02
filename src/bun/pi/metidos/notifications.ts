/**
 * @file src/bun/pi/metidos/notifications.ts
 * @description Pi-native Metidos notification tools.
 */

import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { AuthServiceError } from "../../auth/service";
import {
  type PiMetidosToolHost,
  type PiMetidosToolScope,
  textToolResult,
  withMetidosToolTelemetry,
} from "./shared";

const NotifyUserToolParameters = Type.Object({
  clickUrl: Type.Optional(
    Type.String({
      description:
        "Optional URL opened when the user clicks the notification. Omit when there is no relevant link; do not pass null.",
    }),
  ),
  message: Type.String({
    description: "Required notification body text.",
    minLength: 1,
    maxLength: 2000,
  }),
  priority: Type.Optional(
    Type.Union(
      [
        Type.Literal("min"),
        Type.Literal("low"),
        Type.Literal("default"),
        Type.Literal("high"),
        Type.Literal("urgent"),
      ],
      {
        description:
          "Optional delivery priority. Omit to use low priority unless the user asked for urgency.",
      },
    ),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Optional short routing/grouping tags, up to 8 strings. Omit when unnecessary; do not pass null.",
      maxItems: 8,
    }),
  ),
  title: Type.String({
    description: "Required concise notification title.",
    minLength: 1,
    maxLength: 120,
  }),
});

function assertNotificationToolsAllowed(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): void {
  if (!scope.notificationsAccessEnabled) {
    throw new Error(
      "Notification tools require Notifications access for the current thread.",
    );
  }
  if (!host.notifyUser) {
    throw new Error("Notification tools require a Metidos notification host.");
  }
}

async function invokeNotificationHost<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof AuthServiceError) {
      throw error;
    }
    throw new Error(
      "Notification delivery failed. Check notification settings for details.",
    );
  }
}

export function createPiMetidosNotificationTools(
  scope: PiMetidosToolScope,
  host: PiMetidosToolHost,
): ToolDefinition[] {
  assertNotificationToolsAllowed(scope, host);
  return [
    withMetidosToolTelemetry(
      defineTool({
        name: "notify_user",
        description:
          "Send a notification to the owning user of this thread or cron. Requires Notifications access.",
        execute: async (_toolCallId, params) => {
          const notifyUser = host.notifyUser;
          if (!notifyUser) {
            throw new Error(
              "Notification tools require a Metidos notification host.",
            );
          }
          const result = await invokeNotificationHost(() =>
            notifyUser({
              body: params.message,
              clickUrl: params.clickUrl ?? null,
              priority: params.priority ?? "low",
              sourceThreadId: scope.threadIdContext,
              sourceType: "ai_tool",
              tags: params.tags ?? [],
              title: params.title,
            }),
          );
          return textToolResult(result.message, result);
        },
        label: "Notify User",
        parameters: NotifyUserToolParameters,
        promptSnippet: "Send a notification to the owning user",
      }),
    ),
  ];
}
