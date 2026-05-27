/**
 * @file src/bun/plugin/sidecar-capability-seams.ts
 * @description Declarative capability seams for Plugin System v1 sidecar runtimes.
 */

import type { RpcPluginInventoryPlugin } from "../rpc-schema/plugin";
import type { PluginStartupRegistrations } from "./startup-registrations";

export type PluginSidecarCapabilityKind =
  | "agentTool"
  | "cron"
  | "diagnostics"
  | "embeddingProvider"
  | "gc"
  | "ingress"
  | "lifecycle"
  | "modelProvider"
  | "notificationProvider"
  | "oauthProvider"
  | "piAuth"
  | "promptInjection";

export type PluginSidecarDecisionId =
  | "PLUG-003"
  | "PLUG-004"
  | "PLUG-005"
  | "PLUG-009"
  | "PLUG-011"
  | "PLUG-012"
  | "PLUG-013"
  | "PLUG-014"
  | "PLUG-020"
  | "PLUG-022";

export type PluginSidecarCapabilityBoundary = {
  capability: PluginSidecarCapabilityKind;
  decisionIds: PluginSidecarDecisionId[];
  hostResponsibilities: string[];
  present: boolean;
  registrationCount: number;
  sidecarOperations: string[];
  startupRegistration:
    | "always"
    | "cron"
    | "gc"
    | "ingressSource"
    | "manifestProviderConfiguration"
    | "modelProvider"
    | "notificationProvider"
    | "oauthProvider"
    | "promptInjection"
    | "tool";
};

export type PluginSidecarOperationCapability = {
  capability: PluginSidecarCapabilityKind;
  diagnosticsChannel: "host" | "operationFailure" | "stderr";
  operation: string;
  requiresCompleteSettings: boolean;
};

