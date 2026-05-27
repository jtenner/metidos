import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";

import { PLUGIN_REPLY_TO_SOURCE_PERMISSION } from "../plugin/ingress";
import { initPluginIngressMessageSchema } from "../plugin/ingress-store";
import {
  createPiIngressReplyTools,
  type PiIngressReplyContext,
  type PiIngressReplyToolHost,
} from "./ingress-reply-tool";

function createContext(
  overrides: Partial<PiIngressReplyContext> = {},
): PiIngressReplyContext {
  const database = new Database(":memory:");
  initPluginIngressMessageSchema(database);
  return {
    database,
    pluginId: "chat-plugin",
    sourceId: "chat",
    permissions: [PLUGIN_REPLY_TO_SOURCE_PERMISSION],
    source: { supportsReplyToSource: true, respondHandle: "respond-1" },
    ingress: {
      externalMessageId: "msg-1",
      externalUserId: "user-1",
      conversationId: "room-1",
      metidosUserId: 7,
      threadId: 42,
      receivedAt: new Date().toISOString(),
      dedicatedThread: true,
      responseContextEnabled: true,
    },
    ...overrides,
  };
}

function createHost(
  context: PiIngressReplyContext | null,
): PiIngressReplyToolHost & { sent: unknown[] } {
  const sent: unknown[] = [];
  return {
    sent,
    getActiveReplyContext: () => context,
    sendReplyToSource: async (input) => {
      sent.push(input);
    },
  };
}

async function executeReply(host: PiIngressReplyToolHost, message: string) {
  const tool = createPiIngressReplyTools({ threadIdContext: 42 }, host)[0];
  if (!tool) throw new Error("reply_to_source missing");
  return tool.execute("call-1", { message }, undefined, async () => {}, {
    cwd: "/repo",
  } as never);
}

describe("createPiIngressReplyTools", () => {
  it("does not install outside active dedicated ingress threads", () => {
    const host = createHost(null);
    expect(createPiIngressReplyTools({ threadIdContext: 42 }, host)).toEqual(
      [],
    );
  });

  it("sends only the authored message to the bound response context", async () => {
    const context = createContext();
    const host = createHost(context);

    const result = await executeReply(host, "  Thanks, I will check.  ");

    expect(result.content[0]).toEqual({
      type: "text",
      text: "Reply sent to source.",
    });
    expect(host.sent).toEqual([
      {
        pluginId: "chat-plugin",
        sourceId: "chat",
        responseContext: {
          external_message_id: "msg-1",
          external_user_id: "user-1",
          external_conversation_id: "room-1",
        },
        message: "Thanks, I will check.",
      },
    ]);
  });

  it("rejects arbitrary destination arguments at schema level", () => {
    const host = createHost(createContext());
    const [tool] = createPiIngressReplyTools({ threadIdContext: 42 }, host);
    if (!tool) {
      throw new Error("Expected ingress reply tool.");
    }

    expect(tool.parameters).toMatchObject({
      additionalProperties: false,
      properties: { message: { type: "string" } },
      required: ["message"],
    });
    expect(
      Object.keys((tool.parameters as { properties: object }).properties),
    ).toEqual(["message"]);
  });

  it("returns a safe error when the latest thread context is inactive", async () => {
    let context: PiIngressReplyContext | null = createContext();
    const host: PiIngressReplyToolHost = {
      getActiveReplyContext: () => context,
      sendReplyToSource: async () => {},
    };
    const [tool] = createPiIngressReplyTools({ threadIdContext: 42 }, host);
    if (!tool) {
      throw new Error("Expected ingress reply tool.");
    }
    context = null;

    await expect(
      tool.execute("call-1", { message: "hello" }, undefined, async () => {}, {
        cwd: "/repo",
      } as never),
    ).rejects.toThrow("only available in active dedicated ingress threads");
  });
});
