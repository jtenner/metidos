import { defineTool, type ToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  auditPluginIngressReplySendResult,
  enforcePluginIngressReplyGuardrails,
  type PluginIngressReplyGuardInput,
} from "../plugin/ingress-response-guard";

const ReplyToSourceParameters = Type.Object(
  {
    message: Type.String({
      description:
        "Short explicit message to send to the verified external source bound to this ingress thread.",
      minLength: 1,
    }),
  },
  {
    additionalProperties: false,
    description:
      "Reply payload. The destination is always derived from the verified ingress thread context and cannot be supplied by the model.",
  },
);

export type PiIngressReplyToolScope = {
  threadIdContext: number;
};

export type PiIngressReplyContext = Omit<
  PluginIngressReplyGuardInput,
  "message" | "now"
>;

export type PiIngressReplyToolHost = {
  getActiveReplyContext(threadId: number): PiIngressReplyContext | null;
  sendReplyToSource(input: {
    pluginId: string;
    sourceId: string;
    responseContext: {
      external_message_id: string;
      external_user_id: string;
      external_conversation_id?: string;
    };
    message: string;
    signal?: AbortSignal;
  }): Promise<void>;
};

export function createPiIngressReplyTools(
  scope: PiIngressReplyToolScope,
  host: PiIngressReplyToolHost,
): ToolDefinition[] {
  const context = host.getActiveReplyContext(scope.threadIdContext);
  if (!context) return [];

  return [
    defineTool<typeof ReplyToSourceParameters, unknown>({
      name: "reply_to_source",
      label: "Reply to source",
      description:
        "Send an explicit short reply to the verified external source bound to this active dedicated ingress thread. Do not use this unless the user asked you to reply externally.",
      promptSnippet:
        "The external ingress user cannot see your normal assistant response. Before finishing every ingress turn, use reply_to_source to send a concise, precise, and accurate response to this thread's verified ingress source when a response is appropriate; never infer or supply a destination.",
      parameters: ReplyToSourceParameters,
      execute: async (_toolCallId, params, signal) => {
        const latestContext = host.getActiveReplyContext(scope.threadIdContext);
        if (!latestContext) {
          throw new Error(
            "reply_to_source is only available in active dedicated ingress threads.",
          );
        }
        const guard = enforcePluginIngressReplyGuardrails({
          ...latestContext,
          message: params.message,
        });
        if (!guard.ok) {
          throw new Error(`${guard.safeMessage} (${guard.reason})`);
        }
        try {
          await host.sendReplyToSource({
            pluginId: latestContext.pluginId,
            sourceId: latestContext.sourceId,
            responseContext: guard.responseContext,
            message: guard.message,
            ...(signal ? { signal } : {}),
          });
        } catch (error) {
          auditPluginIngressReplySendResult(latestContext.database, {
            pluginId: latestContext.pluginId,
            sourceId: latestContext.sourceId,
            externalMessageId: latestContext.ingress?.externalMessageId ?? "",
            externalUserId: latestContext.ingress?.externalUserId ?? "",
            conversationId: latestContext.ingress?.conversationId ?? null,
            metidosUserId: latestContext.ingress?.metidosUserId ?? null,
            threadId: latestContext.ingress?.threadId ?? scope.threadIdContext,
            success: false,
            reason: error instanceof Error ? error.message : String(error),
            message: guard.message,
          });
          throw new Error("Reply was not sent.", { cause: error });
        }
        const ingress = latestContext.ingress;
        if (!ingress) {
          throw new Error("Reply context is no longer active.");
        }
        auditPluginIngressReplySendResult(latestContext.database, {
          pluginId: latestContext.pluginId,
          sourceId: latestContext.sourceId,
          externalMessageId: ingress.externalMessageId,
          externalUserId: ingress.externalUserId,
          conversationId: ingress.conversationId ?? null,
          metidosUserId: ingress.metidosUserId ?? null,
          threadId: ingress.threadId,
          success: true,
          message: guard.message,
        });
        return {
          content: [{ type: "text", text: "Reply sent to source." }],
          details: {
            pluginId: latestContext.pluginId,
            sourceId: latestContext.sourceId,
            threadId: ingress.threadId,
          },
        };
      },
    }) as unknown as ToolDefinition,
  ];
}