const MODEL_PROVIDER_DECISIONS: PluginSidecarDecisionId[] = [
  "PLUG-014",
  "PLUG-020",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasPiAuthProviderConfiguration(
  registrations: PluginStartupRegistrations,
): boolean {
  return registrations.modelProviders.some((provider) =>
    provider.configurations.some((configuration) => {
      if (!isRecord(configuration.value)) return false;
      const piAuth = configuration.value.piAuth;
      return Array.isArray(piAuth) && piAuth.length > 0;
    }),
  );
}

export function describePluginSidecarCapabilityBoundaries(input: {
  plugin?: RpcPluginInventoryPlugin | null;
  registrations: PluginStartupRegistrations;
}): PluginSidecarCapabilityBoundary[] {
  const { registrations } = input;
  const embeddingProviderCount = registrations.modelProviders.filter(
    (provider) => provider.embedHandle,
  ).length;
  const piAuthProviderConfigurationCount = hasPiAuthProviderConfiguration(
    registrations,
  )
    ? 1
    : 0;

  return [
    {
      capability: "lifecycle",
      decisionIds: ["PLUG-003", "PLUG-004", "PLUG-005"],
      hostResponsibilities: [
        "start exactly one approved sidecar per activated plugin",
        "own QuickJS adapter startup and typed stdio RPC framing",
        "stop cached static-provider sidecars when no callback dispatch is needed",
      ],
      present: true,
      registrationCount: 1,
      sidecarOperations: ["startup", "shutdown"],
      startupRegistration: "always",
    },
    {
      capability: "diagnostics",
      decisionIds: ["PLUG-005", "PLUG-013"],
      hostResponsibilities: [
        "treat stdout as protocol-only and stderr as diagnostics",
        "retain bounded stderr and operation failure diagnostics for local operators",
        "keep plugin-authored logs separate from sidecar stderr",
      ],
      present: true,
      registrationCount: 1,
      sidecarOperations: ["stderr", "sidecar.error"],
      startupRegistration: "always",
    },
    {
      capability: "agentTool",
      decisionIds: ["PLUG-005", "PLUG-009"],
      hostResponsibilities: [
        "filter registered tools by thread access groups before exposure",
        "dispatch tool callbacks through typed sidecar requests",
      ],
      present: registrations.tools.length > 0,
      registrationCount: registrations.tools.length,
      sidecarOperations: ["tool.call"],
      startupRegistration: "tool",
    },
    {
      capability: "cron",
      decisionIds: ["PLUG-005"],
      hostResponsibilities: [
        "schedule declared cron callbacks in the host",
        "record cron callback failures without stopping unrelated schedules",
      ],
      present: registrations.crons.length > 0,
      registrationCount: registrations.crons.length,
      sidecarOperations: ["cron.run"],
      startupRegistration: "cron",
    },
    {
      capability: "gc",
      decisionIds: ["PLUG-011", "PLUG-012"],
      hostResponsibilities: [
        "invoke plugin GC only for plugin-owned ~/ data",
        "keep first-activation seed/reset semantics host-owned",
      ],
      present: registrations.gc !== null,
      registrationCount: registrations.gc ? 1 : 0,
      sidecarOperations: ["metidos.gc"],
      startupRegistration: "gc",
    },
    {
      capability: "ingress",
      decisionIds: ["PLUG-005", "PLUG-009"],
      hostResponsibilities: [
        "own ingress poll scheduling, cursor persistence, and thread routing",
        "dispatch poll, prompt-template, and reply callbacks through sidecar RPC",
      ],
      present: registrations.ingressSources.length > 0,
      registrationCount: registrations.ingressSources.length,
      sidecarOperations: [
        "ingress.poll",
        "ingress.prompt.template",
        "ingress.respond",
      ],
      startupRegistration: "ingressSource",
    },
    {
      capability: "modelProvider",
      decisionIds: MODEL_PROVIDER_DECISIONS,
      hostResponsibilities: [
        "publish stable composite model provider identities",
        "run provider discovery at startup and refresh through host-owned catalog invalidation",
        "block provider registration outside startup contexts",
      ],
      present: registrations.modelProviders.length > 0,
      registrationCount: registrations.modelProviders.length,
      sidecarOperations: [
        "model.provider.execute",
        "provider.configurations.refresh",
      ],
      startupRegistration: "modelProvider",
    },
    {
      capability: "embeddingProvider",
      decisionIds: ["PLUG-014", "PLUG-020", "PLUG-022"],
      hostResponsibilities: [
        "separate embedding-provider permission from embedding-consumer access",
        "dispatch embedding callbacks only for registered providers with embedding handles",
      ],
      present: embeddingProviderCount > 0,
      registrationCount: embeddingProviderCount,
      sidecarOperations: ["model.provider.embed"],
      startupRegistration: "modelProvider",
    },
    {
      capability: "notificationProvider",
      decisionIds: ["PLUG-014"],
      hostResponsibilities: [
        "register notification providers only at startup",
        "convert callback receipts into host notification delivery records",
      ],
      present: registrations.notificationProviders.length > 0,
      registrationCount: registrations.notificationProviders.length,
      sidecarOperations: ["notification.provider.send"],
      startupRegistration: "notificationProvider",
    },
    {
      capability: "oauthProvider",
      decisionIds: ["PLUG-014"],
      hostResponsibilities: [
        "register OAuth providers only at startup",
        "bridge imported and refreshed credentials into Pi auth storage",
      ],
      present: registrations.oauthProviders.length > 0,
      registrationCount: registrations.oauthProviders.length,
      sidecarOperations: ["oauth.provider.import", "oauth.provider.refresh"],
      startupRegistration: "oauthProvider",
    },
    {
      capability: "piAuth",
      decisionIds: ["PLUG-020"],
      hostResponsibilities: [
        "resolve provider API-key bindings from env or Plugin Settings",
        "keep model runtime auth material host-owned rather than plugin-accessible by default",
      ],
      present: piAuthProviderConfigurationCount > 0,
      registrationCount: piAuthProviderConfigurationCount,
      sidecarOperations: [],
      startupRegistration: "manifestProviderConfiguration",
    },
    {
      capability: "promptInjection",
      decisionIds: ["PLUG-005", "PLUG-009"],
      hostResponsibilities: [
        "keep prompt injection registration startup-owned",
        "dispatch content callbacks only after host access checks",
      ],
      present: registrations.injections.length > 0,
      registrationCount: registrations.injections.length,
      sidecarOperations: ["prompt.inject"],
      startupRegistration: "promptInjection",
    },
  ];
}

export function classifyPluginSidecarOperation(
  operation: string,
): PluginSidecarOperationCapability | null {
  if (operation === "tool.call") {
    return {
      capability: "agentTool",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation === "cron.run") {
    return {
      capability: "cron",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation === "metidos.gc") {
    return {
      capability: "gc",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: false,
    };
  }
  if (operation.startsWith("ingress.")) {
    return {
      capability: "ingress",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: false,
    };
  }
  if (operation === "model.provider.embed") {
    return {
      capability: "embeddingProvider",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation.startsWith("model.") || operation.startsWith("provider.")) {
    return {
      capability: "modelProvider",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation.startsWith("notification.provider.")) {
    return {
      capability: "notificationProvider",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation.startsWith("oauth.provider.")) {
    return {
      capability: "oauthProvider",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: true,
    };
  }
  if (operation === "prompt.inject") {
    return {
      capability: "promptInjection",
      diagnosticsChannel: "operationFailure",
      operation,
      requiresCompleteSettings: false,
    };
  }
  return null;
}

export function shouldRequireCompleteSettingsForSidecarOperation(
  operation: string,
): boolean {
  return (
    classifyPluginSidecarOperation(operation)?.requiresCompleteSettings ?? false
  );
}

export function isStaticModelProviderOnlyRegistration(
  registrations: PluginStartupRegistrations,
): boolean {
  return (
    registrations.modelProviders.length > 0 &&
    registrations.crons.length === 0 &&
    registrations.gc === null &&
    registrations.ingressSources.length === 0 &&
    registrations.notificationProviders.length === 0 &&
    registrations.oauthProviders.length === 0 &&
    registrations.injections.length === 0 &&
    registrations.tools.length === 0 &&
    registrations.modelProviders.every(
      (provider) =>
        !provider.executeHandle && !provider.getProviderConfigurationsHandle,
    )
  );
}

export function normalizePluginSidecarDiagnosticsRetentionLines(
  value: number | undefined,
  defaultLimit: number,
): number {
  if (value === undefined || !Number.isFinite(value)) {
    return defaultLimit;
  }
  return Math.max(1, Math.trunc(value));
}

export function retainNewestPluginSidecarDiagnostics<T>(
  items: T[],
  limit: number,
): void {
  if (items.length > limit) {
    items.splice(0, items.length - limit);
  }
}
