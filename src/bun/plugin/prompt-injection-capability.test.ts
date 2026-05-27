import { describe, expect, it } from "bun:test";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginStartupRegistrations } from "./startup-registrations";
import {
  buildPluginPromptInjectionSidecarRequest,
  listPluginPromptInjectionRegistrationsForThread,
  normalizePluginPromptInjectionResult,
  type PluginPromptInjectionCapabilitySession,
} from "./prompt-injection-capability";

function emptyRegistrations(): PluginStartupRegistrations {
  return {
    crons: [],
    gc: null,
    ingressSources: [],
    modelProviders: [],
    notificationProviders: [],
    oauthProviders: [],
    injections: [],
    tools: [],
  };
}

function plugin(pluginId: string): RpcPluginInventoryPlugin {
  return {
    directoryName: pluginId,
    pluginId,
    manifest: {
      access: [
        {
          id: "context",
          name: "Context",
          description: null,
          tools: [],
          injects: [
            { name: "context", description: "Context", timeoutMs: 2_500 },
          ],
        },
      ],
    },
  } as unknown as RpcPluginInventoryPlugin;
}

function session(
  registrations: PluginStartupRegistrations,
): PluginPromptInjectionCapabilitySession {
  return {
    directoryName: "alpha_plugin",
    plugin: plugin("alpha_plugin"),
    ready: true,
    registrations,
    stopping: false,
  };
}

describe("Plugin prompt injection capability", () => {
  it("lists enabled prompt injection registrations for a thread", () => {
    const alphaRegistrations = emptyRegistrations();
    alphaRegistrations.injections = [
      {
        inject: "context",
        name: "Context",
        promptHandle: "prompt:context:prompt",
        timeoutMs: 2_500,
      },
      {
        inject: "hidden",
        name: "Hidden",
        promptHandle: "prompt:hidden:prompt",
        timeoutMs: 2_500,
      },
    ];
    const betaRegistrations = emptyRegistrations();
    betaRegistrations.injections = [
      {
        inject: "context",
        name: "Context",
        promptHandle: "prompt:beta:prompt",
        timeoutMs: 3_500,
      },
    ];

    const result = listPluginPromptInjectionRegistrationsForThread({
      enabledAccessGroups: ["beta_plugin/context", "alpha_plugin/context"],
      sessions: [
        session(alphaRegistrations),
        {
          ...session(betaRegistrations),
          directoryName: "beta_plugin",
          plugin: plugin("beta_plugin"),
        },
        { ...session(alphaRegistrations), ready: false },
      ],
    });

    expect(result).toEqual([
      {
        directoryName: "alpha_plugin",
        inject: "context",
        pluginId: "alpha_plugin",
        promptHandle: "prompt:context:prompt",
        timeoutMs: 2_500,
      },
      {
        directoryName: "beta_plugin",
        inject: "context",
        pluginId: "beta_plugin",
        promptHandle: "prompt:beta:prompt",
        timeoutMs: 3_500,
      },
    ]);
  });

  it("builds prompt injection sidecar requests and normalizes callback output", () => {
    const request = buildPluginPromptInjectionSidecarRequest({
      context: {
        contextKind: "promptInjection",
        inject: "context",
        ownerUserId: 42,
        projectId: 1,
        threadId: 2,
        worktreePath: "/repo",
      },
      prompt: "user text",
      registration: {
        directoryName: "alpha_plugin",
        inject: "context",
        pluginId: "alpha_plugin",
        promptHandle: "prompt:context:prompt",
        timeoutMs: 2_500,
      },
    });

    expect(request).toEqual({
      directoryName: "alpha_plugin",
      operation: "prompt.inject",
      params: {
        inject: "context",
        prompt: "user text",
        promptHandle: "prompt:context:prompt",
        context: {
          contextKind: "promptInjection",
          inject: "context",
          ownerUserId: 42,
          projectId: 1,
          threadId: 2,
          worktreePath: "/repo",
        },
      },
      pluginId: "alpha_plugin",
      timeoutMs: 2_500,
    });
    expect(normalizePluginPromptInjectionResult("inject me")).toBe("inject me");
    expect(normalizePluginPromptInjectionResult({ text: "ignored" })).toBe("");
  });
});
