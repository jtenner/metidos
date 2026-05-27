import { describe, expect, it } from "bun:test";

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginStartupRegistrations } from "./startup-registrations";
import {
  classifyPluginSidecarOperation,
  describePluginSidecarCapabilityBoundaries,
  isStaticModelProviderOnlyRegistration,
  normalizePluginSidecarDiagnosticsRetentionLines,
  retainNewestPluginSidecarDiagnostics,
  shouldRequireCompleteSettingsForSidecarOperation,
} from "./sidecar-capability-seams";

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

describe("Plugin sidecar capability seams", () => {
  it("describes startup registrations as planned sidecar capability boundaries", () => {
    const registrations: PluginStartupRegistrations = {
      crons: [
        {
          actionHandle: "cron:sync:action",
          fullKey: "alpha/sync",
          key: "sync",
          schedule: "*/5 * * * *",
          scope: "global",
          timeoutMs: 5_000,
        },
      ],
      gc: { actionHandle: "gc:action:1", timeoutMs: null },
      ingressSources: [
        {
          description: "Inbox source",
          id: "inbox",
          name: "Inbox",
          pollHandle: "ingress:inbox:poll",
          pollIntervalMs: 60_000,
          promptTemplateHandle: "ingress:inbox:prompt",
          respondHandle: "ingress:inbox:respond",
          supportsReplyToSource: true,
          timeoutMs: 5_000,
        },
      ],
      modelProviders: [
        {
          configurations: [
            {
              id: "default",
              value: {
                label: "Default",
                models: [{ id: "alpha-chat", name: "Alpha Chat" }],
                piAuth: [
                  {
                    kind: "api_key",
                    source: "setting",
                    value: "api_token",
                  },
                ],
              },
            },
          ],
          embedHandle: "provider:alpha:embed",
          executeHandle: "provider:alpha:execute",
          getProviderConfigurationsHandle: "provider:alpha:configurations",
          id: "alpha",
          refreshIntervalMs: 60_000,
          timeoutMs: 30_000,
        },
      ],
      notificationProviders: [
        {
          id: "pager",
          sendHandle: "notification:pager:send",
          timeoutMs: 5_000,
        },
      ],
      oauthProviders: [
        {
          id: "oauth_alpha",
          importCredentialsHandle: "oauth:alpha:import",
          provider: "alpha",
          refreshHandle: "oauth:alpha:refresh",
          timeoutMs: 5_000,
        },
      ],
      injections: [
        {
          inject: "default",
          name: "Default",
          promptHandle: "prompt:default:prompt",
          timeoutMs: 5_000,
        },
      ],
      tools: [
        {
          actionHandle: "tool:search:action",
          description: "Search",
          name: "Search",
          runtimeId: "alpha/search",
          timeoutMs: 5_000,
          tool: "search",
          validatePropsHandle: "tool:search:validate",
        },
      ],
    };

    const boundaries = describePluginSidecarCapabilityBoundaries({
      plugin: {} as RpcPluginInventoryPlugin,
      registrations,
    });
    const byCapability = new Map(
      boundaries.map((boundary) => [boundary.capability, boundary]),
    );

    expect(byCapability.get("lifecycle")).toMatchObject({
      decisionIds: ["PLUG-003", "PLUG-004", "PLUG-005"],
      present: true,
      startupRegistration: "always",
    });
    expect(byCapability.get("diagnostics")).toMatchObject({
      decisionIds: ["PLUG-005", "PLUG-013"],
      present: true,
      startupRegistration: "always",
    });
    expect(byCapability.get("agentTool")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["tool.call"],
      startupRegistration: "tool",
    });
    expect(byCapability.get("cron")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["cron.run"],
    });
    expect(byCapability.get("gc")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["metidos.gc"],
    });
    expect(byCapability.get("ingress")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: [
        "ingress.poll",
        "ingress.prompt.template",
        "ingress.respond",
      ],
    });
    expect(byCapability.get("modelProvider")).toMatchObject({
      decisionIds: ["PLUG-014", "PLUG-020"],
      present: true,
      registrationCount: 1,
    });
    expect(byCapability.get("embeddingProvider")).toMatchObject({
      decisionIds: ["PLUG-014", "PLUG-020", "PLUG-022"],
      present: true,
      registrationCount: 1,
      sidecarOperations: ["model.provider.embed"],
    });
    expect(byCapability.get("notificationProvider")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["notification.provider.send"],
    });
    expect(byCapability.get("oauthProvider")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["oauth.provider.import", "oauth.provider.refresh"],
    });
    expect(byCapability.get("piAuth")).toMatchObject({
      present: true,
      registrationCount: 1,
      startupRegistration: "manifestProviderConfiguration",
    });
    expect(byCapability.get("promptInjection")).toMatchObject({
      present: true,
      registrationCount: 1,
      sidecarOperations: ["prompt.inject"],
    });
  });

  it("classifies sidecar operation dispatch without broadening the settings gate", () => {
    expect(classifyPluginSidecarOperation("tool.call")).toMatchObject({
      capability: "agentTool",
      requiresCompleteSettings: true,
    });
    expect(classifyPluginSidecarOperation("cron.run")).toMatchObject({
      capability: "cron",
      requiresCompleteSettings: true,
    });
    expect(
      classifyPluginSidecarOperation("provider.configurations.refresh"),
    ).toMatchObject({
      capability: "modelProvider",
      requiresCompleteSettings: true,
    });
    expect(
      classifyPluginSidecarOperation("model.provider.embed"),
    ).toMatchObject({
      capability: "embeddingProvider",
      requiresCompleteSettings: true,
    });
    expect(
      classifyPluginSidecarOperation("notification.provider.send"),
    ).toMatchObject({
      capability: "notificationProvider",
      requiresCompleteSettings: true,
    });
    expect(
      classifyPluginSidecarOperation("oauth.provider.refresh"),
    ).toMatchObject({
      capability: "oauthProvider",
      requiresCompleteSettings: true,
    });

    expect(classifyPluginSidecarOperation("metidos.gc")).toMatchObject({
      capability: "gc",
      requiresCompleteSettings: false,
    });
    expect(classifyPluginSidecarOperation("ingress.poll")).toMatchObject({
      capability: "ingress",
      requiresCompleteSettings: false,
    });
    expect(classifyPluginSidecarOperation("prompt.inject")).toMatchObject({
      capability: "promptInjection",
      requiresCompleteSettings: false,
    });
    expect(classifyPluginSidecarOperation("host.request")).toBeNull();

    expect(shouldRequireCompleteSettingsForSidecarOperation("tool.call")).toBe(
      true,
    );
    expect(shouldRequireCompleteSettingsForSidecarOperation("metidos.gc")).toBe(
      false,
    );
  });

  it("identifies idle static model-provider registrations without callback dispatch", () => {
    const staticProvider = emptyRegistrations();
    staticProvider.modelProviders.push({
      configurations: [
        {
          id: "local",
          value: { label: "Local", models: [{ id: "llama", name: "Llama" }] },
        },
      ],
      executeHandle: null,
      getProviderConfigurationsHandle: null,
      id: "ollama",
      refreshIntervalMs: null,
      timeoutMs: 5_000,
    });
    expect(isStaticModelProviderOnlyRegistration(staticProvider)).toBe(true);

    const dynamicProvider = emptyRegistrations();
    dynamicProvider.modelProviders.push({
      configurations: [],
      executeHandle: null,
      getProviderConfigurationsHandle: "provider:ollama:configurations",
      id: "ollama",
      refreshIntervalMs: null,
      timeoutMs: 5_000,
    });
    expect(isStaticModelProviderOnlyRegistration(dynamicProvider)).toBe(false);

    const providerWithTool = emptyRegistrations();
    providerWithTool.modelProviders.push(...staticProvider.modelProviders);
    providerWithTool.tools.push({
      actionHandle: "tool:search:action",
      description: "Search",
      name: "Search",
      runtimeId: "alpha/search",
      timeoutMs: 5_000,
      tool: "search",
      validatePropsHandle: "tool:search:validate",
    });
    expect(isStaticModelProviderOnlyRegistration(providerWithTool)).toBe(false);
  });

  it("normalizes and applies bounded diagnostics retention", () => {
    expect(
      normalizePluginSidecarDiagnosticsRetentionLines(undefined, 200),
    ).toBe(200);
    expect(
      normalizePluginSidecarDiagnosticsRetentionLines(Number.NaN, 200),
    ).toBe(200);
    expect(normalizePluginSidecarDiagnosticsRetentionLines(0, 200)).toBe(1);
    expect(normalizePluginSidecarDiagnosticsRetentionLines(3.9, 200)).toBe(3);

    const retained = ["line-1", "line-2", "line-3", "line-4"];
    retainNewestPluginSidecarDiagnostics(retained, 2);
    expect(retained).toEqual(["line-3", "line-4"]);
  });
});
