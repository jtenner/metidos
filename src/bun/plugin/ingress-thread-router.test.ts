import { describe, expect, it } from "bun:test";
import {
  PluginIngressThreadRouter,
  PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS,
  type PluginIngressRoute,
  type PluginIngressThreadRouterHost,
} from "./ingress-thread-router";

function createHost(
  route: PluginIngressRoute | null,
  overrides: Partial<PluginIngressThreadRouterHost> = {},
) {
  const calls = {
    created: [] as unknown[],
    sent: [] as unknown[],
    failed: [] as unknown[],
    processed: [] as unknown[],
  };
  let nextThreadId = 100;
  const host: PluginIngressThreadRouterHost = {
    lookupRoute: () => route,
    assertRouteAccess: () => {},
    createThread: (params) => {
      calls.created.push(params);
      return { threadId: nextThreadId++ };
    },
    sendThreadMessage: (input) => {
      calls.sent.push(input);
    },
    markProcessed: (input) => {
      calls.processed.push(input);
    },
    markFailed: (input) => {
      calls.failed.push(input);
    },
    audit: () => {},
    ...overrides,
  };
  return { host, calls };
}

const route: PluginIngressRoute = {
  id: "dm",
  metidosUserId: 7,
  projectId: 3,
  worktreePath: "/repo",
  permissions: ["metidos:threads", "metidos:web_search"],
  enabled: true,
};

const tinyPngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

describe("PluginIngressThreadRouter", () => {
  it("routes verified direct messages through a plain text prompt", async () => {
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host, { now: () => 1_000 });

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: {
        id: "m1",
        user_id: "u1",
        conversation_id: "u1",
        message: "please triage this",
      },
      promptTemplate: () => "Answer concisely.",
    });

    expect(result).toEqual({ routed: true, threadId: 100 });
    expect(calls.created).toHaveLength(1);
    expect(calls.sent).toHaveLength(1);
    const sent = calls.sent[0] as {
      input: string;
      threadId: number;
    };
    expect(sent.threadId).toBe(100);
    expect(sent.input).toContain(
      "The external user cannot see your response unless you use the `reply_to_source` tool.",
    );
    expect(sent.input).toContain(
      "Source-specific instructions from Direct messages (chat/dm):\n\n```\nAnswer concisely.\n```",
    );
    expect(sent.input).toContain(
      "This is the user's message. Please respond if appropriate:\n\n```\nplease triage this\n```",
    );
    expect(calls.processed).toHaveLength(1);
  });

  it("routes image-only ingress messages with image attachments", async () => {
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host, { now: () => 1_000 });

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: {
        id: "m1",
        user_id: "u1",
        conversation_id: "u1",
        message: "",
        images: [{ data: tinyPngBase64, mimeType: "image/png", type: "image" }],
      },
      promptTemplate: () => "Answer concisely.",
    });

    expect(result).toEqual({ routed: true, threadId: 100 });
    const sent = calls.sent[0] as {
      images?: unknown[];
      input: string;
      threadId: number;
    };
    expect(sent.input).toContain("Describe this image.");
    expect(sent.images).toEqual([
      { data: tinyPngBase64, mimeType: "image/png", type: "image" },
    ]);
  });

  it("uses source-specific prompt templates when rendering ingress prompts", async () => {
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host, { now: () => 1_000 });

    await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: {
        id: "m-template",
        user_id: "u-template",
        conversation_id: "u-template",
        message: "please triage this",
      },
      promptTemplate: (context) =>
        `Handle ${context.sourceName} from ${context.external_user_id}.`,
    });

    expect((calls.sent[0] as { input: string }).input).toContain(
      "Handle Direct messages from u-template.",
    );
  });

  it("uses a longer code fence when the external message contains backticks", async () => {
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host, { now: () => 1_000 });

    await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: {
        id: "m1",
        user_id: "u1",
        message: "```nested```",
      },
      promptTemplate: () => "Handle it.",
    });

    expect((calls.sent[0] as { input: string }).input).toContain(
      "This is the user's message. Please respond if appropriate:\n\n````\n```nested```\n````",
    );
  });

  it("reuses managed ingress threads for the same direct user until inactivity expires", async () => {
    let now = 1_000;
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host, { now: () => now });
    const common = {
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      promptTemplate: () => "Handle it.",
    };

    await router.routeVerifiedMessage({
      ...common,
      message: { id: "m1", user_id: "u1", message: "first" },
    });
    now += PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS - 1;
    await router.routeVerifiedMessage({
      ...common,
      message: { id: "m2", user_id: "u1", message: "second" },
    });
    now += PLUGIN_INGRESS_THREAD_REUSE_WINDOW_MS + 1;
    await router.routeVerifiedMessage({
      ...common,
      message: { id: "m3", user_id: "u1", message: "third" },
    });

    expect(calls.created).toHaveLength(2);
    expect((calls.sent[0] as { threadId: number }).threadId).toBe(100);
    expect((calls.sent[1] as { threadId: number }).threadId).toBe(100);
    expect((calls.sent[2] as { threadId: number }).threadId).toBe(101);
  });

  it("rejects unsupported group or channel conversation contexts", async () => {
    const { host, calls } = createHost(route);
    const router = new PluginIngressThreadRouter(host);

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: {
        id: "m1",
        user_id: "u1",
        conversation_id: "channel-1",
        message: "hello",
      },
      promptTemplate: () => "Handle it.",
    });

    expect(result).toEqual({
      routed: false,
      reason: "unsupported_conversation_context",
    });
    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(calls.failed).toHaveLength(1);
  });

  it("records route lookup failures without poisoning the ingress poll", async () => {
    const { host, calls } = createHost(route, {
      lookupRoute: () => {
        throw new Error("route table unavailable");
      },
    });
    const router = new PluginIngressThreadRouter(host);

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: { id: "m1", user_id: "u1", message: "hello" },
      promptTemplate: () => "Handle it.",
    });

    expect(result).toEqual({ routed: false, reason: "route_lookup_failed" });
    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(calls.failed[0]).toMatchObject({
      errorMetadata: {
        error: "route table unavailable",
        errorName: "Error",
      },
      reason: "route_lookup_failed",
    });
  });

  it("rejects route templates that request unsafe permissions", async () => {
    const { host, calls } = createHost({
      ...route,
      permissions: ["metidos:threads", "unsafe"],
    });
    const router = new PluginIngressThreadRouter(host);

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: { id: "m1", user_id: "u1", message: "hello" },
      promptTemplate: () => "Handle it.",
    });

    expect(result).toEqual({
      routed: false,
      reason: "unsafe_permissions_not_allowed",
    });
    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
  });

  it("records route access failures without poisoning the ingress poll", async () => {
    const { host, calls } = createHost(route, {
      assertRouteAccess: () => {
        throw new Error("target worktree is no longer available");
      },
    });
    const router = new PluginIngressThreadRouter(host);

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: { id: "m1", user_id: "u1", message: "hello" },
      promptTemplate: () => "Handle it.",
    });

    expect(result).toEqual({ routed: false, reason: "route_access_failed" });
    expect(calls.created).toHaveLength(0);
    expect(calls.sent).toHaveLength(0);
    expect(calls.failed[0]).toMatchObject({
      errorMetadata: {
        error: "target worktree is no longer available",
        errorName: "Error",
        routeId: "dm",
      },
      reason: "route_access_failed",
    });
  });

  it("records route execution failures after thread resolution", async () => {
    const { host, calls } = createHost(route, {
      sendThreadMessage: (input) => {
        calls.sent.push(input);
        throw new Error("provider unavailable for configured model");
      },
    });
    const router = new PluginIngressThreadRouter(host);

    const result = await router.routeVerifiedMessage({
      pluginId: "chat",
      sourceId: "dm",
      sourceName: "Direct messages",
      message: { id: "m1", user_id: "u1", message: "hello" },
      promptTemplate: () => "Handle it.",
    });

    expect(result).toEqual({
      routed: false,
      reason: "route_execution_failed",
    });
    expect(calls.created).toHaveLength(1);
    expect(calls.processed).toHaveLength(0);
    expect(calls.failed[0]).toMatchObject({
      errorMetadata: {
        error: "provider unavailable for configured model",
        errorName: "Error",
        routeId: "dm",
      },
      reason: "route_execution_failed",
      threadId: 100,
    });
  });
});
